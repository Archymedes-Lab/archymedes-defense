"""Download the openly licensed assets of the warehouse-site scene and prepare web-sized copies.

Data files only (glTF, textures, HDR, FBX): nothing downloaded here is executed.
  Poly Haven   CC0          photoscanned props, PBR materials, sky          api.polyhaven.com
  Rocketbox    MIT          rigged people and walk/idle animations          github.com/microsoft/Microsoft-Rocketbox

Run: uv run --python 3.12 --no-project --with pillow python scripts/fetch_site_assets.py data/assets_src ../web/public/world/assets
Raw downloads are kept in the first folder; the second gets resized textures, CREDITS.json and licence texts.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
UA = "archworld/0.1 (open-data research prototype)"
PH = "https://api.polyhaven.com"
RB = "https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master"

# id -> texture size on the web copy (pixels). Large, close-up or tiling assets keep 1k; small props get 512.
MODELS = {
    "modular_chainlink_fence": 1024, "rollershutter_door": 1024, "covered_car": 1024, "concrete_road_barrier_02": 512,
    "security_camera_01": 512, "flood_lights": 512, "street_lamp_01": 512, "Barrel_01": 512, "barrel_03": 512,
    "plastic_crate_02": 512, "wooden_crate_02": 512, "cardboard_box_01": 512, "portable_generator": 512,
    "utility_box_01": 512, "exterior_aircon_unit": 512, "metal_trash_can": 512, "hand_truck": 512, "power_box_01": 512,
}
EXTRA_MAPS = {"modular_chainlink_fence": ["wire_alpha"]}
TEXTURES = ["corrugated_iron_02", "asphalt_02", "concrete_floor_worn_001", "painted_metal_shutter"]
HDRI = "kloofendal_48d_partly_cloudy_puresky"
AVATARS = {  # folder in the repo -> texture parts to keep
    "Professions/Security_Male_01": ["body", "head", "equipment"],
    "Adults/Male_Adult_08": ["body", "head", "opacity"],  # "opacity" is hair and lashes, kept with its alpha
    "Professions/Construction_Male_03": ["body", "head", "helmet", "tools"],  # site staff: hard hat and tool belt
}
# walk from the set with root motion removed in the ground plane (walks on the spot); the sim supplies the motion
ANIMS = {"m_walk_neutral.max.fbx": "all_animations_max_motextr_xy", "m_idle_neutral_01.max.fbx": "all_animations_max_motextr_static"}


def get(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url.replace(" ", "%20"), headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                data = r.read()
            break
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** (attempt + 1))
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(data)
    tmp.replace(dest)
    return dest


def api(path: str) -> dict:
    cache = SRC / "polyhaven" / "_api" / (path.strip("/").replace("/", "_") + ".json")
    return json.loads(get(f"{PH}/{path}", cache).read_text())


def web_texture(src: Path, dest: Path, px: int) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src)
    if max(im.size) > px:
        im = im.resize((px * im.size[0] // max(im.size), px * im.size[1] // max(im.size)), Image.LANCZOS)
    if dest.suffix.lower() in (".jpg", ".jpeg"):
        im.convert("RGB").save(dest, "JPEG", quality=86)
    else:
        im.save(dest)


credits = {"note": "Looks only. Sim performance figures are class assumptions, not these products' data.", "assets": []}
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()  # noqa: E731

# ---------------------------------------------------------------- Poly Haven models
for mid, px in MODELS.items():
    g = api(f"files/{mid}")["gltf"]["1k"]["gltf"]
    d = SRC / "polyhaven" / mid
    main = get(g["url"], d / f"{mid}.gltf")
    for rel, f in g["include"].items():
        get(f["url"], d / rel)
    o = OUT / "ph" / mid
    o.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(main, o / main.name)
    for rel in g["include"]:
        if rel.startswith("textures/"):
            web_texture(d / rel, o / rel, px)
        else:
            (o / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(d / rel, o / rel)
    for key in EXTRA_MAPS.get(mid, []):  # maps the glTF download leaves out (the fence wire's transparency)
        f = api(f"files/{mid}")[key]["1k"]
        ext = "png" if "png" in f else "jpg"
        web_texture(get(f[ext]["url"], d / "textures" / f"{key}.{ext}"), o / "textures" / f"{key}.png", px)
    size = sum(p.stat().st_size for p in o.rglob("*") if p.is_file())
    credits["assets"].append({"id": mid, "kind": "model", "licence": "CC0-1.0", "source": f"https://polyhaven.com/a/{mid}",
                              "path": f"ph/{mid}/{main.name}", "bytes": size, "sha256": sha(o / main.name)})
    print(f"model {mid}: {size / 1e6:.1f} MB")

# ---------------------------------------------------------------- Poly Haven materials and sky
for tid in TEXTURES:
    f = api(f"files/{tid}")
    for key, name in (("Diffuse", "diff"), ("nor_gl", "nor"), ("arm", "arm")):
        url = f[key]["1k"]["jpg"]["url"]
        raw = get(url, SRC / "polyhaven" / "textures" / tid / f"{name}.jpg")
        web_texture(raw, OUT / "tex" / tid / f"{name}.jpg", 1024)
    credits["assets"].append({"id": tid, "kind": "material", "licence": "CC0-1.0", "source": f"https://polyhaven.com/a/{tid}",
                              "path": f"tex/{tid}/", "sha256": sha(OUT / "tex" / tid / "diff.jpg")})
    print("material", tid)
hdr = get(api(f"files/{HDRI}")["hdri"]["1k"]["hdr"]["url"], SRC / "polyhaven" / "hdri" / f"{HDRI}_1k.hdr")
(OUT / "sky").mkdir(parents=True, exist_ok=True)
shutil.copyfile(hdr, OUT / "sky" / "sky_1k.hdr")
credits["assets"].append({"id": HDRI, "kind": "sky", "licence": "CC0-1.0", "source": f"https://polyhaven.com/a/{HDRI}",
                          "path": "sky/sky_1k.hdr", "sha256": sha(hdr)})

# ---------------------------------------------------------------- Rocketbox people and animations
rb = SRC / "rocketbox"
lic = get(f"{RB}/LICENSE.md", rb / "LICENSE.md")
(OUT / "licenses").mkdir(parents=True, exist_ok=True)
shutil.copyfile(lic, OUT / "licenses" / "Microsoft-Rocketbox-MIT.md")
tree = json.loads(get("https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/master?recursive=1",
                      rb / "_tree.json").read_text())["tree"]
for folder, parts in AVATARS.items():
    name = folder.split("/")[1]
    base = f"Assets/Avatars/{folder}"
    fbx = get(f"{RB}/{base}/Export/{name}.fbx", rb / name / f"{name}.fbx")
    o = OUT / "people" / name
    o.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(fbx, o / f"{name}.fbx")
    tga = sorted({x["path"] for x in tree if x["path"].startswith(f"{base}/Textures/") and x["path"].endswith(".tga")})
    kept = []
    for path in tga:
        stem = Path(path).stem  # e.g. m171_body_color
        part, kind = stem.split("_")[1], stem.split("_")[2]
        if part not in parts or kind not in ("color", "normal"):
            continue  # anything else is left out (specular maps; and any item that is not body, head or kit)
        raw = get(f"{RB}/{path}", rb / name / Path(path).name)
        ext = "png" if part == "opacity" else "jpg"
        if part == "opacity" and kind != "color":
            continue
        web_texture(raw, o / f"{part}_{kind}.{ext}", 1024 if kind == "color" else 512)
        kept.append(f"{part}_{kind}.{ext}")
    credits["assets"].append({"id": name, "kind": "person", "licence": "MIT", "copyright": "(c) 2020 Microsoft",
                              "source": f"https://github.com/microsoft/Microsoft-Rocketbox/tree/master/{base}",
                              "path": f"people/{name}/{name}.fbx", "textures": kept, "sha256": sha(fbx)})
    print("person", name, kept)
for a, folder in ANIMS.items():
    raw = get(f"{RB}/Assets/Animations/{folder}/{a}", rb / "anim" / a)
    (OUT / "people" / "anim").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(raw, OUT / "people" / "anim" / a.replace(".max", ""))
    credits["assets"].append({"id": a, "kind": "animation", "licence": "MIT", "copyright": "(c) 2020 Microsoft",
                              "source": "https://github.com/microsoft/Microsoft-Rocketbox", "sha256": sha(raw),
                              "path": f"people/anim/{a.replace('.max', '')}"})
(OUT / "licenses" / "PolyHaven-CC0.txt").write_text(
    "Poly Haven assets are released under CC0 1.0 Universal (public domain dedication).\n"
    "https://polyhaven.com/license  https://creativecommons.org/publicdomain/zero/1.0/\n")
(OUT / "CREDITS.json").write_text(json.dumps(credits, indent=1) + "\n")
total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
print(f"published {total / 1e6:.0f} MB, {len(credits['assets'])} assets")
