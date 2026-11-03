// Where to put the drag arrows for a feature being edited.
import { Vector3 } from 'three';
import { evaluate } from './kernel/expr.js';
import { moveMatrix, shapeOutline } from './kernel/kernel.js';

/**
 * Returns [{ key, label, origin, dir, value, factor, min }] for the feature's
 * main dimensions, in world space.
 */
export function featureHandles(f, result) {
  const scope = result?.scope || {};
  const P = f.params || {};
  const num = (k, d = 0) => {
    try { return evaluate(P[k] ?? d, scope); } catch { return null; }
  };
  const out = [];

  // primitives: local placement = rotate then translate (same as the kernel)
  const placed = () => {
    const m = moveMatrix([num('x') ?? 0, num('y') ?? 0, num('z') ?? 0], [num('rx') ?? 0, num('ry') ?? 0, num('rz') ?? 0], [0, 0, 0]);
    return (local, dir) => ({
      origin: new Vector3(...local).applyMatrix4(m).toArray(),
      dir: new Vector3(...dir).transformDirection(m).toArray(),
    });
  };
  const add = (key, label, local, dir, factor = 1, min = 0.01, at = placed()) => {
    const value = num(key);
    if (value === null) return;
    out.push({ key, label, value, factor, min, ...at(local, dir) });
  };

  switch (f.type) {
    case 'box': {
      const w = num('width'), d = num('depth'), h = num('height');
      if ([w, d, h].includes(null)) break;
      const at = placed();
      add('width', 'Width', [w / 2, 0, h / 2], [1, 0, 0], 2, 0.01, at);
      add('depth', 'Depth', [0, d / 2, h / 2], [0, 1, 0], 2, 0.01, at);
      add('height', 'Height', [0, 0, h], [0, 0, 1], 1, 0.01, at);
      break;
    }
    case 'cylinder': {
      const r = num('radius'), h = num('height');
      if ([r, h].includes(null)) break;
      const at = placed();
      add('radius', 'Radius', [r, 0, h / 2], [1, 0, 0], 1, 0.01, at);
      add('height', 'Height', [0, 0, h], [0, 0, 1], 1, 0.01, at);
      break;
    }
    case 'cone': {
      const r = num('radius'), rt = num('topRadius', 0), h = num('height');
      if ([r, rt, h].includes(null)) break;
      const at = placed();
      add('radius', 'Bottom radius', [r, 0, 0], [1, 0, 0], 1, 0, at);
      add('topRadius', 'Top radius', [rt, 0, h], [1, 0, 0], 1, 0, at);
      add('height', 'Height', [0, 0, h], [0, 0, 1], 1, 0.01, at);
      break;
    }
    case 'sphere': {
      const r = num('radius');
      if (r === null) break;
      add('radius', 'Radius', [r, 0, 0], [1, 0, 0]);
      break;
    }
    case 'torus': {
      const R = num('majorRadius'), r = num('minorRadius');
      if ([R, r].includes(null)) break;
      const at = placed();
      add('majorRadius', 'Ring radius', [R + r, 0, 0], [1, 0, 0], 1, 0.02, at);
      add('minorRadius', 'Tube radius', [R, 0, r], [0, 0, 1], 1, 0.01, at);
      break;
    }
    case 'extrude': {
      const sk = result?.sketches?.find((s) => s.id === P.sketch);
      const d = num('distance');
      if (!sk || d === null) break;
      const fr = sk.frame; // already evaluated by the kernel
      // centre of the profile
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
      for (const s of sk.shapes) {
        if (s.construction) continue;
        for (const [u, v] of shapeOutline(s, 24)) {
          minU = Math.min(minU, u); maxU = Math.max(maxU, u);
          minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        }
      }
      if (!Number.isFinite(minU)) break;
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      const o = new Vector3(...fr.origin).addScaledVector(new Vector3(...fr.u), cu).addScaledVector(new Vector3(...fr.v), cv);
      const n = new Vector3(...fr.n).multiplyScalar(P.direction === 'reverse' ? -1 : 1);
      out.push({
        key: 'distance', label: 'Distance', value: d, factor: 1, min: undefined,
        origin: o.clone().addScaledVector(n, d).toArray(), dir: n.toArray(),
      });
      break;
    }
    default:
      break;
  }
  return out;
}
