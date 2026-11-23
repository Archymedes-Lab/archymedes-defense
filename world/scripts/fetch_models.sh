#!/usr/bin/env bash
# Fetch the openly licensed 3D models used by the viewer (pinned), into data/models_src/.
#   Unitree Go2   BSD-3-Clause  (c) Unitree Robotics, via MuJoCo Menagerie
#   Skydio X2     Apache-2.0    via MuJoCo Menagerie
#   CesiumMan     CC BY 4.0     (c) 2017 Cesium, via Khronos glTF-Sample-Assets
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)/data/models_src"
MENAGERIE=370c43965323c0944b433b202aac5058b5f907a9
mkdir -p "$SRC/khronos"
if [ ! -d "$SRC/menagerie/.git" ]; then
  git clone -q --filter=blob:none --sparse https://github.com/google-deepmind/mujoco_menagerie.git "$SRC/menagerie"
fi
git -C "$SRC/menagerie" sparse-checkout set unitree_go2 skydio_x2
git -C "$SRC/menagerie" fetch -q --depth 1 origin "$MENAGERIE" && git -C "$SRC/menagerie" checkout -q "$MENAGERIE"
curl -sfL -o "$SRC/khronos/CesiumMan.glb" \
  https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMan/glTF-Binary/CesiumMan.glb
sha256sum "$SRC/khronos/CesiumMan.glb"
