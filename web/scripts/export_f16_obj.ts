/**
 * Write the NASA-traced F-16 shape (lib/aero/f16shape.ts) as an OBJ for Blender, one object per part, in Blender's
 * axes (metres; X forward with the origin at mid-length, Y to port, Z up from the nose line minus 0.4 m):
 *   bun scripts/export_f16_obj.ts out.obj
 * Then: blender -b -P scripts/blender/f16_finish.py -- out.obj public/aero/models/f16-traced.glb
 */
import { writeFileSync } from "node:fs";
import { F16_LENGTH_M, f16ShapeParts } from "../lib/aero/f16shape";

const out = process.argv[2];
if (!out) throw new Error("usage: bun scripts/export_f16_obj.ts out.obj");
const L: string[] = ["# F-16 traced from NASA TP-1538 Fig. 2 (lib/aero/f16shape.ts); metres"];
let base = 1;
for (const p of f16ShapeParts()) {
  L.push(`o ${p.name}`);
  for (let i = 0; i < p.positions.length; i += 3) {
    const x = p.positions[i] ?? 0, y = p.positions[i + 1] ?? 0, z = p.positions[i + 2] ?? 0;
    L.push(`v ${(F16_LENGTH_M / 2 - x).toFixed(5)} ${(-y).toFixed(5)} ${(z - 0.4).toFixed(5)}`);
  }
  // mirroring x→forward and y→port keeps a right-handed frame, so the winding is unchanged
  for (let t = 0; t < p.indices.length; t += 3) L.push(`f ${(p.indices[t] ?? 0) + base} ${(p.indices[t + 1] ?? 0) + base} ${(p.indices[t + 2] ?? 0) + base}`);
  base += p.positions.length / 3;
}
writeFileSync(out, `${L.join("\n")}\n`);
console.log(`${out}: ${base - 1} vertices`);
