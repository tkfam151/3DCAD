// Parametric regeneration: replays the feature timeline with the Manifold
// geometry kernel and returns plain mesh data for display/export.

import { Matrix4, Vector3, Euler } from 'three';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { evaluate, evaluateParameters } from './expr.js';

const AXIS_VEC = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

// ---------- sketch frames ----------

/** Returns {origin, u, v, n} for a sketch's plane params. */
export function sketchFrame(params, scope = {}) {
  let u, v, n, origin;
  const plane = params.plane || 'XY';
  if (plane === 'XY') { u = [1, 0, 0]; v = [0, 1, 0]; n = [0, 0, 1]; origin = [0, 0, 0]; }
  else if (plane === 'XZ') { u = [1, 0, 0]; v = [0, 0, 1]; n = [0, -1, 0]; origin = [0, 0, 0]; }
  else if (plane === 'YZ') { u = [0, 1, 0]; v = [0, 0, 1]; n = [1, 0, 0]; origin = [0, 0, 0]; }
  else {
    n = new Vector3(...(params.normal || [0, 0, 1])).normalize();
    let x = new Vector3(...(params.xDir || [1, 0, 0]));
    x.addScaledVector(n, -x.dot(n));
    if (x.lengthSq() < 1e-9) x = new Vector3(0, 1, 0).addScaledVector(n, -n.y);
    x.normalize();
    const y = new Vector3().crossVectors(n, x);
    u = x.toArray(); v = y.toArray(); n = n.toArray();
    origin = params.origin || [0, 0, 0];
  }
  let off = 0;
  try { off = evaluate(params.offset ?? 0, scope); } catch { off = 0; }
  origin = [origin[0] + n[0] * off, origin[1] + n[1] * off, origin[2] + n[2] * off];
  return { origin, u, v, n };
}

export function frameMatrix(fr) {
  const m = new Matrix4();
  m.set(
    fr.u[0], fr.v[0], fr.n[0], fr.origin[0],
    fr.u[1], fr.v[1], fr.n[1], fr.origin[1],
    fr.u[2], fr.v[2], fr.n[2], fr.origin[2],
    0, 0, 0, 1,
  );
  return m;
}

/** Build an orthonormal custom-plane frame from a face hit (point + normal). */
export function planeFromFace(point, normal) {
  const n = new Vector3(...normal).normalize();
  const cands = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
  cands.sort((a, b) => Math.abs(a.dot(n)) - Math.abs(b.dot(n)));
  const x = cands[0].clone().addScaledVector(n, -cands[0].dot(n)).normalize();
  const p = new Vector3(...point);
  const origin = n.clone().multiplyScalar(n.dot(p));
  return { plane: 'custom', offset: '0', origin: origin.toArray().map(clean), normal: n.toArray().map(clean), xDir: x.toArray().map(clean) };
}

function clean(x) {
  const r = Math.round(x * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

// ---------- sketch shapes -> 2D contours ----------

export function shapeContour(s, segments = 64) {
  switch (s.type) {
    case 'rect': {
      const { x, y, w, h } = s;
      if (!w || !h) return null;
      return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    }
    case 'circle': {
      if (!(s.r > 0)) return null;
      const pts = [];
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        pts.push([s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a)]);
      }
      return pts;
    }
    case 'polygon': {
      const n = Math.max(3, Math.round(s.sides || 6));
      if (!(s.r > 0)) return null;
      const pts = [];
      const a0 = (s.angle || 0) * Math.PI / 180 + Math.PI / 2;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2;
        pts.push([s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a)]);
      }
      return pts;
    }
    case 'slot': {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const len = Math.hypot(dx, dy);
      if (!(s.r > 0)) return null;
      const base = len > 1e-9 ? Math.atan2(dy, dx) : 0;
      const half = Math.max(8, Math.round(segments / 2));
      const pts = [];
      for (let i = 0; i <= half; i++) {
        const a = base - Math.PI / 2 + (i / half) * Math.PI;
        pts.push([s.x2 + s.r * Math.cos(a), s.y2 + s.r * Math.sin(a)]);
      }
      for (let i = 0; i <= half; i++) {
        const a = base + Math.PI / 2 + (i / half) * Math.PI;
        pts.push([s.x1 + s.r * Math.cos(a), s.y1 + s.r * Math.sin(a)]);
      }
      return pts;
    }
    case 'poly':
      if (!s.closed || !s.pts || s.pts.length < 3) return null;
      return s.pts.map((p) => [p[0], p[1]]);
    default:
      return null;
  }
}

// ---------- text ----------

const fonts = new Map();
const textCache = new Map();

/** Make a typeface.json font available to sketch text shapes. */
export function registerFont(name, json) {
  fonts.set(name, new Font(json));
  textCache.clear();
}

export function fontNames() { return [...fonts.keys()]; }

/** Contours (outer boundaries and holes) for a text shape, in sketch coordinates. */
function textContours(s, segments = 64) {
  const font = fonts.get(s.font || 'regular') || fonts.values().next().value;
  if (!font || !s.text || !(s.size > 0)) return [];
  const div = Math.max(2, Math.round(segments / 16));
  const key = `${s.font}|${s.size}|${div}|${s.text}`;
  let local = textCache.get(key);
  if (!local) {
    local = [];
    for (const shape of font.generateShapes(String(s.text), s.size)) {
      const { shape: outer, holes } = shape.extractPoints(div);
      for (const ring of [outer, ...holes]) {
        const pts = ring.map((p) => [p.x, p.y]);
        if (pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
        if (pts.length >= 3) local.push(pts);
      }
    }
    if (textCache.size > 200) textCache.clear();
    textCache.set(key, local);
  }
  const a = ((s.angle || 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  return local.map((ring) => ring.map(([x, y]) => [s.x + x * c - y * sn, s.y + x * sn + y * c]));
}

/** All closed contours a shape contributes to the sketch profile. */
export function shapeContours(s, segments = 64) {
  if (s.type === 'text') return textContours(s, segments);
  const c = shapeContour(s, segments);
  return c ? [c] : [];
}

/** Polylines for drawing a shape (one per contour; open polylines included). */
export function shapeOutlines(s, segments = 64) {
  if (s.type === 'text') return textContours(s, segments).map((c) => [...c, c[0]]);
  const o = shapeOutline(s, segments);
  return o.length ? [o] : [];
}

/** Points for drawing a shape outline (open polylines included). */
export function shapeOutline(s, segments = 64) {
  if (s.type === 'poly') {
    const pts = (s.pts || []).map((p) => [p[0], p[1]]);
    if (s.closed && pts.length) pts.push(pts[0]);
    return pts;
  }
  const c = shapeContour(s, segments);
  if (!c) return [];
  return [...c, c[0]];
}

// ---------- base64 helpers for imported meshes ----------

export function encodeArray(typed) {
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function decodeArray(b64, Type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Type(bytes.buffer);
}

// ---------- regeneration ----------

function hash(str) {
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

// Cache for expensive operations (e.g. hollow), keyed by construction history.
const meshCache = new Map();
const CACHE_MAX = 24;
function cacheGet(key) {
  const v = meshCache.get(key);
  if (v) { meshCache.delete(key); meshCache.set(key, v); }
  return v;
}
function cachePut(key, mesh) {
  meshCache.set(key, { vertProperties: new Float32Array(mesh.vertProperties), triVerts: new Uint32Array(mesh.triVerts), numProp: mesh.numProp });
  while (meshCache.size > CACHE_MAX) meshCache.delete(meshCache.keys().next().value);
}

export function regenerate(doc, wasm) {
  const { Manifold, CrossSection, Mesh } = wasm;
  const garbage = [];
  const T = (o) => { garbage.push(o); return o; };
  const segments = doc.settings?.segments || 64;

  const { scope, errors: paramErrors } = evaluateParameters(doc.parameters);
  const errors = {};
  const warnings = {};
  const meshOnly = []; // non-watertight imports, shown for reference only
  const bodies = new Map(); // id -> { id, name, solid, creator }
  const sketches = new Map();
  const consumedSketches = new Set();
  let bodyCounter = 0;

  const nameOf = (id) => doc.bodyProps?.[id]?.name;

  function num(f, key, fallback) {
    const raw = f.params[key];
    if (raw === undefined || raw === '') {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing value: ${key}`);
    }
    try {
      return evaluate(raw, scope);
    } catch (e) {
      throw new Error(`${key}: ${e.message}`);
    }
  }

  const scopeKey = JSON.stringify(scope) + segments;
  let curFeature = null;
  const featureById = new Map(doc.features.map((f) => [f.id, f]));
  const featureKey = () => {
    const sk = curFeature?.params?.sketch && featureById.get(curFeature.params.sketch);
    return JSON.stringify(curFeature) + (sk ? JSON.stringify(sk) : '');
  };

  function addBody(id, solid, creator, key = hash(scopeKey + featureKey() + id)) {
    bodyCounter++;
    bodies.set(id, { id, name: nameOf(id) || `Body${bodyCounter}`, solid, creator, key });
  }

  /** Mark a body as modified by the current feature (updates its history key). */
  function touch(b, extra = '') {
    b.key = hash(b.key + featureKey() + extra);
  }

  function getBody(id, label = 'Target body') {
    if (!id) throw new Error(`Select a ${label.toLowerCase()}`);
    const b = bodies.get(id);
    if (!b) throw new Error(`${label} no longer exists`);
    return b;
  }

  function boolean(a, b, op) {
    if (op === 'join') return T(a.add(b));
    if (op === 'cut') return T(a.subtract(b));
    if (op === 'intersect') return T(a.intersect(b));
    throw new Error(`Unknown operation ${op}`);
  }

  function applyOp(f, solid) {
    const op = f.params.operation || 'new';
    if (solid.isEmpty()) throw new Error('Feature produced no geometry');
    if (op === 'new') {
      addBody(f.id, solid, f.id);
      return;
    }
    const b = getBody(f.params.target);
    b.solid = boolean(b.solid, solid, op);
    touch(b, scopeKey);
  }

  function place(f, solid) {
    const rx = num(f, 'rx', 0), ry = num(f, 'ry', 0), rz = num(f, 'rz', 0);
    let s = solid;
    if (rx || ry || rz) s = T(s.rotate([rx, ry, rz]));
    return T(s.translate([num(f, 'x', 0), num(f, 'y', 0), num(f, 'z', 0)]));
  }

  const torus = (R, r) => {
    if (!(r > 0) || !(R > r)) throw new Error('Ring radius must be larger than tube radius');
    const circle = T(T(CrossSection.circle(r, Math.max(16, segments / 2))).translate([R, 0]));
    return T(circle.revolve(segments));
  };

  function sketchCS(f) {
    const id = f.params.sketch;
    if (!id) throw new Error('Select a profile sketch');
    const sk = sketches.get(id);
    if (!sk) throw new Error('Profile sketch is missing or failed');
    if (!sk.cs || sk.cs.isEmpty()) throw new Error('Sketch has no closed profiles');
    consumedSketches.add(id);
    return sk;
  }

  const toMat4 = (m) => m.elements.slice(); // three.js stores column-major already

  const handlers = {
    sketch(f) {
      const fr = sketchFrame(f.params, scope);
      const contours = [];
      for (const s of f.shapes || []) {
        if (s.construction) continue;
        contours.push(...shapeContours(s, segments));
      }
      const cs = contours.length ? T(new CrossSection(contours, 'EvenOdd')) : null;
      sketches.set(f.id, { id: f.id, name: f.name, frame: fr, shapes: f.shapes || [], cs, area: cs ? cs.area() : 0 });
    },

    extrude(f) {
      const sk = sketchCS(f);
      let cs = sk.cs;
      const rr = num(f, 'cornerRadius', 0);
      if (rr > 0) {
        cs = T(T(cs.offset(-rr, 'Round', 2, segments)).offset(rr, 'Round', 2, segments));
        cs = T(T(cs.offset(rr, 'Round', 2, segments)).offset(-rr, 'Round', 2, segments));
        if (cs.isEmpty()) throw new Error('Corner radius too large for this profile');
      }
      let d = num(f, 'distance');
      if (Math.abs(d) < 1e-9) throw new Error('Distance cannot be zero');
      let dir = f.params.direction || 'one';
      if (d < 0) { d = -d; dir = dir === 'reverse' ? 'one' : dir === 'one' ? 'reverse' : dir; }
      const scaleTop = num(f, 'taper', 100) / 100;
      const twist = num(f, 'twist', 0);
      if (scaleTop < 0) throw new Error('Top scale must be ≥ 0');
      let solid;
      if (scaleTop !== 1 || twist) {
        const b = cs.bounds();
        const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
        const centered = T(cs.translate([-cx, -cy]));
        const divs = twist ? Math.max(1, Math.ceil(Math.abs(twist) / 4)) : 0;
        const h = dir === 'symmetric' ? 2 * d : d;
        solid = T(T(centered.extrude(h, divs, twist, [scaleTop, scaleTop])).translate([cx, cy, 0]));
        if (dir === 'symmetric') solid = T(solid.translate([0, 0, -d]));
      } else {
        solid = dir === 'symmetric' ? T(cs.extrude(2 * d, 0, 0, [1, 1], true)) : T(cs.extrude(d));
      }
      if (dir === 'reverse') solid = T(solid.translate([0, 0, -d]));
      solid = T(solid.transform(toMat4(frameMatrix(sk.frame))));
      applyOp(f, solid);
    },

    revolve(f) {
      const sk = sketchCS(f);
      const angle = num(f, 'angle', 360);
      if (!(angle > 0) || angle > 360) throw new Error('Angle must be between 0 and 360');
      let cs = sk.cs;
      const axisU = f.params.axis === 'U';
      if (axisU) cs = T(cs.rotate(-90));
      // Revolve uses the 2D Y axis; keep the side with the most area
      const b = cs.bounds();
      if (b.max[0] <= 1e-9 && b.min[0] < 0) cs = T(cs.mirror([1, 0]));
      let solid = T(cs.revolve(segments, angle));
      if (solid.isEmpty()) throw new Error('Profile must lie on one side of the axis');
      solid = T(solid.rotate([-90, 0, 0]));
      if (axisU) solid = T(solid.rotate([0, 0, 90]));
      solid = T(solid.transform(toMat4(frameMatrix(sk.frame))));
      applyOp(f, solid);
    },

    box(f) {
      const w = num(f, 'width'), dpt = num(f, 'depth'), h = num(f, 'height');
      if (!(w > 0 && dpt > 0 && h > 0)) throw new Error('Dimensions must be positive');
      const r = num(f, 'fillet', 0);
      let solid;
      if (r > 0) {
        if (r * 2 >= Math.min(w, dpt, h)) throw new Error('Fillet too large');
        const pts = [];
        const seg = Math.max(16, Math.round(segments / 2));
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [0, 1]) {
          pts.push(T(T(Manifold.sphere(r, seg)).translate([sx * (w / 2 - r), sy * (dpt / 2 - r), sz ? h - r : r])));
        }
        solid = T(Manifold.hull(pts));
      } else {
        solid = T(T(Manifold.cube([w, dpt, h], true)).translate([0, 0, h / 2]));
      }
      applyOp(f, place(f, solid));
    },

    cylinder(f) {
      const r = num(f, 'radius'), h = num(f, 'height');
      if (!(r > 0 && h > 0)) throw new Error('Dimensions must be positive');
      const fr = num(f, 'fillet', 0);
      let solid;
      if (fr > 0) {
        if (fr >= r || fr * 2 >= h) throw new Error('Fillet too large');
        const t1 = torus(r - fr, fr);
        solid = T(Manifold.hull([T(t1.translate([0, 0, fr])), T(t1.translate([0, 0, h - fr]))]));
      } else {
        solid = T(Manifold.cylinder(h, r, r, segments));
      }
      applyOp(f, place(f, solid));
    },

    sphere(f) {
      const r = num(f, 'radius');
      if (!(r > 0)) throw new Error('Radius must be positive');
      applyOp(f, place(f, T(Manifold.sphere(r, segments))));
    },

    cone(f) {
      const r = num(f, 'radius'), rt = num(f, 'topRadius', 0), h = num(f, 'height');
      if (!(h > 0) || r < 0 || rt < 0 || (r === 0 && rt === 0)) throw new Error('Invalid dimensions');
      applyOp(f, place(f, T(Manifold.cylinder(h, r, rt, segments))));
    },

    text(f) {
      const words = String(f.params.text ?? '').trim();
      if (!words) throw new Error('Type some text');
      const size = num(f, 'size'), depth = num(f, 'depth');
      if (!(size > 0) || !(depth > 0)) throw new Error('Letter height and thickness must be positive');
      const contours = textContours({ type: 'text', x: 0, y: 0, text: words, size, font: f.params.bold ? 'bold' : 'regular' }, segments);
      if (!contours.length) throw new Error(fonts.size ? 'These characters aren’t in the font' : 'Font not loaded');
      let cs = T(new CrossSection(contours, 'EvenOdd'));
      const b = cs.bounds();
      const align = f.params.align || 'center';
      const dx = align === 'left' ? -b.min[0] : align === 'right' ? -b.max[0] : -(b.min[0] + b.max[0]) / 2;
      cs = T(cs.translate([dx, -b.min[1]]));
      applyOp(f, place(f, T(cs.extrude(depth))));
    },

    torus(f) {
      applyOp(f, place(f, torus(num(f, 'majorRadius'), num(f, 'minorRadius'))));
    },

    move(f) {
      const b = getBody(f.params.target, 'Body');
      const m = moveMatrix(
        [num(f, 'tx', 0), num(f, 'ty', 0), num(f, 'tz', 0)],
        [num(f, 'rx', 0), num(f, 'ry', 0), num(f, 'rz', 0)],
        [num(f, 'px', 0), num(f, 'py', 0), num(f, 'pz', 0)],
      );
      const moved = T(b.solid.transform(toMat4(m)));
      if (f.params.copy) addBody(f.id, moved, f.id, hash(b.key + featureKey() + scopeKey));
      else { b.solid = moved; touch(b, scopeKey); }
    },

    scale(f) {
      const b = getBody(f.params.target, 'Body');
      const s = [num(f, 'sx', 1), num(f, 'sy', 1), num(f, 'sz', 1)];
      if (s.some((v) => !(v > 0))) throw new Error('Scale factors must be positive');
      let c = [0, 0, 0];
      if (f.params.about !== 'origin') {
        const bb = b.solid.boundingBox();
        c = [0, 1, 2].map((i) => (bb.min[i] + bb.max[i]) / 2);
      }
      b.solid = T(T(T(b.solid.translate(c.map((v) => -v))).scale(s)).translate(c));
      touch(b, scopeKey);
    },

    combine(f) {
      const target = getBody(f.params.target);
      const tools = (f.params.tools || []).filter((id) => id !== target.id);
      if (!tools.length) throw new Error('Select at least one tool body');
      for (const id of tools) {
        const tb = getBody(id, 'Tool body');
        target.solid = boolean(target.solid, tb.solid, f.params.operation || 'join');
        touch(target, tb.key);
        if (!f.params.keepTools) bodies.delete(id);
      }
    },

    mirror(f) {
      const b = getBody(f.params.target, 'Body');
      const nrm = { XY: [0, 0, 1], XZ: [0, 1, 0], YZ: [1, 0, 0] }[f.params.plane || 'YZ'];
      const off = num(f, 'offset', 0);
      const o = nrm.map((v) => v * off);
      const mirrored = T(T(T(b.solid.translate(o.map((v) => -v))).mirror(nrm)).translate(o));
      if (f.params.join) { b.solid = T(b.solid.add(mirrored)); touch(b, scopeKey); }
      else addBody(f.id, mirrored, f.id, hash(b.key + featureKey() + scopeKey));
    },

    linearPattern(f) {
      const b = getBody(f.params.target, 'Body');
      const n1 = Math.round(num(f, 'count', 1)), n2 = Math.round(num(f, 'count2', 1));
      if (n1 < 1 || n2 < 1 || n1 * n2 > 2000) throw new Error('Counts must be between 1 and 2000 total');
      const d1 = AXIS_VEC[f.params.axis || 'X'], d2 = AXIS_VEC[f.params.axis2 || 'Y'];
      const s1 = num(f, 'spacing', 0), s2 = num(f, 'spacing2', 0);
      const copies = [];
      for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
        if (i === 0 && j === 0) continue;
        copies.push(T(b.solid.translate([0, 1, 2].map((k) => d1[k] * s1 * i + d2[k] * s2 * j))));
      }
      emitCopies(f, b, copies);
    },

    circularPattern(f) {
      const b = getBody(f.params.target, 'Body');
      const n = Math.round(num(f, 'count', 1));
      if (n < 1 || n > 1000) throw new Error('Count must be between 1 and 1000');
      const total = num(f, 'angle', 360);
      const step = Math.abs(Math.abs(total) - 360) < 1e-9 ? total / n : n > 1 ? total / (n - 1) : 0;
      const c = [num(f, 'cx', 0), num(f, 'cy', 0), num(f, 'cz', 0)];
      const ax = f.params.axis || 'Z';
      const copies = [];
      for (let i = 1; i < n; i++) {
        const a = step * i;
        const rot = ax === 'X' ? [a, 0, 0] : ax === 'Y' ? [0, a, 0] : [0, 0, a];
        copies.push(T(T(T(b.solid.translate(c.map((v) => -v))).rotate(rot)).translate(c)));
      }
      emitCopies(f, b, copies);
    },

    shell(f) {
      const b = getBody(f.params.target, 'Body');
      const t = num(f, 'thickness');
      if (!(t > 0)) throw new Error('Thickness must be positive');
      touch(b, scopeKey);
      const cached = cacheGet(b.key);
      if (cached) {
        b.solid = T(new Manifold(new Mesh(cached)));
        return;
      }
      const ball = T(Manifold.sphere(t, 12));
      const inner = T(b.solid.minkowskiDifference(ball));
      if (inner.isEmpty()) throw new Error('Wall thickness too large for this body');
      b.solid = T(b.solid.subtract(inner));
      cachePut(b.key, b.solid.getMesh());
    },

    remove(f) {
      getBody(f.params.target, 'Body');
      bodies.delete(f.params.target);
    },

    importMesh(f) {
      if (!f.data) throw new Error('No mesh data');
      const vertProperties = decodeArray(f.data.vertices, Float32Array);
      const triVerts = decodeArray(f.data.tris, Uint32Array);
      const mesh = new Mesh({ numProp: 3, vertProperties, triVerts });
      mesh.merge();
      const sc = num(f, 'scale', 1);
      let solid;
      try {
        solid = T(new Manifold(mesh));
      } catch {
        solid = null;
      }
      if (!solid) {
        // keep the raw triangles so the model is still visible
        const m = moveMatrix(
          [num(f, 'x', 0), num(f, 'y', 0), num(f, 'z', 0)],
          [num(f, 'rx', 0), num(f, 'ry', 0), num(f, 'rz', 0)],
          [0, 0, 0],
        ).multiply(new Matrix4().makeScale(sc, sc, sc));
        const positions = new Float32Array(vertProperties.length);
        const v = new Vector3();
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < vertProperties.length; i += 3) {
          v.set(vertProperties[i], vertProperties[i + 1], vertProperties[i + 2]).applyMatrix4(m);
          positions[i] = v.x; positions[i + 1] = v.y; positions[i + 2] = v.z;
          for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
        }
        bodyCounter++;
        meshOnly.push({
          id: f.id, name: nameOf(f.id) || `Body${bodyCounter}`, creator: f.id, meshOnly: true,
          positions, indices: triVerts, volume: 0, area: 0, bbox: { min, max },
        });
        warnings[f.id] = 'Mesh is not watertight: shown for reference only (cannot be joined, cut or hollowed).';
        return;
      }
      if (sc !== 1) solid = T(solid.scale(sc));
      applyOp(f, place(f, solid));
    },
  };

  function emitCopies(f, b, copies) {
    if (!copies.length) return;
    if (f.params.join) { b.solid = T(Manifold.union([b.solid, ...copies])); touch(b, scopeKey); }
    else copies.forEach((c, i) => addBody(`${f.id}:${i + 1}`, c, f.id, hash(b.key + featureKey() + scopeKey + i)));
  }

  const before = {};
  for (const f of doc.features) {
    before[f.id] = {
      bodies: [...bodies.values()].map((b) => ({ id: b.id, name: b.name })),
      sketches: [...sketches.values()].filter((s) => s.cs).map((s) => ({ id: s.id, name: s.name })),
    };
    if (f.suppressed) continue;
    curFeature = f;
    const h = handlers[f.type];
    if (!h) { errors[f.id] = `Unknown feature type ${f.type}`; continue; }
    try {
      h(f);
    } catch (e) {
      errors[f.id] = e?.message || String(e);
    }
  }

  // Extract plain data and free wasm memory
  const outBodies = [];
  for (const b of bodies.values()) {
    try {
      const status = b.solid.status();
      if (b.solid.isEmpty()) {
        outBodies.push({ id: b.id, name: b.name, creator: b.creator, empty: true, positions: new Float32Array(0), indices: new Uint32Array(0), volume: 0, area: 0, bbox: null });
        continue;
      }
      const mesh = b.solid.getMesh();
      const np = mesh.numProp;
      const nv = mesh.vertProperties.length / np;
      const positions = new Float32Array(nv * 3);
      for (let i = 0; i < nv; i++) {
        positions[i * 3] = mesh.vertProperties[i * np];
        positions[i * 3 + 1] = mesh.vertProperties[i * np + 1];
        positions[i * 3 + 2] = mesh.vertProperties[i * np + 2];
      }
      const bb = b.solid.boundingBox();
      outBodies.push({
        id: b.id,
        name: b.name,
        creator: b.creator,
        status,
        positions,
        indices: new Uint32Array(mesh.triVerts),
        volume: b.solid.volume(),
        area: b.solid.surfaceArea(),
        bbox: { min: [...bb.min], max: [...bb.max] },
      });
    } catch (e) {
      errors[b.creator] = errors[b.creator] || `Mesh error: ${e.message}`;
    }
  }
  const outSketches = [...sketches.values()].map((s) => ({
    id: s.id, name: s.name, frame: s.frame, shapes: s.shapes, area: s.area, consumed: consumedSketches.has(s.id),
  }));

  for (const g of garbage) {
    try { g.delete(); } catch { /* already freed */ }
  }

  outBodies.push(...meshOnly);
  return { bodies: outBodies, sketches: outSketches, errors, warnings, paramErrors, scope, before };
}

/** Rotation (manifold Euler convention: X then Y then Z) about pivot, then translate. */
export function moveMatrix(t, rDeg, pivot) {
  const d = Math.PI / 180;
  const R = new Matrix4().makeRotationFromEuler(new Euler(rDeg[0] * d, rDeg[1] * d, rDeg[2] * d, 'ZYX'));
  const toP = new Matrix4().makeTranslation(pivot[0], pivot[1], pivot[2]);
  const fromP = new Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]);
  const tr = new Matrix4().makeTranslation(t[0], t[1], t[2]);
  return tr.multiply(toP).multiply(R).multiply(fromP);
}

/** Decompose an affine rigid matrix into move params, keeping the given pivot. */
export function decomposeMove(m, pivot) {
  const R = new Matrix4().extractRotation(m);
  const e = new Euler().setFromRotationMatrix(R, 'ZYX');
  const p = new Vector3(...pivot);
  // M(x) = R x + b ; we want t such that M(x) = R(x - p) + p + t  => t = b - p + R p
  const b = new Vector3().setFromMatrixPosition(m);
  const Rp = p.clone().applyMatrix4(R);
  const t = b.sub(p).add(Rp);
  const d = 180 / Math.PI;
  return { t: t.toArray().map(clean), r: [e.x * d, e.y * d, e.z * d].map(clean) };
}
