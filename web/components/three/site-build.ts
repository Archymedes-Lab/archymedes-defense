import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { mastObject } from "./world-models";

/**
 * The warehouse site as its own scene: a 512 m square of measured terrain, imagery, buildings and trees, with the
 * synthetic compound built from scanned props and PBR materials (Poly Haven, CC0) under a real sky.
 * Frame: local ENU from the compound centre, drawn as three.js (east, up, -north).
 */

export type Yard = {
  half_m: number; centre_enu: [number, number, number];
  terrain: { tiles: string[] };
  height: { file: string; n: number; step_m: number; local_to_lattice: number[] };
  buildings: { file: string | null; count: number };
  trees: { count: number; items: [number, number, number, number][] };
  compound: {
    warehouse: { corners: [number, number][]; base: number; floor: number; eave: number; ridge: number };
    fence: [number, number, number][]; fence_height: number; gate: { at: [number, number, number]; width: number; side: string };
    roads: [number, number, number][][]; drone_pad: { at: number[]; size: number }; dog_dock: { at: number[] };
    vehicle_bay: { at: number[] }; guard_post: { at: number[]; facing_deg: number };
    masts: { id: string; at: number[]; facing_deg: number; height: number }[]; zone: { centre: number[]; radius: number };
  };
};

/** Height of the fine terrain at local east/north, from the extract's 1 m lattice (bilinear). */
export class Height {
  constructor(private h: Float32Array, private n: number, private a: number[], private half: number) {}
  at(e: number, n: number): number {
    const m = this.n - 1;
    const x = Math.min(m - 1e-6, Math.max(0, e * this.a[0]! + n * this.a[2]! + this.half));
    const y = Math.min(m - 1e-6, Math.max(0, e * this.a[1]! + n * this.a[3]! + this.half));
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, h = this.h, w = this.n;
    return (h[j * w + i]! * (1 - fx) + h[j * w + i + 1]! * fx) * (1 - fy) + (h[(j + 1) * w + i]! * (1 - fx) + h[(j + 1) * w + i + 1]! * fx) * fy;
  }
}

const KIT = ["modular_chainlink_fence", "rollershutter_door", "covered_car", "concrete_road_barrier_02", "security_camera_01", "flood_lights",
  "Barrel_01", "barrel_03", "plastic_crate_02", "wooden_crate_02", "cardboard_box_01", "portable_generator", "utility_box_01",
  "exterior_aircon_unit", "metal_trash_can", "hand_truck", "power_box_01"] as const;
const MATERIALS = ["corrugated_iron_02", "asphalt_02", "concrete_floor_worn_001", "painted_metal_shutter"] as const;
export type Assets = { kit: Record<string, GLTF>; tex: Record<string, { map: THREE.Texture; nor: THREE.Texture; arm: THREE.Texture }>; sky: THREE.DataTexture; wireAlpha: THREE.Texture };

/** Sun direction in the sky image (brightest point of kloofendal_48d: 48 degrees up), in three.js axes. */
export const SUN = new THREE.Vector3(0.553, 0.743, 0.377).normalize();

export async function loadAssets(base: string, aniso: number): Promise<Assets> {
  const gl = new GLTFLoader(), tl = new THREE.TextureLoader();
  const t = (url: string, srgb: boolean) => tl.loadAsync(url).then((x) => { x.wrapS = x.wrapT = THREE.RepeatWrapping; x.anisotropy = aniso; if (srgb) x.colorSpace = THREE.SRGBColorSpace; return x; });
  const [kit, tex, sky, wireAlpha] = await Promise.all([
    Promise.all(KIT.map((id) => gl.loadAsync(`${base}/ph/${id}/${id}.gltf`).then((g) => [id, g] as const))).then(Object.fromEntries),
    Promise.all(MATERIALS.map(async (id) => [id, { map: await t(`${base}/tex/${id}/diff.jpg`, true), nor: await t(`${base}/tex/${id}/nor.jpg`, false), arm: await t(`${base}/tex/${id}/arm.jpg`, false) }] as const)).then(Object.fromEntries),
    new HDRLoader().loadAsync(`${base}/sky/sky_1k.hdr`),
    t(`${base}/ph/modular_chainlink_fence/textures/wire_alpha.png`, false),
  ]);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  return { kit, tex, sky, wireAlpha };
}

/** Ground materials repeat over a whole yard: mirrored repeats hide the tile edges that plain repeats show. */
function mirrored(a: Assets, id: string) {
  const x = a.tex[id]!;
  const f = (t: THREE.Texture) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.MirroredRepeatWrapping; c.needsUpdate = true; return c; };
  return { map: f(x.map), nor: f(x.nor), arm: f(x.arm) };
}

function pbr(a: Assets, id: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}, ground = false) {
  const x = ground ? mirrored(a, id) : a.tex[id]!;
  return new THREE.MeshStandardMaterial({ map: x.map, normalMap: x.nor, aoMap: x.arm, roughnessMap: x.arm, metalnessMap: x.arm, roughness: 1, metalness: 1, ...o });
}

/** One or more named nodes of a kit, baked to world placement, re-anchored: centre on x/z, base on y = 0. */
function piece(g: GLTF, names?: string[]): THREE.Group {
  const grp = new THREE.Group(), inner = new THREE.Group();
  g.scene.updateMatrixWorld(true);
  for (const src of names ? names.map((n) => g.scene.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o) : [g.scene]) {
    const c = src.clone(true);
    if (src.parent) c.applyMatrix4(src.parent.matrixWorld);
    inner.add(c);
  }
  inner.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(inner);
  inner.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  grp.add(inner);
  grp.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  grp.userData.size = b.getSize(new THREE.Vector3());
  return grp;
}

/** Many copies of an object as instanced meshes (one per mesh inside it). */
function instances(obj: THREE.Object3D, mats: THREE.Matrix4[], patch?: (m: THREE.Material) => THREE.Material): THREE.Group {
  const out = new THREE.Group();
  obj.updateMatrixWorld(true);
  obj.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = patch ? patch(m.material as THREE.Material) : (m.material as THREE.Material);
    const im = new THREE.InstancedMesh(m.geometry, mat, mats.length);
    const tmp = new THREE.Matrix4();
    mats.forEach((mx, i) => im.setMatrixAt(i, tmp.multiplyMatrices(mx, m.matrixWorld)));
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    out.add(im);
  });
  return out;
}

type Buf = { pos: number[]; uv: number[] };
const buf = (): Buf => ({ pos: [], uv: [] });
function quad(b: Buf, p: THREE.Vector3[], uv: [number, number][]) {
  for (const k of [0, 1, 2, 0, 2, 3]) { b.pos.push(p[k]!.x, p[k]!.y, p[k]!.z); b.uv.push(uv[k]![0], uv[k]![1]); }
}
function mesh(b: Buf, m: THREE.Material, shadow = true) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
  g.computeVertexNormals();
  const x = new THREE.Mesh(g, m);
  x.castShadow = shadow; x.receiveShadow = true;
  return x;
}
const box = (w: number, h: number, d: number, m: THREE.Material) => { const x = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); x.castShadow = true; x.receiveShadow = true; return x; };

export function buildSite(yard: Yard, H: Height, a: Assets, terrain: GLTF[], buildings: GLTF | null): THREE.Group {
  const root = new THREE.Group();
  const c = yard.compound, wh = c.warehouse;
  const P = (e: number, n: number, lift = 0) => new THREE.Vector3(e, H.at(e, n) + lift, -n);
  // compound axes: X along the warehouse's long side (c0 -> c1), Y across it (c0 -> c3); origin at its centre
  const c0 = new THREE.Vector2(...wh.corners[0]!), c1 = new THREE.Vector2(...wh.corners[1]!), c3 = new THREE.Vector2(...wh.corners[3]!);
  const ux = c1.clone().sub(c0).normalize(), uy = c3.clone().sub(c0).normalize();
  const L = c1.distanceTo(c0), W = c3.distanceTo(c0);
  const EN = (x: number, y: number): [number, number] => [ux.x * x + uy.x * y, ux.y * x + uy.y * y];
  const C = (x: number, y: number, lift = 0) => P(...EN(x, y), lift);
  const yawX = (d: THREE.Vector2) => Math.atan2(d.y, d.x); // turn an object so its local +X points along d (east, north)
  const yawZ = (d: THREE.Vector2) => Math.atan2(d.x, -d.y); // ... so its local +Z points along d
  const put = (o: THREE.Object3D, x: number, y: number, yaw = 0, lift = 0, scale = 1) => { o.position.copy(C(x, y, lift)); o.rotation.y = yawX(ux) + yaw; o.scale.multiplyScalar(scale); root.add(o); return o; };

  // ---- measured ground, buildings, trees
  for (const g of terrain) {
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.roughness = 1; mat.metalness = 0; mat.envMapIntensity = 0.55;
      if (mat.map) mat.map.anisotropy = 8;
      m.receiveShadow = true;
    });
    root.add(g.scene);
  }
  if (buildings) {
    buildings.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
      m.castShadow = true; m.receiveShadow = true;
    });
    root.add(buildings.scene);
  }
  const skirt = new THREE.Mesh(new THREE.CircleGeometry(4000, 48), new THREE.MeshStandardMaterial({ color: "#3d4a34", roughness: 1 }));
  skirt.rotation.x = -Math.PI / 2; skirt.position.y = H.at(0, 0) - 14; root.add(skirt); // beyond the extract, under fog
  if (yard.trees.items.length) {
    // one conifer per measured canopy peak: trunk plus three tiers of foliage, scaled to the measured height
    const trunk = new THREE.CylinderGeometry(0.035, 0.06, 0.35, 6).translate(0, 0.175, 0);
    const tiers = [0.36, 0.52, 0.7].map((y, i) => new THREE.ConeGeometry(0.2 - i * 0.045, 0.38 - i * 0.03, 9).translate(0, y, 0));
    const leaf = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true, envMapIntensity: 0.25 });
    const tm: THREE.Matrix4[] = [], cols: THREE.Color[] = [];
    const q = new THREE.Quaternion(), s = new THREE.Vector3();
    yard.trees.items.forEach(([e, n, , h], i) => {
      const r = ((i * 9301 + 49297) % 233280) / 233280; // fixed pseudo-random per tree: same forest on every load
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * Math.PI * 2);
      s.set(h * (0.85 + r * 0.3), h, h * (0.85 + r * 0.3));
      tm.push(new THREE.Matrix4().compose(P(e, n, -0.2), q, s));
      cols.push(new THREE.Color().setHSL(0.3 + r * 0.04, 0.38, 0.028 + r * 0.02)); // dark spruce green
    });
    const tr = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: "#4a3626", roughness: 1 }), tm.length);
    tm.forEach((m, i) => tr.setMatrixAt(i, m));
    tr.castShadow = true; root.add(tr);
    for (const g of tiers) {
      const im = new THREE.InstancedMesh(g, leaf, tm.length);
      tm.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, cols[i]!); });
      im.castShadow = true; im.receiveShadow = true; root.add(im);
    }
  }

  // ---- yard: asphalt inside the fence, a concrete apron round the warehouse, painted markings
  const fb = new THREE.Box2();
  for (const [e, n] of c.fence) fb.expandByPoint(new THREE.Vector2(new THREE.Vector2(e, n).dot(ux), new THREE.Vector2(e, n).dot(uy)));
  const drape = (x0: number, x1: number, y0: number, y1: number, step: number, lift: number, tile: number, m: THREE.Material) => {
    const b = buf();
    const nx = Math.max(1, Math.round((x1 - x0) / step)), ny = Math.max(1, Math.round((y1 - y0) / step));
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const xs = [x0 + ((x1 - x0) * i) / nx, x0 + ((x1 - x0) * (i + 1)) / nx], ys = [y0 + ((y1 - y0) * j) / ny, y0 + ((y1 - y0) * (j + 1)) / ny];
      const k: [number, number][] = [[xs[0]!, ys[0]!], [xs[1]!, ys[0]!], [xs[1]!, ys[1]!], [xs[0]!, ys[1]!]];
      quad(b, k.map(([x, y]) => C(x, y, lift)), k.map(([x, y]) => [x / tile, y / tile]));
    }
    const o = mesh(b, m, false);
    root.add(o);
    return o;
  };
  const off = (m: THREE.MeshStandardMaterial, f: number) => { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = f; return m; };
  drape(fb.min.x + 0.4, fb.max.x - 0.4, fb.min.y + 0.4, fb.max.y - 0.4, 2, 0.05, 3.6, off(pbr(a, "asphalt_02", { color: "#ffffff", metalness: 0 }, true), -2));
  drape(-L / 2 - 5, L / 2 + 5, -W / 2 - 9, W / 2 + 4, 2, 0.09, 4, off(pbr(a, "concrete_floor_worn_001", { color: "#ffffff", metalness: 0 }, true), -4));
  const paint = (hex: string) => off(new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7 }), -6);
  const stripe = (x0: number, y0: number, x1: number, y1: number, w: number, m: THREE.Material) => {
    const d = new THREE.Vector2(x1 - x0, y1 - y0), len = d.length(), n = new THREE.Vector2(-d.y, d.x).normalize().multiplyScalar(w / 2), b = buf();
    const steps = Math.max(1, Math.round(len / 2));
    for (let i = 0; i < steps; i++) {
      const p0 = new THREE.Vector2(x0, y0).addScaledVector(d, i / steps), p1 = new THREE.Vector2(x0, y0).addScaledVector(d, (i + 1) / steps);
      quad(b, [C(p0.x - n.x, p0.y - n.y, 0.11), C(p1.x - n.x, p1.y - n.y, 0.11), C(p1.x + n.x, p1.y + n.y, 0.11), C(p0.x + n.x, p0.y + n.y, 0.11)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    root.add(mesh(b, m, false));
  };
  const white = paint("#e8e8e4"), yellow = paint("#d8b21c");
  // the access road from the public road to the gate, paved
  const roadM = off(pbr(a, "asphalt_02", { color: "#e9e9e9", metalness: 0 }, true), -3);
  for (const line of c.roads.slice(1)) {
    const b = buf();
    let run = 0;
    for (let i = 0; i + 1 < line.length; i++) {
      const p0 = new THREE.Vector2(line[i]![0], line[i]![1]), p1 = new THREE.Vector2(line[i + 1]![0], line[i + 1]![1]);
      const d = p1.clone().sub(p0), len = d.length();
      if (len < 1e-6) continue;
      const n = new THREE.Vector2(-d.y, d.x).normalize().multiplyScalar(3);
      quad(b, [P(p0.x - n.x, p0.y - n.y, 0.07), P(p1.x - n.x, p1.y - n.y, 0.07), P(p1.x + n.x, p1.y + n.y, 0.07), P(p0.x + n.x, p0.y + n.y, 0.07)],
        [[0, run / 3.6], [0, (run + len) / 3.6], [6 / 3.6, (run + len) / 3.6], [6 / 3.6, run / 3.6]]);
      run += len;
    }
    root.add(mesh(b, roadM, false));
  }
  for (let k = 0; k <= 5; k++) stripe(-L / 2 + 6 + k * 3, -W / 2 - 20, -L / 2 + 6 + k * 3, -W / 2 - 14.5, 0.12, white); // parking bays
  for (const f of [0.2, 0.5, 0.8]) { stripe(-L / 2 + f * L - 2.6, -W / 2 - 8.6, -L / 2 + f * L - 2.6, -W / 2 - 0.4, 0.14, yellow); stripe(-L / 2 + f * L + 2.6, -W / 2 - 8.6, -L / 2 + f * L + 2.6, -W / 2 - 0.4, 0.14, yellow); }

  // ---- warehouse: corrugated steel on a concrete plinth
  const corner = wh.corners.map(([e, n]) => (u: number) => new THREE.Vector3(e, u, -n));
  // painted steel cladding: the scan is bare galvanised sheet, so its metalness is turned well down
  const steel = pbr(a, "corrugated_iron_02", { color: "#f1f3f4", metalness: 0.12, side: THREE.DoubleSide });
  const roofM = pbr(a, "corrugated_iron_02", { color: "#b3bdc6", metalness: 0.35, side: THREE.DoubleSide });
  const concrete = pbr(a, "concrete_floor_worn_001", { color: "#b8b8b4", metalness: 0, side: THREE.DoubleSide });
  const plinthTop = wh.floor + 0.55;
  const walls = buf(), plinth = buf(), roof = buf();
  const TW = 2.2; // metres of wall per texture repeat
  for (let k = 0; k < 4; k++) {
    const p = corner[k]!, q = corner[(k + 1) % 4]!, len = p(0).distanceTo(q(0));
    quad(walls, [p(plinthTop), q(plinthTop), q(wh.eave), p(wh.eave)], [[0, plinthTop / TW], [len / TW, plinthTop / TW], [len / TW, wh.eave / TW], [0, wh.eave / TW]]);
    quad(plinth, [p(wh.base), q(wh.base), q(plinthTop), p(plinthTop)], [[0, 0], [len / 3, 0], [len / 3, (plinthTop - wh.base) / 3], [0, (plinthTop - wh.base) / 3]]);
  }
  const ridge = (i: number, j: number) => corner[i]!(wh.eave).add(corner[j]!(wh.eave)).multiplyScalar(0.5).setY(wh.ridge);
  const r03 = ridge(0, 3), r12 = ridge(1, 2), slope = Math.hypot(W / 2, wh.ridge - wh.eave), over = 0.5;
  const eaveOut = (i: number, dirY: number, dirX: number) => { const [e, n] = EN(dirX * over, dirY * over); const p = corner[i]!(wh.eave - over * ((wh.ridge - wh.eave) / (W / 2))); return p.add(new THREE.Vector3(e, 0, -n)); };
  const rx = (v: THREE.Vector3, dirX: number) => { const [e, n] = EN(dirX * over, 0); return v.clone().add(new THREE.Vector3(e, 0, -n)); };
  quad(roof, [eaveOut(0, -1, -1), eaveOut(1, -1, 1), rx(r12, 1), rx(r03, -1)], [[0, 0], [L / TW, 0], [L / TW, slope / TW], [0, slope / TW]]);
  quad(roof, [eaveOut(2, 1, 1), eaveOut(3, 1, -1), rx(r03, -1), rx(r12, 1)], [[0, 0], [L / TW, 0], [L / TW, slope / TW], [0, slope / TW]]);
  for (const [i, j, r] of [[3, 0, r03], [1, 2, r12]] as const) { // gable ends
    const p = corner[i]!(wh.eave), q = corner[j]!(wh.eave);
    for (const v of [p, q, r]) { walls.pos.push(v.x, v.y, v.z); }
    walls.uv.push(0, wh.eave / TW, W / TW, wh.eave / TW, W / 2 / TW, wh.ridge / TW);
  }
  root.add(mesh(walls, steel), mesh(plinth, concrete), mesh(roof, roofM));
  const trim = new THREE.MeshStandardMaterial({ color: "#2b3138", roughness: 0.5, metalness: 0.6 });
  const cap = box(L + 2 * over + 0.2, 0.12, 0.7, trim); cap.position.copy(r03.clone().add(r12).multiplyScalar(0.5)).setY(wh.ridge + 0.04); cap.rotation.y = yawX(ux); root.add(cap);
  for (const side of [-1, 1]) { // gutters and downpipes
    const gy = side * (W / 2 + over + 0.08), gh = wh.eave - over * ((wh.ridge - wh.eave) / (W / 2)) - 0.1;
    const gut = box(L + 2 * over, 0.16, 0.18, trim); const [e, n] = EN(0, gy); gut.position.set(e, gh, -n); gut.rotation.y = yawX(ux); root.add(gut);
    for (const x of [-L / 2 + 0.3, L / 2 - 0.3]) { const [pe, pn] = EN(x, side * (W / 2 + 0.12)); const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, gh - wh.floor, 8), trim); pipe.position.set(pe, wh.floor + (gh - wh.floor) / 2, -pn); pipe.castShadow = true; root.add(pipe); }
  }
  for (const f of [0.25, 0.5, 0.75]) for (const side of [-1, 1]) { // roof lights
    const sl = box(2.2, 0.03, slope * 0.5, new THREE.MeshStandardMaterial({ color: "#dfe9ee", roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }));
    const [e, n] = EN(-L / 2 + f * L, side * W / 4); sl.position.set(e, (wh.eave + wh.ridge) / 2 + 0.05, -n);
    sl.rotation.order = "YXZ"; sl.rotation.y = yawX(ux); sl.rotation.x = side * Math.atan2(wh.ridge - wh.eave, W / 2); sl.castShadow = false; root.add(sl);
  }
  // doors on the south side: scanned roller shutters, stretched to truck height, in dark steel frames, lights over them
  const south = uy.clone().multiplyScalar(-1);
  const shutter = piece(a.kit.rollershutter_door!, ["rollershutter_door"]);
  shutter.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const x = (m.material as THREE.MeshStandardMaterial).clone(); x.color.set("#7f8a94"); m.material = x; } });
  const sz = shutter.userData.size as THREE.Vector3;
  const lamp = piece(a.kit.flood_lights!, ["flood_lights_wall_base", "flood_lights_wall_light"]);
  for (const f of [0.2, 0.5, 0.8]) {
    const x = -L / 2 + f * L, dw = 4.4, dh = 4.8;
    const d = shutter.clone(true); d.scale.set(dw / sz.x, dh / sz.y, 1);
    const [e, n] = EN(x, -W / 2 - 0.06); d.position.set(e, plinthTop - 0.35, -n); d.rotation.y = yawZ(south); root.add(d);
    for (const [fx, fw, fh, fy] of [[-dw / 2 - 0.12, 0.24, dh + 0.3, dh / 2], [dw / 2 + 0.12, 0.24, dh + 0.3, dh / 2], [0, dw + 0.48, 0.3, dh + 0.15]] as const) {
      const fr = box(fw, fh, 0.3, trim); const [fe, fn] = EN(x + fx, -W / 2 - 0.1); fr.position.set(fe, plinthTop - 0.35 + fy, -fn); fr.rotation.y = yawX(ux); root.add(fr);
    }
    const ramp = box(dw + 0.6, 0.5, 2.4, concrete); const [re, rn] = EN(x, -W / 2 - 1.3); ramp.position.set(re, wh.floor - 0.08, -rn); ramp.rotation.order = "YXZ"; ramp.rotation.y = yawX(ux); ramp.rotation.x = 0.16; root.add(ramp);
    const l = lamp.clone(true); const [le, ln] = EN(x, -W / 2 - 0.05); l.position.set(le, plinthTop + dh + 0.5, -ln); l.rotation.y = yawZ(south); l.scale.setScalar(1.6); root.add(l);
  }
  const doorM = new THREE.MeshStandardMaterial({ color: "#3d566e", roughness: 0.45, metalness: 0.5 });
  { const x = -L / 2 + 0.35 * L; const d = box(1.0, 2.1, 0.1, doorM); const [e, n] = EN(x, -W / 2 - 0.06); d.position.set(e, plinthTop - 0.3 + 1.05, -n); d.rotation.y = yawX(ux); root.add(d);
    const st = box(1.6, 0.5, 1.2, concrete); const [se, sn] = EN(x, -W / 2 - 0.65); st.position.set(se, wh.floor - 0.02, -sn); st.rotation.y = yawX(ux); root.add(st);
    const ub = piece(a.kit.utility_box_01!); const [ue, un] = EN(x + 1.6, -W / 2 - 0.3); ub.position.set(ue, H.at(ue, un) + 0.1, -un); ub.rotation.y = yawZ(south); root.add(ub);
    const pb = piece(a.kit.power_box_01!); const [pe, pn] = EN(x - 1.3, -W / 2 - 0.12); pb.position.set(pe, plinthTop + 0.9, -pn); pb.rotation.y = yawZ(south); root.add(pb); }
  const ac = piece(a.kit.exterior_aircon_unit!, ["exterior_aircon_unit"]);
  for (const y of [-6, 0, 6]) { const u = ac.clone(true); const [e, n] = EN(L / 2 + 0.25, y); u.position.set(e, plinthTop + 2.2, -n); u.rotation.y = yawZ(ux); root.add(u); }
  const camK = piece(a.kit.security_camera_01!);
  for (const [i, dx, dy] of [[0, -1, -1], [1, 1, -1], [2, 1, 1], [3, -1, 1]] as const) { // cameras under the eaves at each corner
    const cm = camK.clone(true); const p = corner[i]!(wh.eave - 0.9); const [e, n] = EN(dx * 0.25, dy * 0.25);
    cm.position.set(p.x + e, p.y, p.z - n); cm.rotation.y = yawZ(new THREE.Vector2(...EN(dx, dy)).normalize()); cm.scale.setScalar(1.5); root.add(cm);
  }

  // ---- yard furniture and stock, all scanned props
  const K = (id: string, names?: string[]) => piece(a.kit[id]!, names);
  const crate = K("wooden_crate_02"), pcrate = K("plastic_crate_02"), cbox = K("cardboard_box_01"), b1 = K("Barrel_01"), b3 = K("barrel_03");
  const stack = (o: THREE.Group, x: number, y: number, nx: number, ny: number, nz: number, yaw: number, gapX: number, gapY: number) => {
    const s = o.userData.size as THREE.Vector3;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx - (k ? 1 : 0) * (k % 2); i++) {
      const jit = (((i * 7 + j * 13 + k * 3) % 5) - 2) * 0.012;
      put(o.clone(true), x + i * (s.x + gapX) + jit, y + j * (s.z + gapY) + jit, yaw + jit * 3, 0.1 + k * s.y);
    }
  };
  stack(crate, -L / 2 + 0.2 * L + 4.2, -W / 2 - 4.5, 3, 2, 3, 0, 0.06, 0.08);
  stack(pcrate, -L / 2 + 0.5 * L + 3.6, -W / 2 - 2.2, 3, 3, 5, 0, 0.03, 0.03);
  stack(cbox, -L / 2 + 0.5 * L - 5.2, -W / 2 - 2.0, 3, 2, 3, 0.2, 0.04, 0.05);
  for (const [i, o] of [b1, b3, b1, b1, b3, b1, b3].entries()) put(o.clone(true), -L / 2 + 0.8 * L + 3.6 + (i % 4) * 0.72, -W / 2 - 1.4 - Math.floor(i / 4) * 0.74, i * 1.1, 0.1);
  put(K("hand_truck"), -L / 2 + 0.2 * L + 3.2, -W / 2 - 2.2, 2.2, 0.1);
  put(K("portable_generator"), L / 2 + 1.6, -W / 2 + 3, 0.4, 0.1, 1.3);
  const bins = a.kit.metal_trash_can!;
  put(piece(bins, ["metal_trash_can", "metal_trash_can_lid", "metal_trash_can_handle_left", "metal_trash_can_handle_right"]), L / 2 + 1.4, -W / 2 - 1.5, 0.3, 0.1);
  put(piece(bins, ["metal_trash_can_rust", "metal_trash_can_rust_lid", "metal_trash_can_rust_handle_left", "metal_trash_can_rust_handle_right"]), L / 2 + 2.4, -W / 2 - 1.3, -0.5, 0.1);
  put(K("covered_car"), -L / 2 + 6 + 1.5, -W / 2 - 17.2, Math.PI / 2, 0.06);
  // yard lighting: 8 m steel columns with an outreach arm and a flat LED head, as on industrial sites
  const galv = new THREE.MeshStandardMaterial({ color: "#a9b1b8", roughness: 0.45, metalness: 0.85 });
  const column = () => {
    const g = new THREE.Group();
    const base = box(0.34, 0.5, 0.34, galv); base.position.y = 0.25; g.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 8, 12), galv); pole.position.y = 4; pole.castShadow = true; g.add(pole);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.5, 8), galv); arm.rotation.z = -Math.PI / 2 + 0.12; arm.position.set(0.7, 8.05, 0); arm.castShadow = true; g.add(arm);
    const head = box(0.7, 0.07, 0.3, new THREE.MeshStandardMaterial({ color: "#3a4148", roughness: 0.5, metalness: 0.6 })); head.position.set(1.5, 8.12, 0); head.rotation.z = 0.1; g.add(head);
    const lens = box(0.58, 0.012, 0.22, new THREE.MeshStandardMaterial({ color: "#f4f6f1", emissive: "#f4f6f1", emissiveIntensity: 0.35, roughness: 0.2 })); lens.position.set(1.5, 8.08, 0); lens.rotation.z = 0.1; g.add(lens);
    return g;
  };
  for (const [x, y] of [[-60, -42], [0, -42], [60, -42], [-60, 42], [0, 42], [60, 42], [-62, 0], [62, 0]] as const) {
    const cx = x * (fb.max.x / 70), cy = y * (fb.max.y / 50);
    put(column(), cx, cy, Math.atan2(-cy, -cx), 0.05); // arm reaches into the yard
  }

  // ---- fence: scanned chain-link panels and posts every 2 m along the measured line, with a gap at the gate
  const fenceKit = a.kit.modular_chainlink_fence!;
  const panel = piece(fenceKit, ["modular_chainlink_fence_double"]), post = piece(fenceKit, ["modular_chainlink_fence_post"]);
  const pw = (panel.userData.size as THREE.Vector3).x, ph = (panel.userData.size as THREE.Vector3).y;
  const gate = new THREE.Vector2(c.gate.at[0], c.gate.at[1]);
  const pm: THREE.Matrix4[] = [], qm: THREE.Matrix4[] = [], gatePosts: THREE.Vector2[] = [];
  const pts = c.fence.map(([e, n]) => new THREE.Vector2(e, n));
  const fh = c.fence_height;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[i]!, p1 = pts[i + 1]!, n = Math.max(1, Math.round(p0.distanceTo(p1) / 2));
    for (let k = 0; k < n; k++) {
      const s0 = p0.clone().lerp(p1, k / n), s1 = p0.clone().lerp(p1, (k + 1) / n), mid = s0.clone().add(s1).multiplyScalar(0.5);
      const inGate = mid.distanceTo(gate) < c.gate.width / 2 + 0.4;
      if (inGate) { if (s0.distanceTo(gate) >= c.gate.width / 2 - 0.4) gatePosts.push(s0); if (s1.distanceTo(gate) >= c.gate.width / 2 - 0.4) gatePosts.push(s1); continue; }
      const a0 = P(s0.x, s0.y), a1 = P(s1.x, s1.y), d = a1.clone().sub(a0);
      const basis = new THREE.Matrix4().makeBasis(d.clone().normalize(), new THREE.Vector3(0, 1, 0), new THREE.Vector3().crossVectors(d.clone().normalize(), new THREE.Vector3(0, 1, 0)).normalize());
      pm.push(new THREE.Matrix4().compose(a0.clone().add(a1).multiplyScalar(0.5), new THREE.Quaternion().setFromRotationMatrix(basis), new THREE.Vector3(d.length() / pw, fh / ph, 1)));
      qm.push(new THREE.Matrix4().compose(a0, new THREE.Quaternion(), new THREE.Vector3(1, (fh + 0.1) / ph, 1)));
    }
  }
  const wire = (m: THREE.Material) => {
    const s = m as THREE.MeshStandardMaterial;
    if (!/wire/i.test(s.name)) return m;
    const w = s.clone(); w.alphaMap = a.wireAlpha; w.alphaTest = 0.45; w.transparent = false; w.side = THREE.DoubleSide; w.depthWrite = true;
    return w;
  };
  root.add(instances(panel, pm, wire), instances(post, qm));
  // gate: heavier posts, concrete barriers in a chicane, a boom raised
  const gin = new THREE.Vector2(-gate.x, -gate.y).normalize(); // into the yard
  const along = new THREE.Vector2(-gin.y, gin.x);
  const barrier = K("concrete_road_barrier_02");
  for (const [da, di, yaw] of [[-2.6, -5, 0.15], [2.6, -9, -0.12], [-2.8, 7, 0.1], [2.8, 11, -0.2]] as const) {
    const b = barrier.clone(true), q = gate.clone().addScaledVector(along, da).addScaledVector(gin, di);
    b.position.copy(P(q.x, q.y, 0.05)); b.rotation.y = yawX(along) + yaw; b.scale.setScalar(1.1); root.add(b);
  }
  const steelPost = new THREE.MeshStandardMaterial({ color: "#8d959d", roughness: 0.4, metalness: 0.8 });
  for (const s of [-1, 1]) {
    const q = gate.clone().addScaledVector(along, s * (c.gate.width / 2 + 0.1));
    const gp = box(0.22, fh + 0.5, 0.22, steelPost); gp.position.copy(P(q.x, q.y, (fh + 0.5) / 2)); root.add(gp);
  }
  { const q = gate.clone().addScaledVector(along, -c.gate.width / 2 + 0.6).addScaledVector(gin, 1.2);
    const base = box(0.4, 1.1, 0.4, new THREE.MeshStandardMaterial({ color: "#d9a514", roughness: 0.5 })); base.position.copy(P(q.x, q.y, 0.55)); root.add(base);
    const arm = new THREE.Group(); arm.position.copy(P(q.x, q.y, 1.0)); arm.rotation.order = "YXZ"; arm.rotation.y = yawX(along); arm.rotation.z = 1.25;
    for (let k = 0; k < 6; k++) { const seg = box(1.0, 0.1, 0.06, new THREE.MeshStandardMaterial({ color: k % 2 ? "#f2f2ee" : "#c8251d", roughness: 0.5 })); seg.position.x = 0.5 + k; arm.add(seg); }
    root.add(arm); }
  // gate hut: steel cabin with glazing on three sides
  { const g = new THREE.Vector2(c.guard_post.at[0]!, c.guard_post.at[1]!).addScaledVector(along, 3.2);
    const hut = new THREE.Group(); hut.position.copy(P(g.x, g.y, 0.08)); hut.rotation.y = yawX(gin);
    const body = box(2.6, 1.0, 2.4, new THREE.MeshStandardMaterial({ color: "#e6e9ec", roughness: 0.55, metalness: 0.2 })); body.position.y = 0.5; hut.add(body);
    const glass = box(2.5, 1.1, 2.3, new THREE.MeshStandardMaterial({ color: "#17242e", roughness: 0.06, metalness: 0.7, transparent: true, opacity: 0.75 })); glass.position.y = 1.55; hut.add(glass);
    for (const [x, z] of [[-1.26, -1.16], [1.26, -1.16], [-1.26, 1.16], [1.26, 1.16]] as const) { const p = box(0.1, 1.1, 0.1, trim); p.position.set(x, 1.55, z); hut.add(p); }
    const top = box(3.0, 0.14, 2.8, trim); top.position.y = 2.17; hut.add(top);
    root.add(hut); }

  // ---- sensors and equipment stations
  for (const m of c.masts) {
    const o = mastObject(m.height, "#b08cff");
    o.traverse((x) => { const y = x as THREE.Mesh; if (y.isMesh) { y.castShadow = true; y.receiveShadow = true; } });
    const f = (m.facing_deg * Math.PI) / 180;
    o.position.copy(P(m.at[0]!, m.at[1]!, 0.02)); o.rotation.y = yawX(new THREE.Vector2(Math.sin(f), Math.cos(f))); root.add(o);
  }
  { const [e, n] = [c.drone_pad.at[0]!, c.drone_pad.at[1]!], r = c.drone_pad.size / 2;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.14, 40), pbr(a, "concrete_floor_worn_001", { color: "#9fa3a6", metalness: 0 })); pad.position.copy(P(e, n, 0.1)); pad.receiveShadow = true; root.add(pad);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.45, r - 0.25, 48), paint("#f0c419")); ring.rotation.x = -Math.PI / 2; ring.position.copy(P(e, n, 0.18)); root.add(ring);
    for (const [w, d, x] of [[0.22, 1.5, -0.55], [0.22, 1.5, 0.55], [1.1, 0.22, 0]] as const) { const h = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint("#f0f0ec")); h.rotation.x = -Math.PI / 2; h.position.copy(P(e, n, 0.185)).add(new THREE.Vector3(x, 0, 0)); root.add(h); } }
  { const dk = new THREE.Group(); dk.position.copy(P(c.dog_dock.at[0]!, c.dog_dock.at[1]! + 1.6, 0.06)); dk.rotation.y = yawX(ux);
    const shell = box(1.3, 0.08, 0.9, trim); shell.position.y = 0.04; dk.add(shell);
    const back = box(1.3, 0.75, 0.1, pbr(a, "painted_metal_shutter", { color: "#e3e6e8" })); back.position.set(0, 0.42, -0.42); dk.add(back);
    const led = box(0.5, 0.04, 0.02, new THREE.MeshStandardMaterial({ color: "#39d98a", emissive: "#39d98a", emissiveIntensity: 1.4 })); led.position.set(0, 0.62, -0.36); dk.add(led);
    root.add(dk); }
  return root;
}
