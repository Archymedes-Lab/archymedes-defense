"""Turn orthographic views of an aircraft into a textured 3D model with the Tripo API (multiview-to-model).

  uv run python scripts/tripo_model.py --front front.png --left side.png --out ../web/public/aero/f16.glb

The key is read from the environment (TRIPO_API_KEY) or from ~/.config/archymedes/keys.env; it is never printed.
API (v3: upload, task, poll, download):
https://developers.tripo3d.com/en/docs/generation-multiview-to-model/standard
Writes the model and a JSON sidecar with the task id, model version, parameters and the input image digests.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

BASE = "https://openapi.tripo3d.com/v3"
MODEL = "v3.1-20260211"


def api_key() -> str:
    key = os.environ.get("TRIPO_API_KEY", "").strip()
    if not key:
        env = Path.home() / ".config/archymedes/keys.env"
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("TRIPO_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        raise SystemExit("TRIPO_API_KEY not set (environment or ~/.config/archymedes/keys.env)")
    return key


def request(method: str, path: str, key: str, body: bytes | None = None, ctype: str | None = None) -> dict:
    url = f"{BASE}{path}"
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("HTTPS only")
    headers = {"Authorization": f"Bearer {key}", "User-Agent": "archymedes-aero"}
    if ctype:
        headers["Content-Type"] = ctype
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:  # nosec B310: HTTPS checked above
        out = json.loads(r.read())
    if out.get("code") != 0:
        raise RuntimeError(f"Tripo error {out.get('code')}: {str(out.get('message', ''))[:200]}")
    return out["data"]


def upload(path: Path, key: str) -> str:
    boundary = uuid.uuid4().hex
    data = path.read_bytes()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{path.name}\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    return request("POST", "/files", key, body, f"multipart/form-data; boundary={boundary}")["file_token"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--front", type=Path, required=True)
    ap.add_argument("--left", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--face-limit", type=int, default=120_000)
    a = ap.parse_args()
    key = api_key()
    views = {"front": a.front, "left": a.left}
    tokens = {v: upload(p, key) for v, p in views.items()}
    params = {"model": MODEL, "texture": True, "pbr": True, "texture_quality": "detailed",
              "geometry_quality": "detailed", "face_limit": a.face_limit, "compress": "geometry"}
    body = {"inputs": [{v: t} for v, t in tokens.items()], **params}
    task = request("POST", "/generation/multiview-to-model", key, json.dumps(body).encode(),
                   "application/json")["task_id"]
    print("task", task, flush=True)
    t0 = time.time()
    while True:
        d = request("GET", f"/tasks/{task}", key)
        if d["status"] in ("success", "failed", "cancelled", "banned", "expired"):
            break
        if time.time() - t0 > 1800:
            raise SystemExit("timed out after 30 min")
        time.sleep(3)
    if d["status"] != "success":
        raise SystemExit(f"task {d['status']}: {d.get('error_code')} {str(d.get('error_message', ''))[:200]}")
    url = d["output"]["model_url"]
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("HTTPS only")
    a.out.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=300) as r:  # nosec B310: HTTPS checked above
        a.out.write_bytes(r.read())
    meta = {"service": "Tripo API v3 multiview-to-model", "task_id": task, "params": params,
            "inputs": {v: hashlib.sha256(p.read_bytes()).hexdigest() for v, p in views.items()},
            "credits": d.get("credits_consumed"), "seconds": round(time.time() - t0), "bytes": a.out.stat().st_size}
    a.out.with_suffix(".json").write_text(json.dumps(meta, indent=1) + "\n")
    print(json.dumps({k: meta[k] for k in ("task_id", "credits", "seconds", "bytes")}))


if __name__ == "__main__":
    main()
