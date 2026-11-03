import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d/manifold.js';
import { regenerate, moveMatrix, decomposeMove } from '../src/kernel/kernel.js';
import { evaluate, evaluateParameters } from '../src/kernel/expr.js';
import { Matrix4, Vector3 } from 'three';

const wasm = await Module();
wasm.setup();

const doc = (features, extra = {}) => ({ parameters: [], settings: { segments: 64 }, bodyProps: {}, features, ...extra });
const close = (a, b, tol = 0.02) => assert.ok(Math.abs(a - b) <= Math.abs(b) * tol + 1e-6, `${a} ≉ ${b}`);

test('expressions', () => {
  assert.equal(evaluate('2+3*4'), 14);
  assert.equal(evaluate('(2+3)*4'), 20);
  assert.equal(evaluate('-2^2'), -4);
  assert.equal(evaluate('1in'), 25.4);
  assert.equal(evaluate('w/2', { w: 10 }), 5);
  close(evaluate('sin(30)'), 0.5);
  assert.throws(() => evaluate('foo+1'));
  assert.throws(() => evaluate('alert(1)'));
  const { scope } = evaluateParameters([{ name: 'a', expr: '5' }, { name: 'b', expr: 'a*2' }]);
  assert.equal(scope.b, 10);
});

test('box with parameters and cut', () => {
  const r = regenerate(doc([
    { id: 'f1', type: 'box', params: { width: 'w', depth: '20', height: '10', operation: 'new' } },
    { id: 'f2', type: 'cylinder', params: { radius: '5', height: '30', z: '-5', operation: 'cut', target: 'f1' } },
  ], { parameters: [{ name: 'w', expr: '40' }] }), wasm);
  assert.deepEqual(r.errors, {});
  assert.equal(r.bodies.length, 1);
  close(r.bodies[0].volume, 40 * 20 * 10 - Math.PI * 25 * 10);
  assert.deepEqual(r.bodies[0].bbox.min.map(Math.round), [-20, -10, 0]);
});

test('sketch extrude with hole (even-odd) on XZ plane', () => {
  const r = regenerate(doc([
    { id: 's1', type: 'sketch', params: { plane: 'XZ', offset: '0' }, shapes: [
      { type: 'rect', x: 0, y: 0, w: 20, h: 10 },
      { type: 'circle', cx: 10, cy: 5, r: 2 },
    ] },
    { id: 'e1', type: 'extrude', params: { sketch: 's1', distance: '5', direction: 'one', operation: 'new' } },
  ]), wasm);
  assert.deepEqual(r.errors, {});
  close(r.bodies[0].volume, (200 - Math.PI * 4) * 5);
  const bb = r.bodies[0].bbox;
  // XZ plane: v -> +Z, normal -> -Y
  close(bb.max[2], 10); close(bb.min[1], -5); close(bb.max[1], 0);
  assert.equal(r.sketches[0].consumed, true);
});

test('revolve around sketch vertical axis', () => {
  const r = regenerate(doc([
    { id: 's1', type: 'sketch', params: { plane: 'XY' }, shapes: [{ type: 'rect', x: 5, y: 0, w: 5, h: 4 }] },
    { id: 'r1', type: 'revolve', params: { sketch: 's1', axis: 'V', angle: '360', operation: 'new' } },
  ]), wasm);
  assert.deepEqual(r.errors, {});
  close(r.bodies[0].volume, Math.PI * (100 - 25) * 4);
  const bb = r.bodies[0].bbox;
  close(bb.max[1], 4); close(bb.max[2], 10); close(bb.max[0], 10);
});

test('revolve around horizontal axis', () => {
  const r = regenerate(doc([
    { id: 's1', type: 'sketch', params: { plane: 'XY' }, shapes: [{ type: 'rect', x: 0, y: 5, w: 4, h: 5 }] },
    { id: 'r1', type: 'revolve', params: { sketch: 's1', axis: 'U', angle: '360', operation: 'new' } },
  ]), wasm);
  assert.deepEqual(r.errors, {});
  close(r.bodies[0].volume, Math.PI * 75 * 4);
  const bb = r.bodies[0].bbox;
  close(bb.min[0], 0); close(bb.max[0], 4); close(bb.max[2], 10);
});

test('move matrix matches manifold rotate convention', () => {
  const m = moveMatrix([1, 2, 3], [30, 40, 50], [0, 0, 0]);
  const cube = wasm.Manifold.cube([1, 2, 3]);
  const a = cube.rotate([30, 40, 50]).translate([1, 2, 3]).boundingBox();
  const b = cube.transform(m.elements.slice()).boundingBox();
  for (let i = 0; i < 3; i++) { close(a.min[i], b.min[i], 1e-4); close(a.max[i], b.max[i], 1e-4); }
  const back = decomposeMove(m, [0, 0, 0]);
  close(back.r[0], 30, 1e-4); close(back.r[2], 50, 1e-4); close(back.t[1], 2, 1e-4);
  const pv = moveMatrix([0, 0, 0], [0, 0, 90], [5, 0, 0]);
  const p = new Vector3(10, 0, 0).applyMatrix4(pv);
  close(p.x, 5, 1e-6); close(p.y, 5, 1e-6);
  const dm = decomposeMove(pv, [5, 0, 0]);
  close(dm.t[0] + 1, 1, 1e-6); close(dm.r[2], 90, 1e-6);
});

test('patterns, mirror, combine, fillets, shell, errors', () => {
  const r = regenerate(doc([
    { id: 'a', type: 'box', params: { width: '10', depth: '10', height: '10', fillet: '2', operation: 'new' } },
    { id: 'p', type: 'linearPattern', params: { target: 'a', axis: 'X', count: '3', spacing: '20', axis2: 'Y', count2: '2', spacing2: '20', join: true } },
    { id: 'c', type: 'cylinder', params: { radius: '3', height: '5', fillet: '1', x: '100', operation: 'new' } },
    { id: 'cp', type: 'circularPattern', params: { target: 'c', axis: 'Z', count: '4', angle: '360', cx: '0', cy: '0', cz: '0', join: false } },
    { id: 'm', type: 'mirror', params: { target: 'a', plane: 'YZ', offset: '0', join: false } },
    { id: 'k', type: 'combine', params: { target: 'a', tools: ['m'], operation: 'join', keepTools: false } },
    { id: 'bad', type: 'box', params: { width: '-1', depth: '1', height: '1', operation: 'new' } },
    { id: 'sh', type: 'sphere', params: { radius: '10', x: '300', operation: 'new' } },
    { id: 'hol', type: 'shell', params: { target: 'sh', thickness: '1' } },
  ]), wasm);
  assert.ok(r.errors.bad);
  assert.equal(Object.keys(r.errors).length, 1);
  const names = r.bodies.map((b) => b.id);
  assert.ok(!names.includes('m'));
  assert.equal(r.bodies.filter((b) => b.creator === 'cp').length, 3);
  const a = r.bodies.find((b) => b.id === 'a');
  assert.ok(a.volume > 6 * 900 && a.volume < 12 * 1000);
  assert.ok(a.bbox.min[0] < -40);
  const sh = r.bodies.find((b) => b.id === 'sh');
  const expected = (4 / 3) * Math.PI * (1000 - 729);
  assert.ok(sh.volume < expected * 1.3 && sh.volume > expected * 0.7, `shell ${sh.volume} vs ${expected}`);
});

test('extrude options', () => {
  const r = regenerate(doc([
    { id: 's', type: 'sketch', params: { plane: 'XY' }, shapes: [{ type: 'rect', x: -10, y: -10, w: 20, h: 20 }, { type: 'poly', pts: [[0, 0], [1, 1]], closed: false }] },
    { id: 'e', type: 'extrude', params: { sketch: 's', distance: '10', direction: 'symmetric', cornerRadius: '3', taper: '50', twist: '45', operation: 'new' } },
    { id: 'e2', type: 'extrude', params: { sketch: 's', distance: '-5', direction: 'one', operation: 'new' } },
  ]), wasm);
  assert.deepEqual(r.errors, {});
  close(r.bodies[0].bbox.min[2], -10); close(r.bodies[0].bbox.max[2], 10);
  close(r.bodies[1].bbox.min[2], -5); close(r.bodies[1].bbox.max[2], 0);
});

test('built-in examples regenerate without errors', async () => {
  const { buildExamples } = await import('../src/examples.js');
  for (const ex of buildExamples()) {
    const r = regenerate(ex.doc, wasm);
    assert.deepEqual(r.errors, {}, ex.name);
    assert.ok(r.bodies.length >= 1, ex.name);
    for (const b of r.bodies) assert.ok(b.volume > 0, `${ex.name} ${b.name}`);
  }
});

test('hollow results are cached and invalidated by upstream edits', () => {
  const mk = (r) => doc([
    { id: 's', type: 'sketch', params: { plane: 'XY' }, shapes: [{ type: 'circle', cx: 0, cy: 0, r }] },
    { id: 'e', type: 'extrude', params: { sketch: 's', distance: '10', operation: 'new' } },
    { id: 'h', type: 'shell', params: { target: 'e', thickness: '1' } },
  ]);
  const t0 = performance.now();
  const a = regenerate(mk(10), wasm);
  const t1 = performance.now();
  const b = regenerate(mk(10), wasm);
  const t2 = performance.now();
  assert.ok(t2 - t1 < (t1 - t0) / 2, `cache not faster: ${t1 - t0} vs ${t2 - t1}`);
  close(a.bodies[0].volume, b.bodies[0].volume, 1e-6);
  const c = regenerate(mk(12), wasm);
  assert.ok(c.bodies[0].volume > a.bodies[0].volume * 1.1, 'sketch change must invalidate cache');
});

test('non-watertight imported mesh is kept as a reference body', async () => {
  const { encodeArray } = await import('../src/kernel/kernel.js');
  // a single open triangle pair (not a closed solid)
  const vertices = new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]);
  const tris = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const r = regenerate(doc([
    { id: 'm', type: 'importMesh', params: { operation: 'new', x: '5', scale: '2' }, data: { vertices: encodeArray(vertices), tris: encodeArray(tris) } },
  ]), wasm);
  assert.deepEqual(r.errors, {});
  assert.ok(r.warnings.m);
  assert.equal(r.bodies.length, 1);
  assert.ok(r.bodies[0].meshOnly);
  close(r.bodies[0].bbox.max[0], 25);
});

test('watertight imported mesh becomes a solid', async () => {
  const { encodeArray } = await import('../src/kernel/kernel.js');
  const cube = wasm.Manifold.cube([10, 10, 10]).getMesh();
  const r = regenerate(doc([
    { id: 'm', type: 'importMesh', params: { operation: 'new' }, data: { vertices: encodeArray(new Float32Array(cube.vertProperties)), tris: encodeArray(new Uint32Array(cube.triVerts)) } },
  ]), wasm);
  assert.deepEqual(r.errors, {});
  close(r.bodies[0].volume, 1000);
});

test('drag arrows sit on the faces they resize', async () => {
  const { featureHandles } = await import('../src/handles.js');
  const box = { id: 'b', type: 'box', params: { width: '20', depth: '10', height: '6', x: '5', y: '0', z: '0', rx: '0', ry: '0', rz: '90' } };
  const hs = featureHandles(box, { scope: {} });
  const w = hs.find((h) => h.key === 'width');
  // rotated 90° about Z: the +X face moves to +Y, offset by x = 5
  close(w.origin[0], 5, 1e-6); close(w.origin[1], 10, 1e-6); close(w.origin[2], 3, 1e-6);
  close(w.dir[1], 1, 1e-6);
  assert.equal(w.factor, 2);
  assert.equal(hs.find((h) => h.key === 'height').origin[2], 6);

  const r = regenerate(doc([
    { id: 's', type: 'sketch', params: { plane: 'XZ', offset: '0' }, shapes: [{ type: 'rect', x: 0, y: 0, w: 10, h: 4 }] },
    { id: 'e', type: 'extrude', params: { sketch: 's', distance: '7', direction: 'one', operation: 'new' } },
  ]), wasm);
  const [ex] = featureHandles({ id: 'e', type: 'extrude', params: { sketch: 's', distance: '7', direction: 'one' } }, r);
  // XZ sketch normal is -Y; arrow sits at the far face of the extrusion
  close(ex.origin[0], 5, 1e-6); close(ex.origin[1], -7, 1e-6); close(ex.origin[2], 2, 1e-6);
  close(ex.dir[1], -1, 1e-6);
});

test('text in a sketch extrudes into letters with holes', async () => {
  const fs = await import('node:fs');
  const { registerFont } = await import('../src/kernel/kernel.js');
  registerFont('regular', JSON.parse(fs.readFileSync(new URL('../src/assets/fonts/droid_sans_regular.typeface.json', import.meta.url), 'utf8')));
  const r = regenerate(doc([
    { id: 's', type: 'sketch', params: { plane: 'XY' }, shapes: [{ type: 'text', x: 0, y: 0, text: 'OA8', size: 10, font: 'regular', angle: 0 }] },
    { id: 'e', type: 'extrude', params: { sketch: 's', distance: '2', operation: 'new' } },
  ]), wasm);
  assert.deepEqual(r.errors, {});
  const b = r.bodies[0];
  assert.ok(b.volume > 20 && b.volume < 200, `volume ${b.volume}`);
  // letters sit to the right of the anchor, about one cap height tall
  assert.ok(b.bbox.min[0] >= -0.5 && b.bbox.max[0] > 15 && b.bbox.max[1] > 6 && b.bbox.max[1] < 12, JSON.stringify(b.bbox));
  // engraving: text inside a rectangle cuts through it (even-odd)
  const plate = regenerate(doc([
    { id: 's', type: 'sketch', params: { plane: 'XY' }, shapes: [{ type: 'rect', x: -5, y: -5, w: 40, h: 20 }, { type: 'text', x: 0, y: 0, text: 'OA8', size: 10, font: 'regular' }] },
    { id: 'e', type: 'extrude', params: { sketch: 's', distance: '2', operation: 'new' } },
  ]), wasm);
  close(plate.bodies[0].volume, 40 * 20 * 2 - b.volume, 0.02);
});
