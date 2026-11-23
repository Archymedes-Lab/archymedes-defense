"""Input contracts, limits and bounded snapshot reads. No network, no retries."""
from __future__ import annotations

import io
import json
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MAX_INVENTORY_BYTES = 256 * 1024
MAX_TELEMETRY_BYTES = 64 * 1024 * 1024
MAX_TRUTH_BYTES = 1024 * 1024
MAX_REPORT_BYTES = 16 * 1024 * 1024
MAX_LINE_BYTES = 4096
MAX_RECORDS = 500_000
MAX_DEVICES = 256
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class InputError(Exception):
    def __init__(self, code: str, line: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.line = line


@dataclass(frozen=True)
class Device:
    id: str
    heartbeat_ms: int
    value_varies: bool


@dataclass(frozen=True)
class Inventory:
    devices: tuple[Device, ...]
    window_start_ms: int
    window_end_ms: int


@dataclass(frozen=True)
class Receipt:
    device: str
    recv_ms: int
    seq: int
    boot: str
    dev_ms: int
    value: float


def _int(value: Any, code: str, low: int = 0, high: int = 2**53) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise InputError(code)
    return value


def _ident(value: Any, code: str) -> str:
    if not isinstance(value, str) or not ID_PATTERN.match(value):
        raise InputError(code)
    return value


def decode(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        raise InputError("JSON_INVALID") from exc


def _reject_constant(_: str) -> Any:
    raise InputError("JSON_INVALID")


def parse_inventory(raw: bytes) -> Inventory:
    data = decode(raw)
    if not isinstance(data, dict) or not isinstance(data.get("devices"), list):
        raise InputError("INVENTORY_INVALID")
    window = data.get("window")
    if not isinstance(window, dict):
        raise InputError("INVENTORY_WINDOW_INVALID")
    start = _int(window.get("start_ms"), "INVENTORY_WINDOW_INVALID")
    end = _int(window.get("end_ms"), "INVENTORY_WINDOW_INVALID")
    if end <= start:
        raise InputError("INVENTORY_WINDOW_INVALID")
    if not 1 <= len(data["devices"]) <= MAX_DEVICES:
        raise InputError("INVENTORY_DEVICE_LIMIT")
    devices: list[Device] = []
    seen: set[str] = set()
    for entry in data["devices"]:
        if not isinstance(entry, dict):
            raise InputError("INVENTORY_DEVICE_INVALID")
        ident = _ident(entry.get("id"), "INVENTORY_DEVICE_INVALID")
        if ident in seen:
            raise InputError("INVENTORY_DEVICE_DUPLICATE")
        seen.add(ident)
        varies = entry.get("value_varies", True)
        if not isinstance(varies, bool):
            raise InputError("INVENTORY_DEVICE_INVALID")
        heartbeat = _int(entry.get("heartbeat_ms"), "INVENTORY_HEARTBEAT_INVALID", 100, 86_400_000)
        devices.append(Device(ident, heartbeat, varies))
    return Inventory(tuple(devices), start, end)


def parse_receipt(data: Any) -> Receipt:
    if not isinstance(data, dict):
        raise InputError("RECEIPT_INVALID")
    value = data.get("value")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputError("RECEIPT_VALUE_INVALID")
    return Receipt(
        device=_ident(data.get("device"), "RECEIPT_DEVICE_INVALID"),
        recv_ms=_int(data.get("recv_ms"), "RECEIPT_TIME_INVALID"),
        seq=_int(data.get("seq"), "RECEIPT_SEQ_INVALID"),
        boot=_ident(data.get("boot"), "RECEIPT_BOOT_INVALID"),
        dev_ms=_int(data.get("dev_ms"), "RECEIPT_TIME_INVALID"),
        value=float(value),
    )


def parse_jsonl(raw: bytes, parse: Any) -> list[Any]:
    rows: list[Any] = []
    source = io.BytesIO(raw)
    line_number = 0
    while True:
        line = source.readline(MAX_LINE_BYTES + 1)
        if not line:
            return rows
        line_number += 1
        if len(line) > MAX_LINE_BYTES:
            raise InputError("LINE_LIMIT", line_number)
        if not line.strip():
            continue
        if len(rows) >= MAX_RECORDS:
            raise InputError("RECORD_LIMIT", line_number)
        try:
            rows.append(parse(decode(line)))
        except InputError as exc:
            raise InputError(exc.code, line_number) from exc


def parse_telemetry(raw: bytes) -> list[Receipt]:
    return parse_jsonl(raw, parse_receipt)


def _identity(info: os.stat_result) -> tuple[int, int, int, int]:
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


def read_snapshot(path: Path, limit: int) -> bytes:
    """Read one regular file, refusing symlinks, special files, growth and concurrent change."""
    try:
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode):
            raise InputError("INPUT_NOT_REGULAR")
        if before.st_size > limit:
            raise InputError("INPUT_BYTE_LIMIT")
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(fd, "rb") as source:
            if _identity(os.fstat(source.fileno())) != _identity(before):
                raise InputError("INPUT_CHANGED")
            raw = source.read(limit + 1)
        if len(raw) > limit:
            raise InputError("INPUT_BYTE_LIMIT")
        if _identity(path.lstat()) != _identity(before):
            raise InputError("INPUT_CHANGED")
        return raw
    except OSError as exc:
        raise InputError("INPUT_UNREADABLE") from exc
