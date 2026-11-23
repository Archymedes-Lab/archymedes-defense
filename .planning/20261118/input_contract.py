"""Bounded metadata input and safe CLI boundary. No network or persistence."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, NoReturn

MAX_BYTES = 2 * 1024 * 1024
MAX_FINDINGS = 128
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}\Z', re.ASCII)
HEX = re.compile(r'[0-9a-f]{64}\Z', re.ASCII)
UTC = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\Z', re.ASCII)


class InputError(ValueError):
    pass


def fields(value: Any, expected: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise InputError('SCHEMA_FIELDS_INVALID')
    return value


def array(value: Any, maximum: int, minimum: int = 0) -> list[Any]:
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise InputError('ARRAY_SIZE_INVALID')
    return value


def identifier(value: Any) -> str:
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise InputError('IDENTIFIER_INVALID')
    return value


def digest(value: Any) -> str:
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise InputError('DIGEST_INVALID')
    return value


def integer(value: Any, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise InputError('INTEGER_INVALID')
    return value


def boolean(value: Any) -> bool:
    if type(value) is not bool:
        raise InputError('BOOLEAN_INVALID')
    return value


def choice(value: Any, allowed: set[str]) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise InputError('ENUM_INVALID')
    return value


def timestamp(value: Any) -> datetime:
    if not isinstance(value, str) or not UTC.fullmatch(value):
        raise InputError('TIMESTAMP_INVALID')
    try:
        return datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise InputError('TIMESTAMP_INVALID') from exc


def canonical_digest(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InputError('DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def nonfinite(_value: str) -> NoReturn:
    raise InputError('NONFINITE_JSON_NUMBER')


def decode(raw: bytes) -> Any:
    if len(raw) > MAX_BYTES:
        raise InputError('INPUT_BYTE_LIMIT')
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=unique_pairs, parse_constant=nonfinite)
    except InputError:
        raise
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise InputError('INVALID_JSON') from exc


def identity(info: os.stat_result) -> tuple[int, int, int, int, int]:
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def snapshot(path: Path) -> bytes:
    try:
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode):
            raise InputError('INPUT_NOT_REGULAR')
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
        with os.fdopen(fd, 'rb') as source:
            opened = os.fstat(source.fileno())
            if not stat.S_ISREG(opened.st_mode) or identity(opened) != identity(before):
                raise InputError('INPUT_CHANGED')
            if opened.st_size > MAX_BYTES:
                raise InputError('INPUT_BYTE_LIMIT')
            raw = source.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise InputError('INPUT_BYTE_LIMIT')
            if identity(os.fstat(source.fileno())) != identity(opened):
                raise InputError('INPUT_CHANGED')
        if identity(path.lstat()) != identity(before):
            raise InputError('INPUT_CHANGED')
        return raw
    except OSError as exc:
        raise InputError('INPUT_UNREADABLE') from exc


class Findings:
    def __init__(self) -> None:
        self.rows: list[dict[str, str]] = []
        self.total = 0
        self.codes: set[str] = set()

    def add(self, code: str, scope: str) -> None:
        self.total += 1
        self.codes.add(code)
        if len(self.rows) < MAX_FINDINGS:
            self.rows.append({'code': code, 'scope': scope})

    def report(self) -> dict[str, Any]:
        return {'findings': self.rows, 'finding_count': self.total,
                'findings_truncated': self.total > MAX_FINDINGS}


class SafeParser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:
        raise InputError('ARGUMENTS_INVALID')


def run(analyze: Callable[[Any, datetime], dict[str, Any]], clean_status: str,
        argv: list[str] | None = None) -> int:
    parser = SafeParser(description='Offline metadata-only research prototype; no network or actions.')
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--at', help='Explicit UTC replay time, e.g. 2026-11-18T00:00:00Z')
    report: dict[str, Any]
    try:
        args = parser.parse_args(argv)
        at = timestamp(args.at) if args.at else datetime.now(timezone.utc).replace(microsecond=0)
        raw = snapshot(args.input)
        report = analyze(decode(raw), at)
        report.update(schema_version=1, input_complete=True, input_bytes=len(raw),
                      input_sha256=hashlib.sha256(raw).hexdigest(), evaluated_at=at.isoformat())
        code = 0 if report['status'] == clean_status else 1
    except InputError as exc:
        report = {'schema_version': 1, 'status': 'UNKNOWN', 'input_complete': False, 'error': str(exc)}
        code = 2
    except KeyboardInterrupt:
        report = {'schema_version': 1, 'status': 'UNKNOWN', 'input_complete': False,
                  'error': 'INPUT_INTERRUPTED'}
        code = 130
    try:
        sys.stdout.write(json.dumps(report, sort_keys=True, allow_nan=False) + '\n')
    except BrokenPipeError:
        return 2
    return code
