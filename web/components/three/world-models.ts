import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * Equipment and people at true size. Local +X is forward, +Y up, feet or wheels on y = 0.
 *
 *   Robot dog  Unitree Go2 meshes (BSD-3-Clause, (c) Unitree Robotics, via MuJoCo Menagerie); legs driven here
 *   Drone      Skydio X2 mesh (Apache-2.0, via MuJoCo Menagerie)
 *   People     Microsoft Rocketbox avatars and animations (MIT, (c) 2020 Microsoft): a uniformed security guard and
 *              a civilian, loaded from FBX with their own textures. Fallback: CesiumMan body and walk cycle
 *              (CC BY 4.0, (c) 2017 Cesium) with plain colours, used if the avatars are not available.
 *   Vehicle, camera mast: modelled here from shaped profiles
 *
 * These are looks only. The sim's speeds, batteries and sensors are class assumptions, not these products' data.
 */

export type People = { guard: THREE.Object3D; person: THREE.Object3D; worker: THREE.Object3D; walk: THREE.AnimationClip | null; idle: THREE.AnimationClip | null };
export type Models = { go2: GLTF; x2: GLTF; man: GLTF; people?: People };
export type Rig = { object: THREE.Object3D; update: (metres: number, moving: boolean) => void; dispose: () => void };

const cache = new Map<string, Promise<Models>>();
export function loadModels(base: string, peopleBase?: string): Promise<Models> {
  const key = `${base}|${peopleBase ?? ""}`;
  let p = cache.get(key);
  if (!p) {
    const l = new GLTFLoader();
    const people = peopleBase ? loadPeople(peopleBase).catch(() => undefined) : Promise.resolve(undefined);
    p = Promise.all([...["go2", "x2", "man"].map((n) => l.loadAsync(`${base}/${n}.glb`)), people])
      .then(([go2, x2, man, ppl]) => ({ go2: go2 as GLTF, x2: x2 as GLTF, man: man as GLTF, people: ppl as People | undefined }));
    cache.set(key, p);
    p.catch(() => { cache.delete(key); });
  }
  return p;
}

// ---------------------------------------------------------------- people (Microsoft Rocketbox, FBX)

const BLANK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const AVATARS: Record<"guard" | "person" | "worker", { name: string; parts: string[] }> = {
  worker: { name: "Construction_Male_03", parts: ["body", "head", "helmet", "tools"] },
  guard: { name: "Security_Male_01", parts: ["body", "head", "equipment"] },
  person: { name: "Male_Adult_08", parts: ["body", "head", "opacity"] },
};

async function loadPeople(base: string): Promise<People> {
  // the FBX files name their original TGA textures; those are not shipped, so their URLs resolve to a blank pixel
  // and the web-sized textures are attached by material name below
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (/\.(tga|png|jpe?g|bmp|dds|tif)$/i.test(url) ? BLANK : url));
  manager.addHandler(/\.tga$/i, new THREE.TextureLoader(manager));
  const fbx = new FBXLoader(manager), tex = new THREE.TextureLoader();
  const map = (url: string, srgb: boolean) => { const t = tex.load(url); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const avatar = async ({ name, parts }: { name: string; parts: string[] }) => {
    const o = await fbx.loadAsync(`${base}/${name}/${name}.fbx`);
    const mats: Record<string, THREE.Material> = {};
    for (const part of parts) {
      mats[part] = part === "opacity"
        ? new THREE.MeshStandardMaterial({ map: map(`${base}/${name}/opacity_color.png`, true), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.8 })
        : new THREE.MeshStandardMaterial({ map: map(`${base}/${name}/${part}_color.jpg`, true), normalMap: map(`${base}/${name}/${part}_normal.jpg`, false), roughness: 0.78, metalness: 0 });
    }
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const pick = (m: THREE.Material) => {
      const n = m.name.toLowerCase();
      const part = parts.find((p) => n.includes(p));
      return part ? mats[part]! : n.includes("opacity") ? hidden : new THREE.MeshStandardMaterial({ color: "#555a60", roughness: 0.8 });
    };
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = Array.isArray(m.material) ? m.material.map(pick) : pick(m.material);
      m.castShadow = true; m.frustumCulled = false;
    });
    return o;
  };
  const clip = async (file: string) => {
    try {
      const a = (await fbx.loadAsync(`${base}/anim/${file}`)).animations[0] ?? null;
      if (!a) return null;
      a.tracks = a.tracks.filter((t) => !t.name.startsWith("MotionExtractionHelper")); // a helper node the avatars do not have
      // walk on the spot: the sim moves the person, so the hips keep their first horizontal position
      for (const t of a.tracks) {
        if (!/^Bip01\.position$/.test(t.name)) continue;
        const v = t.values;
        for (let i = 3; i < v.length; i += 3) { v[i] = v[0]!; v[i + 2] = v[2]!; }
      }
      return a;
    } catch { return null; }
  };
  const [guard, person, worker, walk, idle] = await Promise.all([avatar(AVATARS.guard), avatar(AVATARS.person), avatar(AVATARS.worker), clip("m_walk_neutral.fbx"), clip("m_idle_neutral_01.fbx")]);
  return { guard, person, worker, walk, idle };
}

function rocketRig(src: THREE.Object3D, people: People): Rig {
  const object = new THREE.Group();
  const model = cloneSkinned(src) as THREE.Object3D;
  const fit = () => new THREE.Box3().setFromObject(model);
  let b = fit();
  if (b.max.z - b.min.z > (b.max.y - b.min.y) * 1.5) { model.rotation.x = -Math.PI / 2; model.updateMatrixWorld(true); b = fit(); } // exported lying down
  const k = HEIGHT / (b.max.y - b.min.y);
  model.scale.multiplyScalar(k);
  model.position.set(-((b.min.x + b.max.x) / 2) * k, -b.min.y * k, -((b.min.z + b.max.z) / 2) * k);
  const turn = new THREE.Group(); // the avatars face +Z; forward here is +X
  turn.rotation.y = Math.PI / 2;
  turn.add(model);
  object.add(turn);
  const mixer = new THREE.AnimationMixer(model);
  const walk = people.walk ? mixer.clipAction(people.walk) : null, idle = people.idle ? mixer.clipAction(people.idle) : null;
  walk?.play(); idle?.play();
  let w = 0, last = performance.now();
  const apply = () => { walk?.setEffectiveWeight(idle ? w : 1); idle?.setEffectiveWeight(1 - w); mixer.update(0); };
  apply();
  return {
    object,
    update(metres, moving) {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      w += ((moving ? 1 : 0) - w) * 0.2;
      if (walk && people.walk) walk.time = (walk.time + metres / 1.35) % people.walk.duration; // the clip walks at about 1.35 m/s
      if (idle && people.idle) idle.time = (idle.time + dt) % people.idle.duration;
      apply();
    },
    dispose() { mixer.stopAllAction(); },
  };
}

const std = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...o });
function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}
function disposeTree(o: THREE.Object3D, geometryOnly = false) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    if (!geometryOnly) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
  });
}

// ---------------------------------------------------------------- robot dog (Unitree Go2)

const THIGH = 0.82, CALF = -1.64, LEG = 0.213, FOOT = 0.022;
const STAND = LEG * Math.cos(THIGH) + LEG * Math.cos(THIGH + CALF) + FOOT;
const Y = new THREE.Vector3(0, 1, 0);

function dogRig(src: GLTF): Rig {
  const object = new THREE.Group();
  const model = src.scene.clone(true);
  model.position.y = STAND;
  object.add(model);
  const joint = (n: string) => { const o = model.getObjectByName(n); return o ? { o, rest: o.quaternion.clone() } : null; };
  // trot: diagonal pairs move together
  const legs = (["FL", "RR", "FR", "RL"] as const).map((leg, i) => ({ thigh: joint(`${leg}_thigh`), calf: joint(`${leg}_calf`), phase: i < 2 ? 0 : Math.PI }));
  const q = new THREE.Quaternion();
  let s = 0, gait = 0;
  const pose = () => {
    for (const l of legs) {
      const a = s + l.phase;
      const swing = Math.max(0, Math.sin(a)); // foot off the ground on the forward half of the cycle
      const thigh = THIGH - gait * 0.3 * Math.cos(a);
      const calf = CALF - gait * 0.45 * swing;
      l.thigh?.o.quaternion.copy(l.thigh.rest).multiply(q.setFromAxisAngle(Y, thigh));
      l.calf?.o.quaternion.copy(l.calf.rest).multiply(q.setFromAxisAngle(Y, calf));
    }
    model.position.y = STAND + gait * 0.008 * Math.sin(2 * s);
  };
  pose();
  return {
    object,
    update(metres, moving) {
      s += (metres / 0.55) * Math.PI * 2; // one gait cycle per 0.55 m
      gait += ((moving ? 1 : 0) - gait) * 0.25;
      pose();
    },
    dispose() { /* geometry and materials belong to the shared source model */ },
  };
}

// ---------------------------------------------------------------- drone (Skydio X2)

function droneRig(src: GLTF): Rig {
  const object = new THREE.Group();
  const model = src.scene.clone(true);
  model.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) { const mat = (m.material as THREE.MeshStandardMaterial).clone(); mat.alphaTest = 0.08; mat.transparent = true; mat.side = THREE.DoubleSide; m.material = mat; }
  });
  object.add(model);
  let tilt = 0;
  return {
    object,
    update(_m, moving) { tilt += ((moving ? -0.14 : 0) - tilt) * 0.15; model.rotation.z = tilt; }, // nose down when flying forward
    dispose() { model.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).dispose(); }); },
  };
}

// ---------------------------------------------------------------- people (CesiumMan body, own colours)

const HEIGHT = 1.78, SRC_HEIGHT = 1.507;
type Outfit = { cap: string; top: string; sleeve: string; band: string | null; legs: string };
const OUTFITS: Record<string, Outfit> = {
  guard: { cap: "#17243a", top: "#d2de1f", sleeve: "#1f3050", band: "#d5dae0", legs: "#1c222d" }, // hi-vis vest over a navy uniform
  person: { cap: "#2a2019", top: "#6c7079", sleeve: "#6c7079", band: null, legs: "#33455c" }, // hoodie and jeans
};
const SKIN = "#dfb391", BOOT = "#121417";

function colourBody(mesh: THREE.SkinnedMesh, outfit: Outfit) {
  const g = mesh.geometry.clone();
  const pos = g.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(), c = new THREE.Color();
  mesh.updateWorldMatrix(true, false);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); // bind pose, y up, arms out along x
    // measured on the model: feet < 0.10, legs to 0.72, torso to 1.11, neck to 1.17, a large head above;
    // arms slope down from the shoulders (|x| > 0.21), hands beyond |x| = 0.5; the face is on +z
    const ax = Math.abs(p.x);
    let hex: string;
    if (p.y > 1.17) hex = p.y > 1.4 || (p.z < -0.03 && p.y > 1.24) ? outfit.cap : SKIN;
    else if (p.y > 1.11) hex = SKIN;
    else if (ax > 0.21) hex = ax > 0.5 ? SKIN : outfit.sleeve;
    else if (p.y > 0.72) hex = outfit.band && p.y > 0.85 && p.y < 0.9 ? outfit.band : outfit.top;
    else if (p.y > 0.1) hex = outfit.legs;
    else hex = BOOT;
    c.set(hex);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  mesh.geometry = g;
  mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  mesh.frustumCulled = false; // the bounding sphere is the bind pose's, not the animated one's
}

function personRig(src: GLTF, kind: string): Rig {
  const object = new THREE.Group();
  const model = cloneSkinned(src.scene) as THREE.Object3D;
  model.updateMatrixWorld(true);
  model.traverse((c) => { if ((c as THREE.SkinnedMesh).isSkinnedMesh) colourBody(c as THREE.SkinnedMesh, OUTFITS[kind] ?? OUTFITS.person!); });
  model.scale.setScalar(HEIGHT / SRC_HEIGHT);
  model.rotation.y = Math.PI / 2; // the source faces +Z
  object.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const clip = src.animations[0];
  const action = clip ? mixer.clipAction(clip) : null;
  action?.play();
  const cycle = 1.5 * (HEIGHT / SRC_HEIGHT); // metres walked in one clip (two steps)
  let t = 0;
  mixer.setTime(0);
  return {
    object,
    update(metres) { if (!clip) return; t = (t + (metres / cycle) * clip.duration) % clip.duration; mixer.setTime(t); },
    dispose() { mixer.stopAllAction(); model.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }); },
  };
}

// ---------------------------------------------------------------- patrol vehicle (double-cab pickup, modelled here)

function extrude(shape: THREE.Shape, width: number, bevel: number, m: THREE.Material) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 20 });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  return new THREE.Mesh(g, m);
}

function vehicleRig(): Rig {
  const object = new THREE.Group();
  const paint = std("#eef1f4", { roughness: 0.35, metalness: 0.3 });
  const dark = std("#14181d", { roughness: 0.6 });
  const glass = std("#0e1a24", { roughness: 0.08, metalness: 0.6 });
  const trim = std("#2a3038", { roughness: 0.5 });
  const R = 0.39, WB = 1.62, W = 1.86; // tyre radius, half wheelbase, body width
  // body side profile, front at +X: bumper, bonnet, scuttle, bed, tail, sill with two wheel arches
  const s = new THREE.Shape();
  s.moveTo(-2.62, 0.5);
  s.lineTo(-2.66, 1.04); s.lineTo(-2.6, 1.1);
  s.lineTo(1.02, 1.1);
  s.quadraticCurveTo(1.9, 1.06, 2.5, 0.92);
  s.quadraticCurveTo(2.66, 0.86, 2.66, 0.66);
  s.lineTo(2.62, 0.42);
  s.lineTo(WB + 0.5, 0.42);
  s.absarc(WB, 0.42, 0.5, 0, Math.PI, false);
  s.lineTo(-WB + 0.5, 0.42);
  s.absarc(-WB, 0.42, 0.5, 0, Math.PI, false);
  s.lineTo(-2.62, 0.42);
  object.add(extrude(s, W, 0.05, paint));
  // cab: glasshouse in dark glass, with painted roof and pillars over it
  const c = new THREE.Shape();
  c.moveTo(1.02, 1.08); c.lineTo(0.42, 1.74); c.quadraticCurveTo(0.36, 1.8, 0.24, 1.8);
  c.lineTo(-0.92, 1.8); c.quadraticCurveTo(-1.04, 1.8, -1.06, 1.7); c.lineTo(-1.12, 1.08);
  object.add(extrude(c, W - 0.22, 0.03, glass));
  const roof = new THREE.Shape();
  roof.moveTo(0.44, 1.74); roof.quadraticCurveTo(0.38, 1.83, 0.24, 1.83); roof.lineTo(-0.92, 1.83); roof.quadraticCurveTo(-1.06, 1.83, -1.08, 1.72);
  roof.lineTo(-1.02, 1.72); roof.lineTo(-0.9, 1.77); roof.lineTo(0.22, 1.77); roof.lineTo(0.38, 1.72);
  object.add(extrude(roof, W - 0.18, 0.02, paint));
  for (const z of [-1, 1]) {
    const side = (W - 0.2) / 2;
    const a = box(0.09, 0.95, 0.05, paint, 0.72, 1.42, z * side); a.rotation.z = 0.74; object.add(a); // A pillar follows the windscreen
    object.add(box(0.11, 0.7, 0.05, paint, -0.02, 1.43, z * side)); // B pillar
    object.add(box(0.13, 0.72, 0.05, paint, -1.07, 1.43, z * side)); // C pillar
    object.add(box(0.2, 0.12, 0.1, dark, 0.86, 1.2, z * (W / 2 + 0.07))); // mirror
    object.add(box(3.3, 0.045, 0.02, std("#1f4f9e", { roughness: 0.4 }), -0.6, 0.88, z * (W / 2 + 0.001))); // side stripe
    object.add(box(0.12, 0.03, 0.02, trim, 0.25, 1.0, z * (W / 2 + 0.005))); // door handles
    object.add(box(0.12, 0.03, 0.02, trim, -0.65, 1.0, z * (W / 2 + 0.005)));
    const lamp = box(0.06, 0.12, 0.3, new THREE.MeshStandardMaterial({ color: "#fff7df", emissive: "#fff2c4", emissiveIntensity: 0.9 }), 2.6, 0.84, z * 0.66); object.add(lamp);
    object.add(box(0.05, 0.22, 0.12, new THREE.MeshStandardMaterial({ color: "#a01212", emissive: "#700808", emissiveIntensity: 0.7 }), -2.66, 0.92, z * 0.82));
  }
  object.add(box(0.06, 0.2, 1.0, dark, 2.64, 0.82, 0)); // grille
  object.add(box(0.2, 0.2, W + 0.02, trim, 2.6, 0.5, 0)); // front bumper
  object.add(box(0.16, 0.18, W + 0.02, trim, -2.6, 0.52, 0)); // rear bumper
  object.add(box(1.38, 0.06, W - 0.18, dark, -1.86, 1.1, 0)); // load bed cover
  object.add(box(0.05, 0.3, W - 0.3, dark, -1.14, 1.25, 0)); // bed bulkhead
  object.add(box(0.14, 0.035, 1.5, trim, 0.0, 1.855, 0)); // roof bar feet
  const amber = new THREE.MeshStandardMaterial({ color: "#ffb21a", emissive: "#ff9a00", emissiveIntensity: 0.6, roughness: 0.3 });
  object.add(box(0.22, 0.09, 1.1, amber, 0.0, 1.915, 0)); // amber beacon bar
  const mastA = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.75, 6), dark); mastA.position.set(-0.8, 2.2, 0.6); object.add(mastA); // radio aerial
  // wheels: tyre, rim and hub; they turn with the distance driven
  const tyreG = new THREE.CylinderGeometry(R, R, 0.27, 28), rimG = new THREE.CylinderGeometry(0.25, 0.25, 0.28, 20), hubG = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 10);
  const spokeG = new THREE.BoxGeometry(0.44, 0.285, 0.06);
  const tyre = std("#0c0e10", { roughness: 0.95 }), rim = std("#9aa2ab", { roughness: 0.3, metalness: 0.8 });
  const wheels: THREE.Group[] = [];
  for (const x of [WB, -WB]) for (const z of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(x, R, z * (W / 2 - 0.13));
    const spin = new THREE.Group();
    for (const [gm, mt] of [[tyreG, tyre], [rimG, rim], [hubG, dark]] as const) { const m = new THREE.Mesh(gm, mt); m.rotation.x = Math.PI / 2; spin.add(m); }
    for (let k = 0; k < 3; k++) { const sp = new THREE.Mesh(spokeG, dark); sp.rotation.x = Math.PI / 2; sp.rotation.y = (k * Math.PI) / 3; spin.add(sp); }
    w.add(spin); wheels.push(spin); object.add(w);
  }
  return {
    object,
    update(metres) { for (const w of wheels) w.rotation.z -= metres / R; },
    dispose() { disposeTree(object); },
  };
}

// ---------------------------------------------------------------- camera mast (modelled here)

export function mastObject(height: number, color: string): THREE.Object3D {
  const g = new THREE.Group();
  const steel = std("#aab3bc", { roughness: 0.4, metalness: 0.7 }), dark = std("#1a1f25"), white = std("#eef1f4", { roughness: 0.4 });
  g.add(box(0.5, 0.06, 0.5, std("#8c949c"), 0, 0.03, 0));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.1, height, 12), steel); pole.position.y = height / 2; g.add(pole);
  g.add(box(0.3, 0.42, 0.2, white, -0.12, 1.5, 0)); // equipment cabinet
  const head = new THREE.Group(); head.position.set(0, height, 0);
  head.add(box(0.5, 0.05, 0.05, steel, 0.2, 0, 0)); // bracket, camera looks along +X
  const cam = new THREE.Group(); cam.position.set(0.42, -0.02, 0); cam.rotation.z = -0.3; // pitched down
  cam.add(box(0.42, 0.16, 0.16, white, 0, 0, 0));
  cam.add(box(0.48, 0.02, 0.2, white, 0.02, 0.09, 0)); // sun shield
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 16), dark); lens.rotation.z = Math.PI / 2; lens.position.x = 0.22; cam.add(lens);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), new THREE.MeshBasicMaterial({ color })); led.position.set(0.21, 0.06, 0.05); cam.add(led);
  head.add(cam);
  const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 6), dark); aerial.position.set(-0.04, 0.3, 0); head.add(aerial);
  const panel = box(0.5, 0.02, 0.36, std("#16233a", { roughness: 0.2, metalness: 0.5 }), -0.3, -0.5, 0); panel.rotation.z = 0.5; head.add(panel); // solar panel
  g.add(head);
  return g;
}

// ---------------------------------------------------------------- visiting goods truck (rigid box truck, modelled here)

function truckRig(): Rig {
  const object = new THREE.Group();
  const cabP = std("#c7ccd2", { roughness: 0.4, metalness: 0.3 }), boxP = std("#f2f3f1", { roughness: 0.6 });
  const dark = std("#15191e", { roughness: 0.6 }), glass = std("#0e1a24", { roughness: 0.08, metalness: 0.6 }), steel = std("#3b4249", { roughness: 0.5, metalness: 0.6 });
  const R = 0.5, W = 2.45;
  object.add(box(7.4, 0.22, 0.9, steel, -0.5, 0.95, 0)); // chassis rails
  const body = box(6.2, 2.7, W, boxP, -1.3, 2.5, 0); object.add(body); // cargo box
  object.add(box(6.24, 0.08, W + 0.04, steel, -1.3, 1.13, 0));
  object.add(box(0.06, 2.6, W - 0.1, std("#d9dbd8", { roughness: 0.5 }), -4.41, 2.5, 0)); // rear doors
  object.add(box(0.03, 2.5, 0.04, steel, -4.43, 2.5, 0));
  const cab = new THREE.Shape(); // cab profile, front at +X
  cab.moveTo(1.95, 0.75); cab.lineTo(1.95, 2.55); cab.quadraticCurveTo(1.98, 2.95, 2.4, 2.98); cab.lineTo(3.3, 2.98);
  cab.quadraticCurveTo(3.62, 2.95, 3.72, 2.5); cab.lineTo(3.95, 1.75); cab.lineTo(4.0, 0.9); cab.lineTo(3.9, 0.75);
  object.add(extrude(cab, W - 0.05, 0.05, cabP));
  const ws = box(0.05, 0.85, W - 0.4, glass, 3.82, 2.2, 0); ws.rotation.z = 0.3; object.add(ws); // windscreen
  for (const z of [-1, 1]) {
    object.add(box(0.95, 0.75, 0.03, glass, 2.95, 2.25, z * (W / 2 - 0.02)));
    object.add(box(0.14, 0.36, 0.18, dark, 3.55, 2.3, z * (W / 2 + 0.16)));
    object.add(box(0.07, 0.14, 0.34, new THREE.MeshStandardMaterial({ color: "#fff7df", emissive: "#fff2c4", emissiveIntensity: 0.8 }), 4.0, 1.05, z * 0.85));
    object.add(box(0.05, 0.2, 0.14, new THREE.MeshStandardMaterial({ color: "#a01212", emissive: "#700808", emissiveIntensity: 0.6 }), -4.45, 1.25, z * 1.0));
    object.add(box(2.2, 0.5, 0.05, steel, -1.4, 0.72, z * (W / 2 - 0.05))); // side under-run guard
  }
  object.add(box(0.2, 0.3, W, dark, 3.95, 0.72, 0)); // front bumper
  object.add(box(0.12, 0.14, W, steel, -4.4, 0.75, 0)); // rear under-run bar
  const tyreG = new THREE.CylinderGeometry(R, R, 0.3, 28), rimG = new THREE.CylinderGeometry(0.3, 0.3, 0.31, 18);
  const tyre = std("#0c0e10", { roughness: 0.95 }), rim = std("#8f979f", { roughness: 0.35, metalness: 0.8 });
  const wheels: THREE.Group[] = [];
  for (const [x, zs] of [[3.0, [1.07]], [-2.6, [1.07, 0.74]]] as const) for (const zz of zs) for (const z of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(x, R, z * zz);
    for (const [gm, mt] of [[tyreG, tyre], [rimG, rim]] as const) { const m = new THREE.Mesh(gm, mt); m.rotation.x = Math.PI / 2; w.add(m); }
    wheels.push(w); object.add(w);
  }
  return { object, update(metres) { for (const w of wheels) w.rotation.z -= metres / R; }, dispose() { disposeTree(object); } };
}

export function makeRig(kind: string, models: Models): Rig {
  if (kind === "dog") return dogRig(models.go2);
  if (kind === "drone") return droneRig(models.x2);
  if (kind === "vehicle") return vehicleRig();
  if (kind === "truck") return truckRig();
  if (models.people) return rocketRig(kind === "guard" ? models.people.guard : kind === "worker" ? models.people.worker : models.people.person, models.people);
  return personRig(models.man, kind === "guard" ? "guard" : "person");
}
