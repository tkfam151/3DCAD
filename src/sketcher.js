import * as THREE from 'three';
import { frameMatrix, shapeOutline } from './kernel/kernel.js';
import { icon } from './ui/icons.js';

const TOOLS = [
  { id: 'select', label: 'Select', key: 'V', icon: 'cursor' },
  { id: 'line', label: 'Line', key: 'L', icon: 'line' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: 'rect' },
  { id: 'crect', label: 'Center Rect', key: 'T', icon: 'crect' },
  { id: 'circle', label: 'Circle', key: 'C', icon: 'circle' },
  { id: 'polygon', label: 'Polygon', key: 'P', icon: 'polygon' },
  { id: 'slot', label: 'Slot', key: 'O', icon: 'slot' },
];

const fmt = (n) => (Math.round(n * 100) / 100).toString();

/**
 * Interactive 2D sketch editor operating on a plane inside the 3D viewport.
 */
export class Sketcher {
  constructor(viewport, panel, { segments = 64 } = {}) {
    this.vp = viewport;
    this.panel = panel;
    this.segments = segments;
    this.active = false;
    this.snapStep = 1;
    this.snapGrid = true;
    this.polySides = 6;
    this.onKey = this.onKey.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onDown = this.onDown.bind(this);
    this.onDbl = this.onDbl.bind(this);
  }

  start(feature, frame, { onFinish, onCancel, onChange }) {
    this.feature = feature;
    this.frame = frame;
    this.shapes = JSON.parse(JSON.stringify(feature.shapes || []));
    this.onFinish = onFinish;
    this.onCancel = onCancel;
    this.onChange = onChange;
    this.tool = this.shapes.length ? 'select' : 'rect';
    this.pts = [];
    this.selected = new Set();
    this.cursor = null;
    this.active = true;
    this.history = [];

    this.planeGrid = this.makePlaneGrid();
    this.vp.addOverlay(this.planeGrid);
    this.vp.gridGroup.visible = false;
    this.vp.controls.enableRotate = false;

    this.hud = this.vp.addLabel(new THREE.Vector3(), '', 'sketch-hud');
    this.hud.el.style.display = 'none';

    this.dimInput = document.createElement('input');
    this.dimInput.className = 'dim-input';
    this.dimInput.placeholder = 'value';
    this.dimInput.style.display = 'none';
    this.vp.container.appendChild(this.dimInput);
    this.dimInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.commitTyped(this.dimInput.value);
      if (e.key === 'Escape') { this.dimInput.value = ''; this.dimInput.style.display = 'none'; this.dimInput.blur(); }
    });

    this.vp.dom.addEventListener('pointermove', this.onMove);
    this.vp.dom.addEventListener('pointerdown', this.onDown);
    this.vp.dom.addEventListener('dblclick', this.onDbl);
    window.addEventListener('keydown', this.onKey);

    this.vp.lookAtPlane(frame, this.shapesBox());
    this.redraw();
    this.renderPanel();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.vp.removeOverlay(this.planeGrid);
    if (this.preview) this.vp.removeOverlay(this.preview);
    this.preview = null;
    this.vp.removeLabel(this.hud);
    this.dimInput.remove();
    this.vp.gridGroup.visible = true;
    this.vp.controls.enableRotate = true;
    this.vp.dom.removeEventListener('pointermove', this.onMove);
    this.vp.dom.removeEventListener('pointerdown', this.onDown);
    this.vp.dom.removeEventListener('dblclick', this.onDbl);
    window.removeEventListener('keydown', this.onKey);
    this.panel.innerHTML = '';
    this.panel.classList.remove('open');
  }

  finish() {
    this.cancelInProgress();
    const shapes = this.shapes;
    this.stop();
    this.onFinish?.(shapes);
  }

  cancel() {
    this.stop();
    this.onCancel?.();
  }

  shapesBox() {
    const box = new THREE.Box3();
    const m = frameMatrix(this.frame);
    for (const s of this.shapes) {
      for (const p of shapeOutline(s, 16)) box.expandByPoint(new THREE.Vector3(p[0], p[1], 0).applyMatrix4(m));
    }
    if (box.isEmpty()) {
      const o = new THREE.Vector3(...this.frame.origin);
      box.set(o.clone().addScalar(-40), o.clone().addScalar(40));
    } else box.expandByScalar(10);
    return box;
  }

  makePlaneGrid() {
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    g.matrix.copy(frameMatrix(this.frame));
    const mk = (size, divs, opacity) => {
      const grid = new THREE.GridHelper(size, divs, 0x6f8db0, 0x6f8db0);
      grid.rotation.x = Math.PI / 2;
      grid.material.transparent = true;
      grid.material.opacity = opacity;
      grid.material.depthWrite = false;
      return grid;
    };
    g.add(mk(400, 400, 0.1), mk(400, 40, 0.28));
    const axis = (a, b, color) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
      const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.8 }));
      l.renderOrder = 3;
      return l;
    };
    g.add(axis([-200, 0, 0], [200, 0, 0], 0xe0524f), axis([0, -200, 0], [0, 200, 0], 0x5fbf5f));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.8, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    dot.renderOrder = 6;
    g.add(dot);
    g.updateMatrixWorld(true);
    return g;
  }

  // ---------- geometry helpers ----------

  snapPoints() {
    const pts = [[0, 0]];
    for (const s of this.shapes) {
      if (s.type === 'rect') pts.push([s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h], [s.x + s.w / 2, s.y + s.h / 2]);
      else if (s.type === 'circle' || s.type === 'polygon') pts.push([s.cx, s.cy]);
      else if (s.type === 'slot') pts.push([s.x1, s.y1], [s.x2, s.y2]);
      else if (s.type === 'poly') pts.push(...s.pts);
    }
    if (this.pts.length) pts.push(...this.pts);
    return pts;
  }

  snap(raw, ev) {
    const tol = 9 * this.vp.worldPerPixel();
    let best = null, bd = tol;
    for (const p of this.snapPoints()) {
      const d = Math.hypot(p[0] - raw[0], p[1] - raw[1]);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) return { p: [best[0], best[1]], snapped: true };
    let p = raw;
    if (this.snapGrid && !ev?.altKey) {
      const st = this.snapStep;
      p = [Math.round(raw[0] / st) * st, Math.round(raw[1] / st) * st];
    }
    // horizontal/vertical inference for lines
    if (this.tool === 'line' && this.pts.length) {
      const last = this.pts[this.pts.length - 1];
      if (Math.abs(p[0] - last[0]) < tol) p = [last[0], p[1]];
      if (Math.abs(p[1] - last[1]) < tol) p = [p[0], last[1]];
    }
    return { p: p.map((v) => Math.round(v * 1e6) / 1e6), snapped: false };
  }

  shapeFromPoints(tool, pts, cur) {
    const [a] = pts;
    switch (tool) {
      case 'rect': {
        const x = Math.min(a[0], cur[0]), y = Math.min(a[1], cur[1]);
        return { type: 'rect', x, y, w: Math.abs(cur[0] - a[0]), h: Math.abs(cur[1] - a[1]) };
      }
      case 'crect': {
        const hw = Math.abs(cur[0] - a[0]), hh = Math.abs(cur[1] - a[1]);
        return { type: 'rect', x: a[0] - hw, y: a[1] - hh, w: hw * 2, h: hh * 2 };
      }
      case 'circle':
        return { type: 'circle', cx: a[0], cy: a[1], r: Math.hypot(cur[0] - a[0], cur[1] - a[1]) };
      case 'polygon': {
        const ang = (Math.atan2(cur[1] - a[1], cur[0] - a[0]) * 180) / Math.PI - 90;
        return { type: 'polygon', cx: a[0], cy: a[1], r: Math.hypot(cur[0] - a[0], cur[1] - a[1]), sides: this.polySides, angle: Math.round(ang * 100) / 100 };
      }
      case 'slot': {
        if (pts.length === 1) return { type: 'poly', pts: [a, cur], closed: false };
        const b = pts[1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        const r = Math.abs(((cur[0] - a[0]) * -dy + (cur[1] - a[1]) * dx) / len);
        return { type: 'slot', x1: a[0], y1: a[1], x2: b[0], y2: b[1], r: Math.max(r, 0.01) };
      }
      case 'line':
        return { type: 'poly', pts: [...pts, cur], closed: false };
      default:
        return null;
    }
  }

  hudText(tool, pts, cur) {
    const a = pts[0];
    const last = pts[pts.length - 1];
    switch (tool) {
      case 'rect': return `${fmt(Math.abs(cur[0] - a[0]))} × ${fmt(Math.abs(cur[1] - a[1]))}`;
      case 'crect': return `${fmt(2 * Math.abs(cur[0] - a[0]))} × ${fmt(2 * Math.abs(cur[1] - a[1]))}`;
      case 'circle': return `⌀ ${fmt(2 * Math.hypot(cur[0] - a[0], cur[1] - a[1]))}`;
      case 'polygon': return `R ${fmt(Math.hypot(cur[0] - a[0], cur[1] - a[1]))} · ${this.polySides} sides`;
      case 'slot': {
        if (pts.length === 1) return `L ${fmt(Math.hypot(cur[0] - a[0], cur[1] - a[1]))}`;
        const s = this.shapeFromPoints('slot', pts, cur);
        return `W ${fmt(s.r * 2)}`;
      }
      case 'line': {
        const len = Math.hypot(cur[0] - last[0], cur[1] - last[1]);
        const ang = (Math.atan2(cur[1] - last[1], cur[0] - last[0]) * 180) / Math.PI;
        return `${fmt(len)}  ∠ ${fmt(ang)}°`;
      }
      default: return '';
    }
  }

  // ---------- events ----------

  onMove(ev) {
    const raw = this.vp.planePoint(ev, this.frame);
    if (!raw) return;
    const { p, snapped } = this.snap(raw, ev);
    this.cursor = p;
    this.cursorSnapped = snapped;
    this.updateHud();
    this.redraw();
  }

  updateHud() {
    const p = this.cursor;
    if (!p) return;
    const world = new THREE.Vector3(p[0], p[1], 0).applyMatrix4(frameMatrix(this.frame));
    this.hud.pos.copy(world);
    if (this.pts.length && this.tool !== 'select') {
      this.hud.el.textContent = this.hudText(this.tool, this.pts, p);
      this.hud.el.style.display = '';
    } else if (this.tool !== 'select') {
      this.hud.el.textContent = `${fmt(p[0])}, ${fmt(p[1])}`;
      this.hud.el.style.display = '';
    } else {
      this.hud.el.style.display = 'none';
    }
    this.vp.requestRender();
  }

  onDown(ev) {
    if (ev.button !== 0) return;
    const raw = this.vp.planePoint(ev, this.frame);
    if (!raw) return;
    const { p } = this.snap(raw, ev);
    if (this.tool === 'select') {
      const idx = this.hitShape(raw);
      if (!ev.shiftKey && !ev.metaKey) this.selected.clear();
      if (idx >= 0) {
        if (this.selected.has(idx) && (ev.shiftKey || ev.metaKey)) this.selected.delete(idx);
        else this.selected.add(idx);
      }
      this.redraw();
      this.renderPanel();
      return;
    }
    this.addPoint(p);
  }

  onDbl() {
    if (this.tool === 'line' && this.pts.length >= 2) this.commitLine(false);
  }

  addPoint(p) {
    const tool = this.tool;
    if (tool === 'line') {
      if (this.pts.length >= 3) {
        const f = this.pts[0];
        if (Math.hypot(p[0] - f[0], p[1] - f[1]) < 1e-6) { this.commitLine(true); return; }
      }
      const last = this.pts[this.pts.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-9) return;
      this.pts.push(p);
    } else {
      this.pts.push(p);
      const need = tool === 'slot' ? 3 : 2;
      if (this.pts.length >= need) {
        const last = this.pts.pop();
        const shape = this.shapeFromPoints(tool, this.pts, last);
        this.pts = [];
        if (this.validShape(shape)) this.addShape(shape);
      }
    }
    this.updateHud();
    this.redraw();
  }

  validShape(s) {
    if (!s) return false;
    if (s.type === 'rect') return s.w > 1e-6 && s.h > 1e-6;
    if (s.type === 'circle' || s.type === 'polygon' || s.type === 'slot') return s.r > 1e-6;
    return true;
  }

  commitLine(closed) {
    const pts = this.pts;
    this.pts = [];
    if (pts.length >= 2) this.addShape({ type: 'poly', pts, closed: closed && pts.length >= 3 });
    this.redraw();
  }

  commitTyped(text) {
    this.dimInput.value = '';
    this.dimInput.style.display = 'none';
    this.dimInput.blur();
    const nums = text.split(/[,x×\s]+/).filter(Boolean).map(Number);
    if (!nums.length || nums.some((n) => !Number.isFinite(n))) return;
    const cur = this.cursor || [0, 0];
    const a = this.pts[0];
    if (!a) return;
    const last = this.pts[this.pts.length - 1];
    const tool = this.tool;
    const dir = (from) => {
      const dx = cur[0] - from[0], dy = cur[1] - from[1];
      const l = Math.hypot(dx, dy);
      return l > 1e-9 ? [dx / l, dy / l] : [1, 0];
    };
    let p;
    if (tool === 'line') {
      const angle = nums.length > 1 ? (nums[1] * Math.PI) / 180 : null;
      const d = angle !== null ? [Math.cos(angle), Math.sin(angle)] : dir(last);
      p = [last[0] + d[0] * nums[0], last[1] + d[1] * nums[0]];
    } else if (tool === 'rect') {
      const sx = Math.sign(cur[0] - a[0]) || 1, sy = Math.sign(cur[1] - a[1]) || 1;
      p = [a[0] + sx * nums[0], a[1] + sy * (nums[1] ?? nums[0])];
    } else if (tool === 'crect') {
      p = [a[0] + nums[0] / 2, a[1] + (nums[1] ?? nums[0]) / 2];
    } else if (tool === 'circle') {
      p = [a[0] + nums[0] / 2, a[1]];
    } else if (tool === 'polygon') {
      const d = dir(a);
      p = [a[0] + d[0] * nums[0], a[1] + d[1] * nums[0]];
    } else if (tool === 'slot') {
      if (this.pts.length === 1) {
        const d = dir(a);
        p = [a[0] + d[0] * nums[0], a[1] + d[1] * nums[0]];
      } else {
        const b = this.pts[1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1;
        p = [a[0] + (-dy / l) * (nums[0] / 2), a[1] + (dx / l) * (nums[0] / 2)];
      }
    }
    if (p) { this.cursor = p; this.addPoint(p.map((v) => Math.round(v * 1e6) / 1e6)); }
  }

  onKey(ev) {
    if (!this.active) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = ev.key;
    if ((ev.metaKey || ev.ctrlKey) && k.toLowerCase() === 'z') {
      ev.preventDefault();
      ev.stopPropagation();
      this.undo();
      return;
    }
    if (ev.metaKey || ev.ctrlKey) return;
    if (k === 'Escape') {
      ev.stopPropagation();
      if (this.pts.length) this.cancelInProgress();
      else if (this.tool !== 'select') this.setTool('select');
      else { this.selected.clear(); this.redraw(); this.renderPanel(); }
      return;
    }
    if (k === 'Enter') {
      ev.stopPropagation();
      if (this.tool === 'line' && this.pts.length >= 2) this.commitLine(false);
      else if (!this.pts.length) this.finish();
      return;
    }
    if ((k === 'Delete' || k === 'Backspace') && this.selected.size) {
      ev.stopPropagation();
      this.deleteSelected();
      return;
    }
    if (/^[0-9.\-]$/.test(k) && this.pts.length) {
      this.dimInput.style.display = '';
      this.positionDimInput();
      this.dimInput.value = '';
      this.dimInput.focus();
      return; // the keypress itself lands in the input
    }
    const t = TOOLS.find((x) => x.key.toLowerCase() === k.toLowerCase());
    if (t) { ev.stopPropagation(); this.setTool(t.id); return; }
    if (k.toLowerCase() === 'x' && this.selected.size) { ev.stopPropagation(); this.toggleConstruction(); }
  }

  positionDimInput() {
    const r = this.hud.el.getBoundingClientRect();
    const c = this.vp.container.getBoundingClientRect();
    this.dimInput.style.left = `${r.left - c.left}px`;
    this.dimInput.style.top = `${r.bottom - c.top + 4}px`;
  }

  hitShape(p) {
    const tol = 7 * this.vp.worldPerPixel();
    let best = -1, bd = tol;
    this.shapes.forEach((s, i) => {
      const pts = shapeOutline(s, 48);
      for (let k = 0; k < pts.length - 1; k++) {
        const d = segDist(p, pts[k], pts[k + 1]);
        if (d < bd) { bd = d; best = i; }
      }
    });
    return best;
  }

  // ---------- editing ----------

  pushHistory() {
    this.history.push(JSON.stringify(this.shapes));
    if (this.history.length > 100) this.history.shift();
  }

  undo() {
    if (this.pts.length) { this.pts.pop(); this.redraw(); return; }
    const prev = this.history.pop();
    if (prev === undefined) return;
    this.shapes = JSON.parse(prev);
    this.selected.clear();
    this.changed();
  }

  addShape(s) {
    this.pushHistory();
    this.shapes.push(s);
    this.changed();
  }

  deleteSelected() {
    this.pushHistory();
    this.shapes = this.shapes.filter((_, i) => !this.selected.has(i));
    this.selected.clear();
    this.changed();
  }

  toggleConstruction() {
    this.pushHistory();
    const on = ![...this.selected].every((i) => this.shapes[i].construction);
    for (const i of this.selected) this.shapes[i].construction = on;
    this.changed();
  }

  changed() {
    this.redraw();
    this.renderPanel();
    this.onChange?.(this.shapes);
  }

  cancelInProgress() {
    this.pts = [];
    this.dimInput.style.display = 'none';
    this.dimInput.blur();
    this.redraw();
  }

  setTool(id) {
    if (this.tool === 'line' && this.pts.length >= 2) this.commitLine(false);
    this.cancelInProgress();
    this.tool = id;
    if (id !== 'select') { this.selected.clear(); }
    this.vp.dom.style.cursor = id === 'select' ? 'default' : 'crosshair';
    this.updateHud();
    this.redraw();
    this.renderPanel();
  }

  redraw() {
    if (this.preview) this.vp.removeOverlay(this.preview);
    const shapes = [...this.shapes];
    if (this.pts.length && this.cursor) {
      const s = this.shapeFromPoints(this.tool, this.pts, this.cursor);
      if (s) shapes.push({ ...s, _preview: true });
    }
    const sel = new Set(this.selected);
    this.preview = this.vp.makeSketchObject(this.frame, shapes, { color: 0x7cc4ff, selected: sel, segments: this.segments });
    // cursor marker
    if (this.cursor && this.tool !== 'select') {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 1.0, 20).scale(this.vp.worldPerPixel() * 4, this.vp.worldPerPixel() * 4, 1),
        new THREE.MeshBasicMaterial({ color: this.cursorSnapped ? 0xffb02e : 0xffffff, depthTest: false }),
      );
      m.position.set(this.cursor[0], this.cursor[1], 0);
      m.renderOrder = 8;
      this.preview.add(m);
    }
    for (const p of this.pts) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(this.vp.worldPerPixel() * 3, 12),
        new THREE.MeshBasicMaterial({ color: 0x7cc4ff, depthTest: false }),
      );
      m.position.set(p[0], p[1], 0);
      m.renderOrder = 8;
      this.preview.add(m);
    }
    this.preview.updateMatrixWorld(true);
    this.vp.addOverlay(this.preview);
  }

  // ---------- side panel ----------

  renderPanel() {
    const P = this.panel;
    P.classList.add('open');
    P.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'panel-head';
    h.innerHTML = `<span>${icon('sketch')} ${escapeHtml(this.feature.name || 'Sketch')}</span>`;
    P.appendChild(h);

    const tools = document.createElement('div');
    tools.className = 'sketch-tools';
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.className = `tool-btn${this.tool === t.id ? ' active' : ''}`;
      b.title = `${t.label} (${t.key})`;
      b.innerHTML = `${icon(t.icon)}<span>${t.label}</span>`;
      b.onclick = () => this.setTool(t.id);
      tools.appendChild(b);
    }
    P.appendChild(tools);

    const opts = document.createElement('div');
    opts.className = 'form';
    opts.innerHTML = `
      <label class="row"><span>Grid snap</span><span class="inline"><input type="checkbox" data-k="snap" ${this.snapGrid ? 'checked' : ''}/>
        <input type="number" data-k="step" min="0.01" step="0.5" value="${this.snapStep}" style="width:64px"/> mm</span></label>
      <label class="row"><span>Polygon sides</span><input type="number" data-k="sides" min="3" max="64" value="${this.polySides}"/></label>
    `;
    opts.querySelector('[data-k=snap]').onchange = (e) => { this.snapGrid = e.target.checked; };
    opts.querySelector('[data-k=step]').onchange = (e) => { this.snapStep = Math.max(0.01, Number(e.target.value) || 1); };
    opts.querySelector('[data-k=sides]').onchange = (e) => { this.polySides = Math.max(3, Math.min(64, Math.round(Number(e.target.value) || 6))); };
    P.appendChild(opts);

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.innerHTML = {
      select: 'Click a shape to select and edit it. <b>Delete</b> removes, <b>X</b> toggles construction.',
      line: 'Click points. Click the first point to close, double‑click or <b>Enter</b> to end. Type a number for exact length.',
      rect: 'Click two corners. Type <b>w,h</b> for exact size.',
      crect: 'Click center, then a corner. Type <b>w,h</b> for exact size.',
      circle: 'Click center, then radius. Type a diameter for exact size.',
      polygon: 'Click center, then a vertex. Type a radius.',
      slot: 'Click both arc centers, then the width.',
    }[this.tool] + ' Hold <b>⌥</b> to disable snapping.';
    P.appendChild(hint);

    // selected shape properties
    if (this.selected.size === 1) {
      const idx = [...this.selected][0];
      const s = this.shapes[idx];
      if (s) P.appendChild(this.shapeEditor(s));
    }

    const list = document.createElement('div');
    list.className = 'shape-list';
    list.innerHTML = `<div class="section-title">Shapes (${this.shapes.length})</div>`;
    this.shapes.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = `shape-row${this.selected.has(i) ? ' sel' : ''}`;
      row.innerHTML = `${icon(s.type === 'poly' ? 'line' : s.type === 'rect' ? 'rect' : s.type)} <span>${describe(s)}</span>`;
      row.onclick = (e) => {
        if (!e.shiftKey && !e.metaKey) this.selected.clear();
        this.selected.add(i);
        this.tool = 'select';
        this.redraw();
        this.renderPanel();
      };
      list.appendChild(row);
    });
    P.appendChild(list);

    const foot = document.createElement('div');
    foot.className = 'panel-foot';
    const ok = document.createElement('button');
    ok.className = 'btn primary';
    ok.textContent = 'Finish Sketch';
    ok.onclick = () => this.finish();
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    cancel.onclick = () => this.cancel();
    foot.append(cancel, ok);
    P.appendChild(foot);
  }

  shapeEditor(s) {
    const box = document.createElement('div');
    box.className = 'form shape-edit';
    const fields = {
      rect: [['x', 'X'], ['y', 'Y'], ['w', 'Width'], ['h', 'Height']],
      circle: [['cx', 'Center X'], ['cy', 'Center Y'], ['r', 'Radius']],
      polygon: [['cx', 'Center X'], ['cy', 'Center Y'], ['r', 'Radius'], ['sides', 'Sides'], ['angle', 'Angle °']],
      slot: [['x1', 'X1'], ['y1', 'Y1'], ['x2', 'X2'], ['y2', 'Y2'], ['r', 'Radius']],
    }[s.type];
    const kind = { rect: 'rectangle', circle: 'circle', polygon: 'polygon', slot: 'slot', poly: 'line' }[s.type] || s.type;
    box.innerHTML = `<div class="section-title">Edit ${kind}</div>`;
    const apply = (fn) => { this.pushHistory(); fn(); this.redraw(); this.onChange?.(this.shapes); };
    if (fields) {
      for (const [k, label] of fields) {
        const row = document.createElement('label');
        row.className = 'row';
        row.innerHTML = `<span>${label}</span>`;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = 'any';
        inp.value = fmt(s[k]);
        inp.onchange = () => {
          const v = Number(inp.value);
          if (Number.isFinite(v)) apply(() => { s[k] = v; });
        };
        row.appendChild(inp);
        box.appendChild(row);
      }
    } else if (s.type === 'poly') {
      const ta = document.createElement('textarea');
      ta.rows = Math.min(8, s.pts.length + 1);
      ta.value = s.pts.map((p) => `${fmt(p[0])}, ${fmt(p[1])}`).join('\n');
      ta.onchange = () => {
        const pts = ta.value.split('\n').map((l) => l.split(/[,\s]+/).filter(Boolean).map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
        if (pts.length >= 2) apply(() => { s.pts = pts; });
      };
      box.appendChild(ta);
      const cl = document.createElement('label');
      cl.className = 'row';
      cl.innerHTML = `<span>Closed</span><input type="checkbox" ${s.closed ? 'checked' : ''}/>`;
      cl.querySelector('input').onchange = (e) => apply(() => { s.closed = e.target.checked; });
      box.appendChild(cl);
    }
    const cons = document.createElement('label');
    cons.className = 'row';
    cons.innerHTML = `<span>Construction</span><input type="checkbox" ${s.construction ? 'checked' : ''}/>`;
    cons.querySelector('input').onchange = (e) => apply(() => { s.construction = e.target.checked; });
    box.appendChild(cons);
    const del = document.createElement('button');
    del.className = 'btn danger small';
    del.textContent = 'Delete shape';
    del.onclick = () => this.deleteSelected();
    box.appendChild(del);
    return box;
  }
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function describe(s) {
  switch (s.type) {
    case 'rect': return `Rectangle ${fmt(s.w)} × ${fmt(s.h)}`;
    case 'circle': return `Circle ⌀${fmt(s.r * 2)}`;
    case 'polygon': return `Polygon ${s.sides}× R${fmt(s.r)}`;
    case 'slot': return `Slot W${fmt(s.r * 2)}`;
    case 'poly': return `${s.closed ? 'Closed' : 'Open'} line (${s.pts.length} pts)`;
    default: return s.type;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
