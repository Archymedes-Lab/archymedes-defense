#!/usr/bin/env bash
# Convert swissBUILDINGS3D 3.0 FileGDB (3D TIN solids) to GeoJSON MultiPolygonZ in LV95 (no reprojection),
# one file per map sheet, clipped to the site.
# pyogrio cannot read TIN geometry, so this one step runs the official GDAL container (pinned tag).
# Usage: scripts/convert_buildings.sh <site-raw-dir> <xmin> <ymin> <xmax> <ymax>
set -euo pipefail
RAW=$(realpath "$1"); shift
IMG=ghcr.io/osgeo/gdal:ubuntu-small-3.11.4
for gdb in "$RAW"/buildings3d/*/*.gdb; do
  rel=${gdb#"$RAW"/}
  sheet=$(basename "$(dirname "$gdb")" .gdb)
  out="buildings3d/$sheet.geojson"; rm -f "$RAW/$out"
  docker run --rm --network none -u "$(id -u):$(id -g)" -v "$RAW":/d:rw $IMG \
    ogr2ogr -f GeoJSON "/d/$out" "/d/$rel" Building_solid -nlt MULTIPOLYGONZ -spat "$@" \
    -select UUID,EGID,OBJEKTART,GEBAEUDE_NUTZUNG,NAME_KOMPLETT,DACH_MAX,DACH_MIN,GELAENDEPUNKT,GESAMTHOEHE,HERKUNFT,HERKUNFT_JAHR \
    -lco RFC7946=NO -lco COORDINATE_PRECISION=3
done
echo "$IMG" > "$RAW/buildings3d/converter.txt"
ls -la "$RAW"/buildings3d/*.geojson
