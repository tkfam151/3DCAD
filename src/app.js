import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { mergeVertices, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { regenerate, sketchFrame, planeFromFace, moveMatrix, decomposeMove, encodeArray } from './kernel/kernel.js';
import { FEATURES, defaultParams } from './kernel/features.js';
import { evaluate } from './kernel/expr.js';
import { Viewport, defaultBodyColor } from './viewport.js';
import { Sketcher } from './sketcher.js';
import { icon } from './ui/icons.js';
import { buildExamples } from './examples.js';
import { Landing } from './landing.js';
import { addRecent } from './recents.js';

const MESH_EXT = ['stl', 'obj'];
const extOf = (name) => (String(name).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const baseName = (name) => String(name).split(/[\\/]/).pop().replace(/\.[a-z0-9]+$/i, '');

const FILE_EXT = 'ocad';
const OPEN_EXT = [FILE_EXT, 'json', ...MESH_EXT];
const AUTOSAVE_KEY = 'opencad-autosave-v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 2) => (Number.isFinite(n) ? (Math.round(n * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d }) : '–');
const uid = () => Math.random().toString(36).slice(2, 9);

export function emptyDoc() {
  return {
    format: 'opencad', version: 1,
    parameters: [],
    settings: { segments: 64, units: 'mm' },
    bodyProps: {}, sketchProps: {},
    features: [],
  };
}

export class App {
  constructor(wasm) {
    this.wasm = wasm;
    this.api = window.api || null;
    this.doc = emptyDoc();
    this.undoStack = [];
    this.redoStack = [];
    this.selection = new Set();
    this.mode = 'normal';
    this.filePath = null;
    this.fileName = 'Untitled';
    this.dirty = false;
    this.editing = null;

    this.el = {
      toolbar: document.getElementById('toolbar'),
      browser: document.getElementById('browser'),
      panel: document.getElementById('panel'),
      timeline: document.getElementById('timeline'),
      status: document.getElementById('statusbar'),
      viewbar: document.getElementById('viewbar'),
      vp: document.getElementById('viewport'),
    };
    this.vp = new Viewport(this.el.vp);
    this.vp.onGizmoEnd = (delta, bodyId) => this.onGizmoEnd(delta, bodyId);
    this.sketcher = new Sketcher(this.vp, this.el.panel);

    this.buildToolbar();
    this.buildViewbar();
    this.bindViewportEvents();
    this.bindKeys();
    if (this.api) this.api.onMenu((cmd, arg) => this.command(cmd, arg));

    this.landing = new Landing(this);
    this.bindDragDrop();
    this.regen();
    this.vp.setView('iso');
    this.landing.show();
  }

  // ===================== document & history =====================

  snapshot() { return JSON.stringify(this.doc); }

  commit(before) {
    if (before !== undefined && before !== this.snapshot()) {
      this.undoStack.push(before);
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    }
    this.setDirty(true);
    this.regen();
  }

  change(fn) {
    const before = this.snapshot();
    fn(this.doc);
    this.commit(before);
  }

  undo() {
    if (this.mode === 'sketch') return this.sketcher.undo();
    if (this.editing) this.cancelEdit();
    const prev = this.undoStack.pop();
    if (!prev) return this.toast('Nothing to undo');
    this.redoStack.push(this.snapshot());
    this.doc = JSON.parse(prev);
    this.setDirty(true);
    this.regen();
  }

  redo() {
    if (this.editing || this.mode === 'sketch') return;
    const next = this.redoStack.pop();
    if (!next) return this.toast('Nothing to redo');
    this.undoStack.push(this.snapshot());
    this.doc = JSON.parse(next);
    this.setDirty(true);
    this.regen();
  }

  setDirty(d) {
    this.dirty = d;
    const title = `${this.fileName}${d ? ' •' : ''} — OpenCAD Studio`;
    document.title = title;
    this.api?.setDirty(d, title);
    if (d) this.scheduleAutosave();
  }

  scheduleAutosave() {
    clearTimeout(this._autosaveT);
    this._autosaveT = setTimeout(() => {
      try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ name: this.fileName, path: this.filePath, doc: this.doc, t: Date.now() })); } catch { /* storage full */ }
    }, 800);
  }

  readAutosave() {
    try {
      const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null');
      return saved?.doc?.features?.length ? saved : null;
    } catch {
      return null;
    }
  }

  recoverAutosave() {
    const saved = this.readAutosave();
    if (!saved) return;
    this.loadDoc(saved.doc, saved.name, saved.path);
    this.setDirty(true);
    this.toast('Recovered your unsaved design');
  }

  discardAutosave() {
    localStorage.removeItem(AUTOSAVE_KEY);
  }

  loadDoc(doc, name = 'Untitled', path = null) {
    if (this.mode === 'sketch') this.sketcher.stop();
    this.closePanel(true);
    this.doc = { ...emptyDoc(), ...doc };
    this.doc.settings = { ...emptyDoc().settings, ...(doc.settings || {}) };
    this.undoStack = [];
    this.redoStack = [];
    this.selection.clear();
    this.fileName = name;
    this.filePath = path;
    this.mode = 'normal';
    this.exitMeasure?.();
    this.landing?.hide();
    this.regen();
    this.setDirty(false);
    this.vp.setView('iso');
  }

  // ===================== regeneration =====================

  regen() {
    const t0 = performance.now();
    try {
      this.result = regenerate(this.doc, this.wasm);
    } catch (e) {
      console.error(e);
      this.toast(`Regeneration failed: ${e.message}`, 'error');
      return;
    }
    this.regenMs = performance.now() - t0;
    const ids = new Set(this.result.bodies.map((b) => b.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    this.vp.setBodies(this.result.bodies, this.doc.bodyProps);
    this.vp.setSelection(this.selection);
    this.vp.setSketches(this.result.sketches, this.visibleSketchIds(), this.mode === 'sketch' ? this.sketcher.feature?.id : null, this.doc.settings.segments);
    this.renderBrowser();
    this.renderTimeline();
    this.renderStatus();
    if (this.editing?.def?.type === 'move') this.attachMoveGizmo();
  }

  visibleSketchIds() {
    const out = new Set();
    for (const s of this.result.sketches) {
      const p = this.doc.sketchProps?.[s.id];
      const vis = p?.visible ?? !s.consumed;
      if (vis) out.add(s.id);
    }
    return out;
  }

  featureById(id) { return this.doc.features.find((f) => f.id === id); }

  // ===================== toolbar =====================

  buildToolbar() {
    const groups = [
      { title: 'File', items: [
        ['new', 'New', 'new'], ['open', 'Open', 'open'], ['save', 'Save', 'save'],
        ['menu:export', 'Export', 'export'], ['importMesh', 'Import', 'import'],
      ] },
      { title: 'Create', items: [
        ['sketch', 'Sketch', 'sketch', 'S'], ['extrude', 'Extrude', 'extrude', 'E'], ['revolve', 'Revolve', 'revolve'],
        ['box', 'Box', 'box', 'B'], ['cylinder', 'Cylinder', 'cylinder', 'Y'], ['sphere', 'Sphere', 'sphere'],
        ['cone', 'Cone', 'cone'], ['torus', 'Torus', 'torus'],
      ] },
      { title: 'Modify', items: [
        ['move', 'Move', 'move', 'M'], ['combine', 'Combine', 'combine', 'J'], ['mirror', 'Mirror', 'mirror'],
        ['linearPattern', 'Pattern', 'linear'], ['circularPattern', 'Circular', 'circular'],
        ['shell', 'Hollow', 'shell'], ['scale', 'Scale', 'scale'],
      ] },
      { title: 'Inspect', items: [
        ['measure', 'Measure', 'measure', 'I'], ['params', 'Parameters', 'params'],
      ] },
      { title: 'Edit', items: [['undo', 'Undo', 'undo'], ['redo', 'Redo', 'redo']] },
    ];
    const tb = this.el.toolbar;
    tb.innerHTML = `<button class="brand" title="Home — recent files and new designs">${icon('home')}<span class="logo">◆</span> OpenCAD</button>`;
    tb.querySelector('.brand').onclick = () => this.goHome();
    for (const g of groups) {
      if (this.api && g.title === 'File') {
        // Electron has a native File menu; keep only export/import buttons
        g.items = g.items.filter((i) => !['new', 'open'].includes(i[0]));
      }
      const grp = document.createElement('div');
      grp.className = 'tb-group';
      const items = document.createElement('div');
      items.className = 'tb-items';
      for (const [cmd, label, ic, key] of g.items) {
        const b = document.createElement('button');
        b.className = 'tb-btn';
        b.dataset.cmd = cmd;
        b.title = key ? `${label} (${key})` : label;
        b.innerHTML = `${icon(ic)}<span>${label}</span>`;
        b.onclick = (e) => this.command(cmd, e);
        items.appendChild(b);
      }
      const t = document.createElement('div');
      t.className = 'tb-title';
      t.textContent = g.title;
      grp.append(items, t);
      tb.appendChild(grp);
    }
  }

  buildViewbar() {
    const vb = this.el.viewbar;
    const items = [
      ['view:iso', 'Home view (0)', 'home'], ['view:top', 'Top (2)', null, 'T'], ['view:front', 'Front (1)', null, 'F'],
      ['view:right', 'Right (3)', null, 'R'], ['fit', 'Fit all (F)', 'fit'], ['toggle:ortho', 'Orthographic', 'ortho'],
      ['toggle:edges', 'Edges', 'body'], ['toggle:wire', 'Wireframe', 'wire'], ['toggle:xray', 'X‑ray', 'xray'],
      ['toggle:grid', 'Grid', 'grid'], ['screenshot', 'Save image', 'camera'],
    ];
    vb.innerHTML = '';
    for (const [cmd, title, ic, txt] of items) {
      const b = document.createElement('button');
      b.className = 'vb-btn';
      b.dataset.cmd = cmd;
      b.title = title;
      b.innerHTML = ic ? icon(ic) : `<b>${txt}</b>`;
      b.onclick = () => this.command(cmd);
      vb.appendChild(b);
    }
    this.display = { ortho: false, edges: true, wire: false, xray: false, grid: true };
    this.syncViewbar();
  }

  syncViewbar() {
    for (const b of this.el.viewbar.querySelectorAll('[data-cmd^="toggle:"]')) {
      b.classList.toggle('active', !!this.display[b.dataset.cmd.split(':')[1]]);
    }
  }

  // ===================== commands =====================

  command(cmd, arg) {
    if (cmd.startsWith('view:')) { this.vp.resetUp(); return this.vp.setView(cmd.slice(5)); }
    if (cmd.startsWith('toggle:')) return this.toggleDisplay(cmd.slice(7));
    if (this.landing.visible && !['new', 'open', 'openFile', 'examples', 'about', 'shortcuts', 'home'].includes(cmd)) return;
    if (FEATURES[cmd] && cmd !== 'sketch' && cmd !== 'importMesh') return this.createFeature(cmd);
    switch (cmd) {
      case 'new': return this.newDoc();
      case 'open': return this.openDoc();
      case 'openFile': return this.openDoc(arg);
      case 'saveThenClose': return this.saveDoc(false).then((ok) => ok && this.api?.closeWindow());
      case 'save': return this.saveDoc(false);
      case 'saveAs': return this.saveDoc(true);
      case 'menu:export': return this.exportMenu(arg);
      case 'exportStl': return this.exportMesh('stl');
      case 'exportObj': return this.exportMesh('obj');
      case 'importStl':
      case 'importMesh': return this.importMesh();
      case 'home': return this.goHome();
      case 'sketch': return this.startSketchFlow();
      case 'measure': return this.toggleMeasure();
      case 'params': return this.openParameters();
      case 'undo': return document.activeElement?.matches?.('input,textarea') ? document.execCommand('undo') : this.undo();
      case 'redo': return document.activeElement?.matches?.('input,textarea') ? document.execCommand('redo') : this.redo();
      case 'fit': return this.vp.fit();
      case 'screenshot': return this.saveScreenshot();
      case 'examples': return this.openExamples();
      case 'quality': return this.setQuality(arg);
      case 'deleteSelection': return this.deleteSelectedBodies();
      case 'selectAll': this.selection = new Set(this.result.bodies.map((b) => b.id)); this.vp.setSelection(this.selection); return this.renderBrowser();
      case 'shortcuts': return this.showShortcuts();
      case 'about': return this.modal({ title: 'OpenCAD Studio', body: '<p>Free, open-source parametric CAD.<br/>Geometry by the Manifold kernel, rendering by three.js.</p>' });
      default: console.warn('Unknown command', cmd);
    }
  }

  toggleDisplay(k) {
    this.display[k] = !this.display[k];
    if (k === 'ortho') this.vp.setOrthographic(this.display.ortho);
    if (k === 'grid') this.vp.setGridVisible(this.display.grid);
    if (['edges', 'wire', 'xray'].includes(k)) this.vp.setDisplay({ edges: this.display.edges, wireframe: this.display.wire, xray: this.display.xray }, this.doc.bodyProps);
    this.syncViewbar();
  }

  setQuality(segments) {
    this.change((d) => { d.settings.segments = Number(segments) || 64; });
    this.toast(`Curve quality: ${segments} segments`);
  }

  // ===================== feature creation & editing =====================

  nextBodyName() {
    const names = new Set([...this.result.bodies.map((b) => b.name), ...Object.values(this.doc.bodyProps).map((p) => p.name)]);
    let i = 1;
    while (names.has(`Body${i}`)) i++;
    return `Body${i}`;
  }

  nextFeatureName(type) {
    const label = FEATURES[type].label.replace(/\s+/g, '');
    let i = 1;
    const names = new Set(this.doc.features.map((f) => f.name));
    while (names.has(`${label}${i}`)) i++;
    return `${label}${i}`;
  }

  createFeature(type, extra = {}) {
    if (this.mode === 'sketch') return this.toast('Finish the sketch first');
    if (this.editing) this.commitEdit();
    this.exitMeasure();
    const def = FEATURES[type];
    const f = { id: uid(), type, name: this.nextFeatureName(type), params: defaultParams(type), ...extra };
    delete f._autoOp;
    const bodies = this.result.bodies;
    const sel = [...this.selection].filter((id) => bodies.some((b) => b.id === id));
    const lastBody = bodies[bodies.length - 1]?.id;
    const has = (k) => def.fields.some((x) => x.key === k);

    if (has('sketch')) {
      const sketches = this.result.sketches.filter((s) => s.area > 0);
      const unconsumed = sketches.filter((s) => !s.consumed);
      const pick = (unconsumed[unconsumed.length - 1] || sketches[sketches.length - 1]);
      if (!pick) return this.toast('Create a sketch with a closed shape first (S)', 'error');
      f.params.sketch = pick.id;
      const onBody = this.featureById(pick.id)?.params.onBody;
      if (onBody && bodies.some((b) => b.id === onBody)) {
        // sketch drawn on a face: join by default, cut when extruding inward
        f.params.operation = 'join';
        f.params.target = onBody;
        extra._autoOp = true;
      }
    }
    if (has('tools')) {
      if (sel.length < 2) return this.toast('Select a target body, then ⇧‑click tool bodies to combine', 'error');
      f.params.target = sel[0];
      f.params.tools = sel.slice(1);
    } else if (has('target') && !has('operation')) {
      const t = sel[0] || lastBody;
      if (!t) return this.toast('Create a body first', 'error');
      f.params.target = t;
    } else if (has('operation')) {
      f.params.target = sel[0] || lastBody || '';
    }
    if (type === 'move') {
      const b = bodies.find((x) => x.id === f.params.target);
      if (b?.bbox) ['px', 'py', 'pz'].forEach((k, i) => { f.params[k] = String(fmt((b.bbox.min[i] + b.bbox.max[i]) / 2, 3)).replace(/,/g, ''); });
    }
    if (type === 'circularPattern' || type === 'mirror' || type === 'linearPattern') {
      // sensible spacing based on the body size
      const b = bodies.find((x) => x.id === f.params.target);
      if (b?.bbox && type === 'linearPattern') f.params.spacing = String(Math.ceil((b.bbox.max[0] - b.bbox.min[0]) * 1.5));
    }
    const before = this.snapshot();
    this.doc.features.push(f);
    if (has('operation')) this.doc.bodyProps[f.id] = { ...(this.doc.bodyProps[f.id] || {}), name: this.nextBodyName() };
    this.regen();
    this.openPanel(f, { isNew: true, before });
    this.editing.autoOp = !!extra._autoOp;
  }

  editFeature(id) {
    if (this.mode === 'sketch') return this.toast('Finish the sketch first');
    const f = this.featureById(id);
    if (!f) return;
    if (this.editing) this.commitEdit();
    if (f.type === 'sketch') return this.editSketch(f);
    this.openPanel(f, { isNew: false, before: this.snapshot() });
  }

  openPanel(f, { isNew, before }) {
    this.editing = { feature: f, isNew, before, def: { ...FEATURES[f.type], type: f.type }, gizmoMode: 'translate' };
    this.renderPanel();
    if (f.type === 'move') this.attachMoveGizmo();
  }

  renderPanel() {
    const ed = this.editing;
    const P = this.el.panel;
    if (!ed) { P.classList.remove('open'); P.innerHTML = ''; return; }
    const f = ed.feature;
    const def = FEATURES[f.type];
    const before = this.result.before?.[f.id] || { bodies: [], sketches: [] };
    P.classList.add('open');
    P.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = `<span>${icon(def.icon)} ${esc(def.label)}</span>`;
    const nameIn = document.createElement('input');
    nameIn.className = 'name-input';
    nameIn.value = f.name;
    nameIn.onchange = () => { f.name = nameIn.value.trim() || f.name; this.renderTimeline(); };
    head.appendChild(nameIn);
    P.appendChild(head);

    const form = document.createElement('div');
    form.className = 'form';
    const groups = new Map();
    for (const field of def.fields) {
      if (field.showIf && !field.showIf(f.params)) continue;
      let container = form;
      if (field.group) {
        if (!groups.has(field.group)) {
          const g = document.createElement('div');
          g.className = 'field-group';
          g.innerHTML = `<div class="group-label">${esc(field.group)}</div><div class="group-row"></div>`;
          form.appendChild(g);
          groups.set(field.group, g.querySelector('.group-row'));
        }
        container = groups.get(field.group);
      }
      container.appendChild(this.renderField(f, field, before, !!field.group));
    }
    P.appendChild(form);

    if (f.type === 'move') {
      const gm = document.createElement('div');
      gm.className = 'seg';
      gm.innerHTML = `<button data-m="translate" class="${ed.gizmoMode === 'translate' ? 'active' : ''}">${icon('move')} Translate</button><button data-m="rotate" class="${ed.gizmoMode === 'rotate' ? 'active' : ''}">${icon('rotate')} Rotate</button>`;
      gm.onclick = (e) => {
        const m = e.target.closest('button')?.dataset.m;
        if (!m) return;
        ed.gizmoMode = m;
        this.attachMoveGizmo();
        this.renderPanel();
      };
      P.appendChild(gm);
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = 'Drag the gizmo in the viewport or type exact values. Hold ⇧ while dragging to snap.';
      P.appendChild(h);
    }
    if (def.fields.some((x) => x.type === 'body' || x.type === 'bodies')) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = def.fields.some((x) => x.type === 'bodies')
        ? 'Click bodies in the viewport: first sets the target, next ones toggle tools.'
        : 'Tip: click a body in the viewport to pick it.';
      P.appendChild(h);
    }

    const err = this.result.errors[f.id];
    if (err) {
      const e = document.createElement('div');
      e.className = 'error-box';
      e.innerHTML = `${icon('warn')} ${esc(err)}`;
      P.appendChild(e);
    }

    const foot = document.createElement('div');
    foot.className = 'panel-foot';
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    cancel.onclick = () => this.cancelEdit();
    const ok = document.createElement('button');
    ok.className = 'btn primary';
    ok.textContent = 'OK';
    ok.onclick = () => this.commitEdit();
    foot.append(cancel, ok);
    P.appendChild(foot);

    const first = P.querySelector('.form input[type=text]');
    if (ed.isNew && first && !ed.focused) { ed.focused = true; setTimeout(() => { first.focus(); first.select(); }, 30); }
  }

  renderField(f, field, before, compact) {
    const row = document.createElement('label');
    row.className = compact ? 'cell' : 'row';
    const lab = document.createElement('span');
    lab.textContent = field.label;
    row.appendChild(lab);
    const update = (v, rerender = false) => {
      f.params[field.key] = v;
      if (field.key === 'operation' && this.editing) this.editing.autoOp = false;
      if (field.key === 'distance' && this.editing?.autoOp) {
        let n = 1;
        try { n = evaluate(v, this.result.scope); } catch { /* keep */ }
        const op = (n < 0) !== (f.params.direction === 'reverse') ? 'cut' : 'join';
        if (f.params.operation !== op) {
          f.params.operation = op;
          const sel = this.el.panel.querySelector('select[data-key="operation"]');
          if (sel) sel.value = op;
        }
      }
      this.queueRegen(rerender);
    };
    const bodyName = (id) => before.bodies.find((b) => b.id === id)?.name || this.result.bodies.find((b) => b.id === id)?.name || '(missing)';

    switch (field.type) {
      case 'number': {
        const wrap = document.createElement('div');
        wrap.className = 'num-wrap';
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.spellcheck = false;
        inp.value = f.params[field.key] ?? '';
        const val = document.createElement('span');
        val.className = 'num-val';
        const refresh = () => {
          try {
            const v = evaluate(inp.value, this.result.scope);
            inp.classList.remove('bad');
            val.textContent = /^[-+]?[0-9.]+$/.test(inp.value.trim()) ? '' : `= ${fmt(v, 3)}`;
          } catch (e) {
            inp.classList.add('bad');
            val.textContent = '';
            inp.title = e.message;
          }
        };
        refresh();
        inp.oninput = () => { refresh(); if (!inp.classList.contains('bad')) update(inp.value); };
        inp.onkeydown = (e) => {
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && /^[-+]?[0-9.]+$/.test(inp.value.trim())) {
            e.preventDefault();
            const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
            const n = Number(inp.value) + (e.key === 'ArrowUp' ? step : -step);
            inp.value = String(Math.round(n * 1000) / 1000);
            refresh();
            update(inp.value);
          }
          if (e.key === 'Enter') { e.preventDefault(); this.flushRegen(); this.commitEdit(); }
          if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); }
        };
        wrap.append(inp, val);
        row.appendChild(wrap);
        break;
      }
      case 'select': {
        const sel = document.createElement('select');
        sel.dataset.key = field.key;
        for (const o of field.options) sel.add(new Option(o.label, o.value));
        sel.value = f.params[field.key] ?? field.default;
        sel.onchange = () => update(sel.value, true);
        row.appendChild(sel);
        break;
      }
      case 'bool': {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!f.params[field.key];
        cb.onchange = () => update(cb.checked, true);
        row.appendChild(cb);
        row.classList.add('bool');
        break;
      }
      case 'body': {
        const sel = document.createElement('select');
        sel.add(new Option('— pick a body —', ''));
        for (const b of before.bodies) sel.add(new Option(b.name, b.id));
        if (f.params[field.key] && !before.bodies.some((b) => b.id === f.params[field.key])) sel.add(new Option(`${bodyName(f.params[field.key])} (missing)`, f.params[field.key]));
        sel.value = f.params[field.key] || '';
        sel.onchange = () => update(sel.value, true);
        row.appendChild(sel);
        break;
      }
      case 'bodies': {
        const list = document.createElement('div');
        list.className = 'check-list';
        const cur = new Set(f.params[field.key] || []);
        for (const b of before.bodies) {
          if (b.id === f.params.target) continue;
          const l = document.createElement('label');
          l.innerHTML = `<input type="checkbox" ${cur.has(b.id) ? 'checked' : ''}/> ${esc(b.name)}`;
          l.querySelector('input').onchange = (e) => {
            if (e.target.checked) cur.add(b.id); else cur.delete(b.id);
            update([...cur]);
          };
          list.appendChild(l);
        }
        if (!list.children.length) list.innerHTML = '<span class="muted">No other bodies</span>';
        row.appendChild(list);
        row.classList.add('stack');
        break;
      }
      case 'sketch': {
        const sel = document.createElement('select');
        sel.add(new Option('— pick a sketch —', ''));
        for (const s of before.sketches) sel.add(new Option(s.name, s.id));
        sel.value = f.params[field.key] || '';
        sel.onchange = () => update(sel.value, true);
        row.appendChild(sel);
        break;
      }
      default:
        break;
    }
    return row;
  }

  queueRegen(rerender) {
    clearTimeout(this._regenT);
    this._regenT = setTimeout(() => {
      this._regenT = null;
      this.regen();
      if (rerender) this.renderPanel();
      else this.updatePanelError();
    }, 90);
  }

  flushRegen() {
    if (this._regenT) { clearTimeout(this._regenT); this._regenT = null; this.regen(); }
  }

  updatePanelError() {
    if (!this.editing) return;
    const P = this.el.panel;
    const err = this.result.errors[this.editing.feature.id];
    let box = P.querySelector('.error-box');
    if (err) {
      if (!box) {
        box = document.createElement('div');
        box.className = 'error-box';
        P.insertBefore(box, P.querySelector('.panel-foot'));
      }
      box.innerHTML = `${icon('warn')} ${esc(err)}`;
    } else if (box) box.remove();
  }

  commitEdit() {
    const ed = this.editing;
    if (!ed) return;
    this.flushRegen();
    this.editing = null;
    this.vp.detachGizmo();
    this.renderPanel();
    this.commit(ed.before);
  }

  cancelEdit() {
    const ed = this.editing;
    if (!ed) return;
    clearTimeout(this._regenT);
    this.editing = null;
    this.vp.detachGizmo();
    this.doc = JSON.parse(ed.before);
    this.renderPanel();
    this.regen();
  }

  closePanel(silent) {
    if (this.editing) { if (silent) { this.editing = null; this.vp.detachGizmo(); } else this.commitEdit(); }
    this.renderPanel();
  }

  // ---------- move gizmo ----------

  attachMoveGizmo() {
    const ed = this.editing;
    if (!ed || ed.feature.type !== 'move') return;
    const f = ed.feature;
    const targetId = f.params.copy ? f.id : f.params.target;
    if (!this.result.bodies.some((b) => b.id === targetId)) return this.vp.detachGizmo();
    this.vp.attachGizmo(targetId, ed.gizmoMode);
    this.vp.setGizmoSnap(null, null);
  }

  onGizmoEnd(delta) {
    const ed = this.editing;
    if (!ed || ed.feature.type !== 'move') return;
    const f = ed.feature;
    const s = this.result.scope;
    const ev = (k) => { try { return evaluate(f.params[k] ?? 0, s); } catch { return 0; } };
    const pivot = [ev('px'), ev('py'), ev('pz')];
    const old = moveMatrix([ev('tx'), ev('ty'), ev('tz')], [ev('rx'), ev('ry'), ev('rz')], pivot);
    const next = delta.clone().multiply(old);
    const { t, r } = decomposeMove(next, pivot);
    const round = (v) => String(Math.round(v * 1000) / 1000);
    ['tx', 'ty', 'tz'].forEach((k, i) => { f.params[k] = round(t[i]); });
    ['rx', 'ry', 'rz'].forEach((k, i) => { f.params[k] = round(r[i]); });
    this.regen();
    this.renderPanel();
  }

  // ===================== sketching =====================

  startSketchFlow() {
    if (this.mode === 'sketch') return;
    if (this.editing) this.commitEdit();
    this.exitMeasure();
    this.mode = 'pickPlane';
    this.vp.resetUp();
    this.vp.showPlanePicker();
    this.renderStatus('Click an origin plane or a flat face of a body to sketch on. Esc to cancel.');
    this.el.panel.classList.add('open');
    this.el.panel.innerHTML = `<div class="panel-head"><span>${icon('sketch')} New Sketch</span></div>
      <div class="hint">Pick a plane in the viewport, or a flat face of a body.</div>
      <div class="plane-buttons">
        <button class="btn" data-p="XY">XY · Top</button>
        <button class="btn" data-p="XZ">XZ · Front</button>
        <button class="btn" data-p="YZ">YZ · Right</button>
      </div>
      <div class="panel-foot"><button class="btn" data-cancel>Cancel</button></div>`;
    this.el.panel.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => this.beginSketch({ plane: b.dataset.p, offset: '0' }); });
    this.el.panel.querySelector('[data-cancel]').onclick = () => this.cancelPlanePick();
  }

  cancelPlanePick() {
    this.vp.hidePlanePicker();
    this.mode = 'normal';
    this.el.panel.classList.remove('open');
    this.el.panel.innerHTML = '';
    this.renderStatus();
  }

  beginSketch(planeParams) {
    this.vp.hidePlanePicker();
    const before = this.snapshot();
    const f = { id: uid(), type: 'sketch', name: this.nextFeatureName('sketch'), params: { ...defaultParams('sketch'), ...planeParams }, shapes: [] };
    this.doc.features.push(f);
    this.editSketch(f, before, true);
  }

  editSketch(f, before = this.snapshot(), isNew = false) {
    this.mode = 'sketch';
    this.selection.clear();
    this.vp.setSelection(this.selection);
    const frame = sketchFrame(f.params, this.result.scope);
    this.sketcher.segments = this.doc.settings.segments;
    this.vp.setSketches(this.result.sketches, this.visibleSketchIds(), f.id);
    this.renderStatus();
    this.sketcher.start(f, frame, {
      onFinish: (shapes) => {
        f.shapes = shapes;
        this.mode = 'normal';
        this.vp.resetUp();
        this.commit(before);
        this.vp.setView('iso');
        if (isNew && shapes.length) this.toast('Sketch done — press E to extrude it');
        if (isNew && !shapes.length) {
          this.doc.features = this.doc.features.filter((x) => x !== f);
          this.regen();
        }
      },
      onCancel: () => {
        this.mode = 'normal';
        this.vp.resetUp();
        this.doc = JSON.parse(before);
        this.regen();
        this.vp.setView('iso');
      },
      onChange: () => this.renderStatus(),
    });
    this.renderTimeline();
  }

  // ===================== measure =====================

  toggleMeasure() {
    if (this.mode === 'measure') return this.exitMeasure();
    if (this.mode === 'sketch') return;
    if (this.editing) this.commitEdit();
    this.mode = 'measure';
    this.measurePts = [];
    this.measureObjs = [];
    this.el.toolbar.querySelector('[data-cmd=measure]')?.classList.add('active');
    this.renderStatus('Measure: click two points on bodies. Esc to exit.');
  }

  exitMeasure() {
    if (this.mode !== 'measure') return;
    this.mode = 'normal';
    this.clearMeasure();
    this.el.toolbar.querySelector('[data-cmd=measure]')?.classList.remove('active');
    this.renderStatus();
  }

  clearMeasure() {
    for (const o of this.measureObjs || []) {
      if (o.el) this.vp.removeLabel(o); else this.vp.removeOverlay(o);
    }
    this.measureObjs = [];
    this.measurePts = [];
  }

  measureClick(hit) {
    if (this.measurePts.length >= 2) this.clearMeasure();
    const dot = new THREE.Mesh(new THREE.SphereGeometry(this.vp.worldPerPixel() * 4, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb02e, depthTest: false }));
    dot.position.copy(hit.point);
    dot.renderOrder = 10;
    this.vp.addOverlay(dot);
    this.measureObjs.push(dot);
    this.measurePts.push(hit.point.clone());
    if (this.measurePts.length === 2) {
      const [a, b] = this.measurePts;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xffb02e, depthTest: false }));
      line.renderOrder = 10;
      this.vp.addOverlay(line);
      this.measureObjs.push(line);
      const d = a.distanceTo(b);
      const lbl = this.vp.addLabel(a.clone().add(b).multiplyScalar(0.5), `${fmt(d, 3)} mm`, 'measure');
      this.measureObjs.push(lbl);
      this.renderStatus(`Distance ${fmt(d, 3)} mm   ΔX ${fmt(b.x - a.x, 3)}   ΔY ${fmt(b.y - a.y, 3)}   ΔZ ${fmt(b.z - a.z, 3)}`);
    }
  }

  // ===================== viewport interaction =====================

  bindViewportEvents() {
    const dom = this.vp.dom;
    let down = null;
    dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
    dom.addEventListener('pointermove', (e) => {
      if (this.mode === 'sketch' || e.buttons) return;
      if (this.mode === 'pickPlane') {
        const p = this.vp.pickPlane(e);
        const hit = p ? null : this.vp.pickBody(e);
        this.vp.highlightPickerPlane(p);
        this.vp.setHover(hit?.bodyId || null);
        dom.style.cursor = p || hit ? 'pointer' : 'default';
        return;
      }
      const hit = this.vp.pickBody(e);
      this.vp.setHover(hit?.bodyId || null);
      dom.style.cursor = this.mode === 'measure' ? 'crosshair' : hit ? 'pointer' : 'default';
    });
    dom.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return; }
      const button = down.b;
      down = null;
      if (this.mode === 'sketch' || this.vp.gizmo.dragging) return;
      if (this.vp.gizmo.axis && button === 0) return; // clicked on gizmo handle
      if (button === 2) return this.contextMenuAt(e);
      if (button !== 0) return;
      if (this.mode === 'pickPlane') {
        const p = this.vp.pickPlane(e);
        if (p) return this.beginSketch({ plane: p, offset: '0' });
        const hit = this.vp.pickBody(e);
        if (hit) return this.beginSketch({ ...planeFromFace(hit.point.toArray(), hit.normal.toArray()), onBody: hit.bodyId });
        return;
      }
      const hit = this.vp.pickBody(e);
      if (this.mode === 'measure') { if (hit) this.measureClick(hit); return; }
      if (this.editing && hit && this.pickIntoEditor(hit.bodyId)) return;
      this.selectBody(hit?.bodyId || null, e.shiftKey || e.metaKey);
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerleave', () => this.vp.setHover(null));
  }

  pickIntoEditor(bodyId) {
    const f = this.editing.feature;
    const def = FEATURES[f.type];
    const before = this.result.before?.[f.id]?.bodies || [];
    if (!before.some((b) => b.id === bodyId)) return false;
    if (def.fields.some((x) => x.key === 'tools')) {
      if (!f.params.target) f.params.target = bodyId;
      else if (bodyId !== f.params.target) {
        const s = new Set(f.params.tools || []);
        if (s.has(bodyId)) s.delete(bodyId); else s.add(bodyId);
        f.params.tools = [...s];
      }
    } else if (def.fields.some((x) => x.key === 'target' && (!x.showIf || x.showIf(f.params)))) {
      f.params.target = bodyId;
      if (f.type === 'move') {
        const b = this.result.bodies.find((x) => x.id === bodyId);
        if (b?.bbox) ['px', 'py', 'pz'].forEach((k, i) => { f.params[k] = String(Math.round(((b.bbox.min[i] + b.bbox.max[i]) / 2) * 1000) / 1000); });
      }
    } else return false;
    this.regen();
    this.renderPanel();
    return true;
  }

  selectBody(id, additive) {
    if (!additive) this.selection.clear();
    if (id) {
      if (additive && this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    }
    this.vp.setSelection(this.selection);
    this.renderBrowser();
    this.renderStatus();
  }

  contextMenuAt(e) {
    const hit = this.vp.pickBody(e);
    if (!hit) return;
    if (!this.selection.has(hit.bodyId)) this.selectBody(hit.bodyId, false);
    this.bodyMenu(hit.bodyId, e.clientX, e.clientY);
  }

  bodyMenu(id, x, y) {
    const b = this.result.bodies.find((q) => q.id === id);
    if (!b) return;
    const creator = this.featureById(b.creator);
    this.popupMenu(x, y, [
      ['Move / Rotate…', () => this.createFeature('move')],
      ['Sketch on face', () => { this.startSketchFlow(); }],
      ['Edit creating feature', creator ? () => this.editFeature(creator.id) : null],
      ['-'],
      ['Rename…', () => this.renameBody(id)],
      ['Change color…', () => this.pickColor(id)],
      [this.isBodyVisible(id) ? 'Hide' : 'Show', () => this.toggleBodyVisible(id)],
      ['Isolate', () => this.isolate(id)],
      ['-'],
      ['Export as STL…', () => this.exportMesh('stl', [id])],
      ['Remove body', () => this.deleteSelectedBodies()],
    ]);
  }

  popupMenu(x, y, items) {
    document.querySelector('.popup-menu')?.remove();
    const m = document.createElement('div');
    m.className = 'popup-menu';
    for (const [label, fn] of items) {
      if (label === '-') { m.appendChild(Object.assign(document.createElement('hr'))); continue; }
      const it = document.createElement('button');
      it.textContent = label;
      it.disabled = !fn;
      it.onclick = () => { m.remove(); fn?.(); };
      m.appendChild(it);
    }
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
    m.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
    const close = (ev) => { if (!m.contains(ev.target)) { m.remove(); window.removeEventListener('pointerdown', close, true); } };
    setTimeout(() => window.addEventListener('pointerdown', close, true), 0);
  }

  // ===================== body operations =====================

  isBodyVisible(id) { return this.doc.bodyProps[id]?.visible !== false; }

  setBodyProp(id, patch, record = true) {
    const before = this.snapshot();
    this.doc.bodyProps[id] = { ...(this.doc.bodyProps[id] || {}), ...patch };
    if (record) { this.undoStack.push(before); this.redoStack = []; }
    this.setDirty(true);
    this.vp.applyBodyProps(this.doc.bodyProps);
    this.renderBrowser();
  }

  toggleBodyVisible(id) {
    this.setBodyProp(id, { visible: !this.isBodyVisible(id) });
    if (!this.isBodyVisible(id)) { this.selection.delete(id); this.vp.setSelection(this.selection); }
  }

  isolate(id) {
    const before = this.snapshot();
    for (const b of this.result.bodies) this.doc.bodyProps[b.id] = { ...(this.doc.bodyProps[b.id] || {}), visible: b.id === id };
    this.commit(before);
  }

  renameBody(id) {
    const b = this.result.bodies.find((q) => q.id === id);
    this.prompt('Rename body', b?.name || '', (name) => {
      if (!name) return;
      this.change((d) => { d.bodyProps[id] = { ...(d.bodyProps[id] || {}), name }; });
    });
  }

  pickColor(id) {
    const inp = document.createElement('input');
    inp.type = 'color';
    const idx = this.result.bodies.findIndex((b) => b.id === id);
    inp.value = this.doc.bodyProps[id]?.color || defaultBodyColor(idx);
    inp.style.position = 'fixed';
    inp.style.opacity = '0';
    document.body.appendChild(inp);
    inp.oninput = () => { this.doc.bodyProps[id] = { ...(this.doc.bodyProps[id] || {}), color: inp.value }; this.vp.applyBodyProps(this.doc.bodyProps); this.renderBrowser(); };
    inp.onchange = () => { this.setBodyProp(id, { color: inp.value }); inp.remove(); };
    inp.click();
  }

  deleteSelectedBodies() {
    const ids = [...this.selection];
    if (!ids.length) return this.toast('Select a body first');
    const before = this.snapshot();
    for (const id of ids) {
      const creator = this.featureById(id);
      const dependents = this.doc.features.some((f) => f !== creator && JSON.stringify(f.params).includes(`"${id}"`));
      if (creator && !dependents && FEATURES[creator.type].fields.some((x) => x.key === 'operation')) {
        // remove the feature that created it entirely
        this.doc.features = this.doc.features.filter((f) => f !== creator);
        delete this.doc.bodyProps[id];
      } else {
        this.doc.features.push({ id: uid(), type: 'remove', name: this.nextFeatureName('remove'), params: { target: id } });
      }
    }
    this.selection.clear();
    this.commit(before);
  }

  // ===================== timeline =====================

  renderTimeline() {
    const tl = this.el.timeline;
    tl.innerHTML = '';
    const label = document.createElement('div');
    label.className = 'tl-label';
    label.textContent = 'Timeline';
    tl.appendChild(label);
    const track = document.createElement('div');
    track.className = 'tl-track';
    if (!this.doc.features.length) track.innerHTML = '<span class="muted">Your modeling steps will appear here.</span>';
    for (const f of this.doc.features) {
      const def = FEATURES[f.type];
      if (!def) continue;
      const chip = document.createElement('button');
      const err = this.result?.errors?.[f.id];
      chip.className = `tl-chip${f.suppressed ? ' suppressed' : ''}${err ? ' error' : ''}${this.editing?.feature.id === f.id || this.sketcher.feature?.id === f.id && this.mode === 'sketch' ? ' editing' : ''}`;
      chip.title = `${f.name}${err ? ` — ${err}` : ''}\nClick to edit · right-click for options`;
      chip.innerHTML = `${icon(def.icon)}<span>${esc(f.name)}</span>${err ? icon('warn', 'warn') : ''}`;
      chip.onclick = () => this.editFeature(f.id);
      chip.oncontextmenu = (e) => { e.preventDefault(); this.featureMenu(f, e.clientX, e.clientY); };
      track.appendChild(chip);
    }
    tl.appendChild(track);
    track.scrollLeft = track.scrollWidth;
  }

  featureMenu(f, x, y) {
    this.popupMenu(x, y, [
      ['Edit', () => this.editFeature(f.id)],
      ['Rename…', () => this.prompt('Rename feature', f.name, (n) => n && this.change(() => { f.name = n; }))],
      [f.suppressed ? 'Unsuppress' : 'Suppress', () => this.change(() => { f.suppressed = !f.suppressed; })],
      ['Move earlier', this.doc.features.indexOf(f) > 0 ? () => this.reorder(f, -1) : null],
      ['Move later', this.doc.features.indexOf(f) < this.doc.features.length - 1 ? () => this.reorder(f, 1) : null],
      ['-'],
      ['Delete', () => this.deleteFeature(f.id)],
    ]);
  }

  reorder(f, dir) {
    this.change((d) => {
      const i = d.features.indexOf(f);
      const j = i + dir;
      [d.features[i], d.features[j]] = [d.features[j], d.features[i]];
    });
  }

  deleteFeature(id) {
    if (this.editing?.feature.id === id) this.cancelEdit();
    const f = this.featureById(id);
    if (!f) return;
    const ids = new Set([id]);
    for (const b of this.result.bodies) if (b.creator === id) ids.add(b.id);
    const dependents = this.doc.features.filter((x) => x.id !== id && [...ids].some((i) => JSON.stringify(x.params).includes(`"${i}"`)));
    const doIt = () => this.change((d) => {
      d.features = d.features.filter((x) => x.id !== id);
      delete d.bodyProps[id];
    });
    if (dependents.length) {
      this.modal({
        title: `Delete ${esc(f.name)}?`,
        body: `<p>${dependents.length} later feature(s) depend on it (${dependents.map((x) => esc(x.name)).join(', ')}). They will show errors until fixed.</p>`,
        buttons: [{ label: 'Cancel' }, { label: 'Delete', danger: true, action: doIt }],
      });
    } else doIt();
  }

  // ===================== browser =====================

  renderBrowser() {
    const B = this.el.browser;
    B.innerHTML = '';
    const doc = document.createElement('div');
    doc.className = 'br-doc';
    doc.innerHTML = `${icon('folder')} <span>${esc(this.fileName)}</span>`;
    B.appendChild(doc);

    const sec = (title, count) => {
      const s = document.createElement('div');
      s.className = 'br-section';
      s.innerHTML = `<div class="br-title">${title} <span class="count">${count}</span></div>`;
      B.appendChild(s);
      return s;
    };

    const bodies = sec('Bodies', this.result.bodies.length);
    this.result.bodies.forEach((b, i) => {
      const vis = this.isBodyVisible(b.id);
      const row = document.createElement('div');
      row.className = `br-row${this.selection.has(b.id) ? ' sel' : ''}${vis ? '' : ' hidden'}`;
      const color = this.doc.bodyProps[b.id]?.color || defaultBodyColor(i);
      row.innerHTML = `<button class="eye" title="Show/hide">${icon(vis ? 'eye' : 'eyeoff')}</button>
        <span class="swatch" style="background:${color}" title="Color"></span><span class="nm">${esc(b.name)}</span>`;
      row.querySelector('.eye').onclick = (e) => { e.stopPropagation(); this.toggleBodyVisible(b.id); };
      row.querySelector('.swatch').onclick = (e) => { e.stopPropagation(); this.pickColor(b.id); };
      row.onclick = (e) => {
        if (this.editing && this.pickIntoEditor(b.id)) return;
        this.selectBody(b.id, e.shiftKey || e.metaKey);
      };
      row.ondblclick = () => this.renameBody(b.id);
      row.oncontextmenu = (e) => { e.preventDefault(); this.selectBody(b.id, false); this.bodyMenu(b.id, e.clientX, e.clientY); };
      bodies.appendChild(row);
    });

    const sks = sec('Sketches', this.result.sketches.length);
    const visSk = this.visibleSketchIds();
    for (const s of this.result.sketches) {
      const vis = visSk.has(s.id);
      const row = document.createElement('div');
      row.className = `br-row${vis ? '' : ' hidden'}`;
      row.innerHTML = `<button class="eye">${icon(vis ? 'eye' : 'eyeoff')}</button>${icon('sketch')}<span class="nm">${esc(s.name)}</span>`;
      row.querySelector('.eye').onclick = (e) => {
        e.stopPropagation();
        this.doc.sketchProps[s.id] = { ...(this.doc.sketchProps[s.id] || {}), visible: !vis };
        this.setDirty(true);
        this.vp.setSketches(this.result.sketches, this.visibleSketchIds(), null, this.doc.settings.segments);
        this.renderBrowser();
      };
      row.ondblclick = () => this.editFeature(s.id);
      row.title = 'Double-click to edit';
      sks.appendChild(row);
    }

    const prm = sec('Parameters', this.doc.parameters.length);
    for (const p of this.doc.parameters) {
      const row = document.createElement('div');
      row.className = 'br-row param';
      const v = this.result.scope[p.name];
      row.innerHTML = `${icon('params')}<span class="nm">${esc(p.name)}</span><span class="val">${v === undefined ? '⚠' : fmt(v, 3)}</span>`;
      row.onclick = () => this.openParameters();
      prm.appendChild(row);
    }
    const addP = document.createElement('button');
    addP.className = 'link-btn';
    addP.innerHTML = `${icon('plus')} Edit parameters`;
    addP.onclick = () => this.openParameters();
    prm.appendChild(addP);

    // inspector for selection
    const sel = this.result.bodies.filter((b) => this.selection.has(b.id));
    if (sel.length) {
      const ins = document.createElement('div');
      ins.className = 'inspector';
      const vol = sel.reduce((a, b) => a + b.volume, 0);
      const area = sel.reduce((a, b) => a + b.area, 0);
      const bb = new THREE.Box3();
      for (const b of sel) if (b.bbox) { bb.expandByPoint(new THREE.Vector3(...b.bbox.min)); bb.expandByPoint(new THREE.Vector3(...b.bbox.max)); }
      const size = bb.isEmpty() ? [0, 0, 0] : bb.getSize(new THREE.Vector3()).toArray();
      const density = 1.24; // PLA g/cm³
      ins.innerHTML = `<div class="br-title">${sel.length === 1 ? esc(sel[0].name) : `${sel.length} bodies`}</div>
        <div class="kv"><span>Size</span><b>${fmt(size[0])} × ${fmt(size[1])} × ${fmt(size[2])} mm</b></div>
        <div class="kv"><span>Volume</span><b>${fmt(vol / 1000, 3)} cm³</b></div>
        <div class="kv"><span>Surface</span><b>${fmt(area / 100, 2)} cm²</b></div>
        <div class="kv"><span>Mass (PLA)</span><b>${fmt((vol / 1000) * density, 2)} g</b></div>`;
      B.appendChild(ins);
    }
  }

  renderStatus(msg) {
    const S = this.el.status;
    const nErr = Object.keys(this.result?.errors || {}).length;
    let text = msg;
    if (!text) {
      if (this.mode === 'sketch') text = 'Sketch mode — draw closed shapes, then Finish Sketch (Enter). Shapes inside other shapes become holes.';
      else if (this.mode === 'measure') text = 'Measure: click two points on bodies. Esc to exit.';
      else if (this.editing) text = `Editing ${this.editing.feature.name} — Enter to accept, Esc to cancel.`;
      else if (!this.doc.features.length) text = 'Start with Sketch (S) or a primitive like Box (B).';
      else text = 'Click to select · ⇧ click to multi-select · right-click for options';
    }
    S.innerHTML = `<span class="msg">${esc(text)}</span>
      ${nErr ? `<span class="err">${icon('warn')} ${nErr} feature error${nErr > 1 ? 's' : ''}</span>` : ''}
      <span class="meta">${this.result?.bodies.length ?? 0} bodies · ${this.doc.features.length} features · ${fmt(this.regenMs || 0, 0)} ms · mm</span>`;
  }

  // ===================== parameters =====================

  openParameters() {
    const before = this.snapshot();
    const rows = this.doc.parameters.map((p) => ({ ...p }));
    const m = this.modal({
      title: 'Parameters',
      body: `<p class="muted">Name values once and use them in any dimension field, e.g. <code>width / 2</code>.</p>
        <table class="ptable"><thead><tr><th>Name</th><th>Expression</th><th>Value</th><th></th></tr></thead><tbody></tbody></table>
        <button class="btn small" data-add>${icon('plus')} Add parameter</button>`,
      buttons: [
        { label: 'Cancel', action: () => { this.doc = JSON.parse(before); this.regen(); } },
        { label: 'OK', primary: true, action: () => { this.doc.parameters = rows.filter((r) => r.name); this.commit(before); } },
      ],
      wide: true,
    });
    const tbody = m.querySelector('tbody');
    const draw = () => {
      tbody.innerHTML = '';
      this.doc.parameters = rows.filter((r) => r.name);
      this.regen();
      rows.forEach((r, i) => {
        const tr = document.createElement('tr');
        const v = this.result.scope[r.name];
        const err = this.result.paramErrors[r.name];
        tr.innerHTML = `<td><input value="${esc(r.name)}" data-k="name" placeholder="width"/></td>
          <td><input value="${esc(r.expr)}" data-k="expr" placeholder="20"/></td>
          <td class="${err ? 'bad' : ''}" title="${esc(err || '')}">${err ? '⚠' : v !== undefined ? fmt(v, 4) : ''}</td>
          <td><button class="icon-btn" title="Delete">${icon('trash')}</button></td>`;
        tr.querySelectorAll('input').forEach((inp) => { inp.onchange = () => { r[inp.dataset.k] = inp.value.trim(); draw(); }; });
        tr.querySelector('button').onclick = () => { rows.splice(i, 1); draw(); };
        tbody.appendChild(tr);
      });
    };
    m.querySelector('[data-add]').onclick = () => {
      let n = rows.length + 1;
      while (rows.some((r) => r.name === `p${n}`)) n++;
      rows.push({ name: `p${n}`, expr: '10' });
      draw();
      tbody.querySelector('tr:last-child input')?.focus();
    };
    draw();
  }

  // ===================== files =====================

  async confirmDiscard() {
    if (!this.dirty || !this.doc.features.length) return true;
    return new Promise((resolve) => {
      this.modal({
        title: 'Discard unsaved changes?',
        body: `<p>Your changes to <b>${esc(this.fileName)}</b> haven't been saved.</p>`,
        buttons: [
          { label: 'Cancel', action: () => resolve(false) },
          { label: 'Save', action: async () => resolve(await this.saveDoc(false)) },
          { label: 'Discard', danger: true, action: () => resolve(true) },
        ],
        onClose: () => resolve(false),
      });
    });
  }

  async newDoc() {
    if (!this.landing.visible && !(await this.confirmDiscard())) return;
    this.loadDoc(emptyDoc());
    this.discardAutosave();
    this.toast('New design — press S to start a sketch');
  }

  /** Show a file picker for designs and meshes, then open the chosen file as a design. */
  async openDoc(file) {
    if (!this.landing.visible && !(await this.confirmDiscard())) return;
    try {
      if (file) return await this.openFileData(file);
      if (this.api) {
        const r = await this.api.openFile({ filters: [
          { name: 'All supported', extensions: OPEN_EXT },
          { name: 'OpenCAD Design', extensions: [FILE_EXT] },
          { name: '3D mesh (STL, OBJ)', extensions: MESH_EXT },
        ] });
        if (r) await this.openFileData(r);
      } else {
        const f = await pickFile(OPEN_EXT.map((e) => `.${e}`).join(','));
        if (f) await this.openFileData({ name: f.name, buffer: await f.arrayBuffer() });
      }
    } catch (e) {
      this.toast(`Could not open file: ${e.message}`, 'error');
    }
  }

  /** Open {name, path?, buffer?|text?|data?}: .ocad loads a design, .stl/.obj becomes a new design. */
  async openFileData(file) {
    const ext = extOf(file.name);
    const text = () => file.text ?? (typeof file.data === 'string' ? file.data : new TextDecoder().decode(toBytes(file.buffer ?? file.data)));
    if (ext === FILE_EXT || ext === 'json') {
      const doc = JSON.parse(text());
      if (!Array.isArray(doc.features)) throw new Error('Not an OpenCAD design file');
      this.loadDoc(doc, baseName(file.name), file.path || null);
      this.rememberRecent({ kind: 'ocad' });
      this.toast(`Opened ${file.name}`);
    } else if (MESH_EXT.includes(ext)) {
      const f = this.meshFeature(file.name, ext === 'obj' ? text() : toBytes(file.buffer ?? file.data).buffer);
      const doc = emptyDoc();
      doc.features.push(f);
      doc.bodyProps[f.id] = { name: f.name };
      this.loadDoc(doc, baseName(file.name), null);
      this.meshSource = { path: file.path || null, name: file.name, kind: ext };
      this.rememberRecent({ kind: ext, path: file.path || null, name: baseName(file.name), doc: file.path ? undefined : this.doc });
      this.reportMeshImport(f, file.name);
    } else {
      throw new Error(`Unsupported file type ".${ext}". Open .ocad, .stl or .obj files.`);
    }
  }

  async openRecent(entry) {
    if (!this.landing.visible && !(await this.confirmDiscard())) return;
    try {
      if (entry.path && this.api) {
        const r = await this.api.readFile(entry.path);
        await this.openFileData(r);
      } else if (entry.doc) {
        this.loadDoc(entry.doc, entry.name, null);
        if (entry.kind && entry.kind !== 'ocad') this.meshSource = { name: entry.name, kind: entry.kind };
        this.rememberRecent({ kind: entry.kind || 'ocad', name: entry.name });
      } else {
        this.toast(`“${entry.name}” isn't stored in the browser — use Open file… to pick it again`, 'error');
      }
    } catch (e) {
      this.toast(`Could not open “${entry.name}”: ${e.message}`, 'error');
    }
  }

  async openTemplate(x) {
    if (!this.landing.visible && !(await this.confirmDiscard())) return;
    this.loadDoc(JSON.parse(JSON.stringify(x.doc)), x.name);
  }

  /** Leave the editor for the start screen. */
  async goHome() {
    if (this.landing.visible) return;
    if (this.mode === 'sketch') this.sketcher.cancel();
    if (this.mode === 'pickPlane') this.cancelPlanePick();
    this.exitMeasure();
    if (this.editing) this.commitEdit();
    this.updateRecentThumb();
    if (!(await this.confirmDiscard())) return;
    if (this.dirty) this.discardAutosave();
    this.doc = emptyDoc();
    this.fileName = 'Untitled';
    this.filePath = null;
    this.meshSource = null;
    this.undoStack = [];
    this.redoStack = [];
    this.selection.clear();
    this.dirty = false;
    this.regen();
    this.landing.show();
  }

  /** Record the current file in the recent list (with a thumbnail once rendered). */
  rememberRecent(extra = {}) {
    const base = this.filePath
      ? { name: this.fileName, path: this.filePath, kind: 'ocad' }
      : { name: this.fileName, path: null, kind: 'ocad', doc: this.api ? undefined : this.doc };
    const entry = { ...base, ...extra };
    if (!entry.path && this.api) return; // unsaved desktop design: nothing to reopen
    this.currentRecent = addRecent(entry);
    clearTimeout(this._thumbT);
    this._thumbT = setTimeout(() => this.updateRecentThumb(), 900);
  }

  updateRecentThumb() {
    const cur = this.currentRecent;
    if (!cur || this.landing.visible) return;
    try {
      const patch = { ...cur, thumb: this.vp.thumbnail(320, 200) };
      if (!cur.path && cur.kind === 'ocad' && !this.api) patch.doc = this.doc;
      if (!cur.path && cur.kind !== 'ocad' && this.meshSource && !this.api) patch.doc = this.doc;
      this.currentRecent = addRecent(patch);
    } catch { /* thumbnail is optional */ }
  }

  async saveDoc(saveAs) {
    const text = JSON.stringify(this.doc, null, 1);
    try {
      if (this.api) {
        let path = this.filePath;
        if (saveAs || !path) {
          path = await this.api.saveDialog({ defaultPath: `${this.fileName}.${FILE_EXT}`, filters: [{ name: 'OpenCAD Design', extensions: [FILE_EXT] }] });
          if (!path) return false;
        }
        await this.api.writeFile(path, text);
        this.filePath = path;
        this.fileName = path.split(/[\\/]/).pop().replace(new RegExp(`\\.${FILE_EXT}$`), '');
      } else {
        download(new Blob([text], { type: 'application/json' }), `${this.fileName}.${FILE_EXT}`);
      }
      this.setDirty(false);
      this.renderBrowser();
      this.meshSource = null;
      this.rememberRecent({ kind: 'ocad', name: this.fileName });
      this.toast(`Saved ${this.fileName}`);
      localStorage.removeItem(AUTOSAVE_KEY);
      return true;
    } catch (e) {
      this.toast(`Save failed: ${e.message}`, 'error');
      return false;
    }
  }

  exportMenu(e) {
    const r = e?.target?.closest?.('button')?.getBoundingClientRect?.();
    const n = this.selection.size;
    const scope = n ? `${n} selected` : 'all visible';
    this.popupMenu(r ? r.left : 100, r ? r.bottom + 4 : 80, [
      [`STL (${scope})`, () => this.exportMesh('stl')],
      [`OBJ (${scope})`, () => this.exportMesh('obj')],
      ['PNG image', () => this.saveScreenshot()],
      ['-'],
      ['Save design as…', () => this.saveDoc(true)],
    ]);
  }

  exportGroup(ids) {
    const group = new THREE.Group();
    const list = ids || (this.selection.size ? [...this.selection] : this.result.bodies.filter((b) => this.isBodyVisible(b.id)).map((b) => b.id));
    for (const id of list) {
      const b = this.result.bodies.find((x) => x.id === id);
      if (!b || !b.positions.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
      g.setIndex(new THREE.BufferAttribute(b.indices, 1));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g);
      m.name = b.name;
      group.add(m);
    }
    return group;
  }

  async exportMesh(kind, ids) {
    const group = this.exportGroup(ids);
    if (!group.children.length) return this.toast('Nothing to export', 'error');
    let data, mime;
    if (kind === 'stl') { data = new STLExporter().parse(group, { binary: true }); mime = 'model/stl'; }
    else { data = new OBJExporter().parse(group); mime = 'text/plain'; }
    const base = group.children.length === 1 ? group.children[0].name : this.fileName;
    await this.saveBinary(data instanceof DataView ? new Uint8Array(data.buffer) : data, `${base}.${kind}`, mime, [{ name: kind.toUpperCase(), extensions: [kind] }]);
  }

  async saveBinary(data, name, mime, filters) {
    try {
      if (this.api) {
        const path = await this.api.saveDialog({ defaultPath: name, filters });
        if (!path) return;
        await this.api.writeFile(path, data);
        this.toast(`Exported ${path.split(/[\\/]/).pop()}`);
      } else {
        download(new Blob([data], { type: mime }), name);
        this.toast(`Exported ${name}`);
      }
    } catch (e) {
      this.toast(`Export failed: ${e.message}`, 'error');
    }
  }

  async saveScreenshot() {
    const url = this.vp.screenshot();
    const bin = atob(url.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await this.saveBinary(bytes, `${this.fileName}.png`, 'image/png', [{ name: 'PNG', extensions: ['png'] }]);
  }

  /** Parse an STL (ArrayBuffer) or OBJ (string) into an importMesh feature. */
  meshFeature(name, data) {
    let geom;
    if (typeof data === 'string') {
      const parts = [];
      new OBJLoader().parse(data).traverse((o) => {
        if (!o.isMesh) return;
        let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
        g.applyMatrix4(o.matrixWorld);
        parts.push(g);
      });
      if (!parts.length) throw new Error('No meshes found in OBJ file');
      geom = parts.length > 1 ? mergeGeometries(parts) : parts[0];
    } else {
      geom = new STLLoader().parse(data);
      geom.deleteAttribute('normal');
    }
    geom = mergeVertices(geom, 1e-4);
    const nTris = geom.index.count / 3;
    if (!nTris) throw new Error('The file contains no triangles');
    if (nTris > 2_000_000) throw new Error('Mesh is too large (over 2 million triangles)');
    const vertices = new Float32Array(geom.attributes.position.array);
    const tris = new Uint32Array(geom.index.array);
    return {
      id: uid(), type: 'importMesh', name: baseName(name), params: defaultParams('importMesh'),
      data: { vertices: encodeArray(vertices), tris: encodeArray(tris) },
    };
  }

  reportMeshImport(f, name) {
    if (this.result.errors[f.id]) this.toast(this.result.errors[f.id], 'error');
    else if (this.result.warnings?.[f.id]) this.toast(`Opened ${name}. ${this.result.warnings[f.id]}`, 'error');
    else this.toast(`Opened ${name}`);
    this.vp.setView('iso');
  }

  /** Import an STL/OBJ into the current design as a new body. */
  async importMesh(file) {
    try {
      if (!file) {
        if (this.api) {
          file = await this.api.openFile({ filters: [{ name: '3D mesh (STL, OBJ)', extensions: MESH_EXT }] });
        } else {
          const f = await pickFile(MESH_EXT.map((e) => `.${e}`).join(','));
          if (f) file = { name: f.name, buffer: await f.arrayBuffer() };
        }
        if (!file) return;
      }
      const ext = extOf(file.name);
      const bytes = toBytes(file.buffer ?? file.data);
      const f = this.meshFeature(file.name, ext === 'obj' ? new TextDecoder().decode(bytes) : bytes.buffer);
      this.change((d) => {
        d.features.push(f);
        d.bodyProps[f.id] = { name: f.name };
      });
      this.reportMeshImport(f, file.name);
    } catch (e) {
      this.toast(`Import failed: ${e.message}`, 'error');
    }
  }

  bindDragDrop() {
    let depth = 0;
    const has = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => { if (has(e)) { depth++; document.body.classList.add('dragging'); } });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
    window.addEventListener('dragover', (e) => { if (has(e)) e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('dragging');
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      const ext = extOf(f.name);
      if (!OPEN_EXT.includes(ext)) return this.toast(`Can't open .${ext} files — use .ocad, .stl or .obj`, 'error');
      const file = { name: f.name, path: this.api?.pathForFile?.(f) || null, buffer: await f.arrayBuffer() };
      // meshes dropped onto an open design are imported into it; everything else opens as its own design
      if (!this.landing.visible && MESH_EXT.includes(ext) && this.doc.features.length) return this.importMesh(file);
      this.openDoc(file);
    });
  }

  openExamples() {
    const ex = buildExamples();
    const m = this.modal({
      title: 'Examples',
      body: `<div class="examples">${ex.map((x, i) => `<button class="ex-card" data-i="${i}"><b>${esc(x.name)}</b><span>${esc(x.description)}</span></button>`).join('')}</div>`,
      buttons: [{ label: 'Close' }],
    });
    m.querySelectorAll('.ex-card').forEach((b) => {
      b.onclick = () => {
        m.closest('.modal-backdrop').remove();
        this.openTemplate(ex[Number(b.dataset.i)]);
      };
    });
  }

  showShortcuts() {
    const rows = [
      ['S', 'Sketch'], ['E', 'Extrude'], ['B', 'Box'], ['Y', 'Cylinder'], ['M', 'Move selected body'], ['J', 'Combine selected'],
      ['I', 'Measure'], ['F', 'Fit view'], ['0 / 1 / 2 / 3', 'Home / Front / Top / Right view'], ['Delete', 'Remove selected bodies'],
      ['⌘Z / ⇧⌘Z', 'Undo / Redo'], ['⌘S', 'Save'], ['Esc', 'Cancel / clear selection'],
      ['Sketch: L R T C P O', 'Line, Rect, Center rect, Circle, Polygon, Slot'], ['Sketch: X', 'Toggle construction'],
    ];
    this.modal({ title: 'Keyboard shortcuts', body: `<table class="ktable">${rows.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</table>` });
  }

  // ===================== keyboard =====================

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const mod = e.metaKey || e.ctrlKey;
      if (document.querySelector('.modal-backdrop')) {
        if (e.key === 'Escape') document.querySelector('.modal-backdrop [data-cancel]')?.click();
        return;
      }
      if (this.landing.visible) {
        if (mod && !this.api && e.key.toLowerCase() === 'o') { e.preventDefault(); this.openDoc(); }
        return;
      }
      if (mod && !this.api) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !typing) { e.preventDefault(); return e.shiftKey ? this.redo() : this.undo(); }
        if (k === 'y' && !typing) { e.preventDefault(); return this.redo(); }
        if (k === 's') { e.preventDefault(); return this.saveDoc(e.shiftKey); }
        if (k === 'o') { e.preventDefault(); return this.openDoc(); }
      }
      if (typing || mod || this.mode === 'sketch') return;
      const k = e.key;
      if (k === 'Escape') {
        if (this.mode === 'pickPlane') return this.cancelPlanePick();
        if (this.mode === 'measure') return this.exitMeasure();
        if (this.editing) return this.cancelEdit();
        return this.selectBody(null, false);
      }
      if (k === 'Enter' && this.editing) return this.commitEdit();
      if ((k === 'Delete' || k === 'Backspace') && this.selection.size && !this.editing) return this.deleteSelectedBodies();
      const map = { s: 'sketch', e: 'extrude', b: 'box', y: 'cylinder', m: 'move', j: 'combine', i: 'measure', f: 'fit', 0: 'view:iso', 1: 'view:front', 2: 'view:top', 3: 'view:right', '?': 'shortcuts' };
      const cmd = map[k.toLowerCase()];
      if (cmd) { e.preventDefault(); this.command(cmd); }
      if (this.editing?.feature.type === 'move' && (k === 't' || k === 'r')) {
        this.editing.gizmoMode = k === 't' ? 'translate' : 'rotate';
        this.attachMoveGizmo();
        this.renderPanel();
      }
    });
  }

  // ===================== UI helpers =====================

  toast(msg, kind = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), kind === 'error' ? 4500 : 2600);
    setTimeout(() => t.remove(), kind === 'error' ? 5000 : 3100);
  }

  modal({ title, body, buttons = [{ label: 'OK', primary: true }], wide = false, onClose }) {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal${wide ? ' wide' : ''}"><div class="modal-head">${title}<button class="icon-btn" data-cancel>${icon('close')}</button></div><div class="modal-body">${body}</div><div class="modal-foot"></div></div>`;
    const foot = bd.querySelector('.modal-foot');
    let done = false;
    const close = () => { done = true; bd.remove(); };
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`;
      el.textContent = b.label;
      el.onclick = () => { close(); b.action?.(); };
      foot.appendChild(el);
    }
    bd.querySelector('[data-cancel]').onclick = () => {
      close();
      const cancelBtn = buttons.find((b) => b.label === 'Cancel');
      if (cancelBtn?.action) cancelBtn.action(); else onClose?.();
    };
    bd.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !done) {
        const p = buttons.find((b) => b.primary);
        if (p) { e.preventDefault(); close(); p.action?.(); }
      }
    });
    document.body.appendChild(bd);
    return bd.querySelector('.modal');
  }

  prompt(title, value, cb) {
    const m = this.modal({
      title,
      body: `<input class="prompt-input" value="${esc(value)}"/>`,
      buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, action: () => cb(inp.value.trim()) }],
    });
    const inp = m.querySelector('input');
    setTimeout(() => { inp.focus(); inp.select(); }, 20);
  }
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function toBytes(data) {
  if (!data) return new Uint8Array(0);
  if (data instanceof Uint8Array) return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data : data.slice();
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return new TextEncoder().encode(String(data));
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}
