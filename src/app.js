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
import { Mascot } from './mascot.js';
import { featureHandles } from './handles.js';
import * as cloud from './cloud.js';
import { currentOrg, orgSlugFromPath, slugify } from './org.js';
import { ClassesUI } from './classes-ui.js';
import { zipSync, strToU8 } from 'fflate';
import { PRINTERS, MATERIALS, printReport, printReportText, formatHours, formatMoney, JOURNAL_SECTIONS, journalMarkdown, LESSONS } from './student.js';

const CHEERS = {
  extrude: ['Nice extrude!', 'Look at that — it’s 3D now!', 'Solid work.'],
  revolve: ['Round and round — beautiful!', 'Revolved like a pro.'],
  box: ['A fine box.', 'Boxes are the start of everything.'],
  cylinder: ['Nice cylinder!'],
  sphere: ['So round!'],
  cone: ['Pointy!'],
  torus: ['Mmm, donut.'],
  text: ['Nice lettering!', 'Looking good in 3D!'],
  move: ['Moved it!'],
  combine: ['Combined — teamwork!'],
  mirror: ['Mirror, mirror… nice symmetry.'],
  linearPattern: ['Copies, lined up neatly.'],
  circularPattern: ['Round pattern done!'],
  shell: ['Hollowed out — saves filament!'],
  scale: ['Resized!'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

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

    this.org = currentOrg();
    if (this.org) {
      document.body.classList.add('in-org');
      document.documentElement.style.setProperty('--org', this.org.color || '#c8102e');
    }
    this.buildToolbar();
    this.buildViewbar();
    this.bindViewportEvents();
    this.bindKeys();
    if (this.api) this.api.onMenu((cmd, arg) => this.command(cmd, arg));

    this.mascot = new Mascot({
      getContext: () => this.pipContext(),
      onAction: (cmd) => this.command(cmd),
    });
    this.mascot.mount(document.getElementById('viewport-wrap'));
    this.user = null;
    this.cloudId = null;

    this.landing = new Landing(this);
    this.classes = new ClassesUI(this);
    if (!this.org && orgSlugFromPath() && cloud.cloudConfigured()) this.lookupOrg(orgSlugFromPath());
    if (cloud.cloudConfigured()) {
      cloud.currentUser().then((u) => { this.user = u; if (this.landing.visible) this.landing.render(); this.handleHash(); }).catch(() => this.handleHash());
      cloud.onAuthChange((u) => {
        const changed = (u?.id || null) !== (this.user?.id || null);
        this.user = u;
        if (changed && this.landing.visible) this.landing.render();
      });
    }
    this.bindDragDrop();
    this.regen();
    this.vp.setView('iso');
    this.landing.show();
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this._installEvent = e;
      this.canInstall = true;
      if (this.landing.visible) this.landing.render();
    });
    if (!cloud.cloudConfigured()) this.handleHash();
  }

  /** What Pip knows about the open design when you ask it questions. */
  pipContext() {
    const r = this.result || { bodies: [], errors: {} };
    const bodies = r.bodies.filter((b) => b.bbox).map((b) => ({
      name: b.name,
      volume: b.volume,
      size: [0, 1, 2].map((i) => b.bbox.max[i] - b.bbox.min[i]),
    }));
    const errors = Object.entries(r.errors).map(([id, message]) => ({ name: this.featureById(id)?.name || 'A step', message }));
    const selected = r.bodies.filter((b) => this.selection.has(b.id)).map((b) => b.name);
    return { bodies, errors, selected, onLanding: !!this.landing?.visible };
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
    clearTimeout(this._autosaveT); // a pending autosave must not bring the banner back
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* storage unavailable */ }
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
    this.cloudId = null;
    this.mode = 'normal';
    this.setViewBanner(null);
    this.exitMeasure?.();
    this.landing?.hide();
    this._lastErrIds = null;
    this.regen();
    this._lastErrIds = new Set(Object.keys(this.result.errors));
    this.setDirty(false);
    this.vp.setView('iso');
    this.mascot?.mount(document.getElementById('viewport-wrap'));
    if (this.mascot) {
      if (!this.doc.features.length) this.mascot.say('A fresh canvas! Press <b>S</b> to sketch, or <b>B</b> for a box.', 'wave', 8000);
      else this.mascot.say(`Opened <b>${esc(name)}</b>. Click any step on the timeline to change it.`, 'happy', 6000);
    }
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
    const errIds = Object.keys(this.result.errors);
    const newErr = errIds.find((id) => !this._lastErrIds?.has(id));
    this._lastErrIds = new Set(errIds);
    if (newErr && !this.landing?.visible) {
      const f = this.featureById(newErr);
      this.mascot?.say(`Hmm, <b>${esc(f?.name || 'a step')}</b> has a problem: ${esc(this.result.errors[newErr])}`, 'worried', 8000);
    }
    const ids = new Set(this.result.bodies.map((b) => b.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    this.vp.setBodies(this.result.bodies, this.doc.bodyProps);
    this.vp.setSelection(this.selection);
    this.vp.setSketches(this.result.sketches, this.visibleSketchIds(), this.mode === 'sketch' ? this.sketcher.feature?.id : null, this.doc.settings.segments);
    this.renderBrowser();
    this.renderTimeline();
    this.renderStatus();
    if (this.editing?.def?.type === 'move') this.attachMoveGizmo();
    this.refreshHandles();
  }

  /** Blue drag arrows for the dimensions of the feature being edited. */
  refreshHandles() {
    const ed = this.editing;
    if (!ed || ed.feature.type === 'move' || this.mode !== 'normal') return this.vp.clearHandles();
    const f = ed.feature;
    const handles = featureHandles(f, this.result);
    this.vp.setHandles(handles, {
      onDrag: (h, v) => {
        f.params[h.key] = String(v);
        if (h.key === 'distance' && ed.autoOp) {
          const op = (v < 0) !== (f.params.direction === 'reverse') ? 'cut' : 'join';
          f.params.operation = op;
          const sel = this.el.panel.querySelector('select[data-key="operation"]');
          if (sel) sel.value = op;
        }
        const inp = this.el.panel.querySelector(`input[data-key="${h.key}"]`);
        if (inp) { inp.value = String(v); inp.classList.remove('bad'); }
        if (!this._dragRaf) {
          this._dragRaf = requestAnimationFrame(() => { this._dragRaf = null; this.regen(); this.updatePanelError(); });
        }
      },
      onEnd: () => {
        if (this._dragRaf) { cancelAnimationFrame(this._dragRaf); this._dragRaf = null; }
        this.regen();
        this.renderPanel();
      },
    });
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
        ...(cloud.cloudConfigured() ? [['cloudSave', 'Cloud', 'cloud'], ['share', 'Share', 'link']] : []),
      ] },
      { title: 'Create', items: [
        ['sketch', 'Sketch', 'sketch', 'S'], ['extrude', 'Extrude', 'extrude', 'E'], ['revolve', 'Revolve', 'revolve'],
        ['box', 'Box', 'box', 'B'], ['cylinder', 'Cylinder', 'cylinder', 'Y'], ['sphere', 'Sphere', 'sphere'],
        ['cone', 'Cone', 'cone'], ['torus', 'Torus', 'torus'], ['text', 'Text', 'text'],
      ] },
      { title: 'Modify', items: [
        ['move', 'Move', 'move', 'M'], ['combine', 'Combine', 'combine', 'J'], ['mirror', 'Mirror', 'mirror'],
        ['linearPattern', 'Pattern', 'linear'], ['circularPattern', 'Circular', 'circular'],
        ['shell', 'Hollow', 'shell'], ['scale', 'Scale', 'scale'],
      ] },
      { title: 'Inspect', items: [
        ['measure', 'Measure', 'measure', 'I'], ['params', 'Parameters', 'params'], ['printCheck', 'Print check', 'print'],
      ] },
      { title: 'Class', items: [
        ['lessons', 'Lessons', 'lesson'], ['classes', 'Classes', 'school'], ['journal', 'Journal', 'journal'], ['handIn', 'Hand in', 'handin'],
      ] },
      { title: 'Edit', items: [['undo', 'Undo', 'undo'], ['redo', 'Redo', 'redo']] },
    ];
    const tb = this.el.toolbar;
    tb.innerHTML = `<button class="brand" title="Home — recent files and new designs">${icon('home')}<span class="logo">◆</span> OpenCAD${this.org ? `<span class="org-chip" title="${esc(this.org.name)}">${esc(this.org.short)}</span>` : ''}</button>`;
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
    if (this.landing.visible && !['new', 'open', 'openFile', 'examples', 'about', 'shortcuts', 'home', 'mascot', 'signIn', 'signOut', 'lessons', 'profile', 'classes', 'addSchool'].includes(cmd)) return;
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
      case 'mascot': return this.mascot.toggle();
      case 'cloudSave': return this.saveToCloud();
      case 'printCheck': return this.openPrintCheck();
      case 'classes': return this.classes.open();
      case 'addSchool': return this.registerSchool();
      case 'share': return this.shareDesign();
      case 'journal': return this.openJournal();
      case 'handIn': return this.handIn();
      case 'lessons': return this.openLessons();
      case 'profile': return this.editProfile();
      case 'signIn': return this.user ? this.accountMenu() : this.showAuth();
      case 'signOut': return this.doSignOut();
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
    this.refreshHandles();
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
    if (featureHandles(f, this.result).length) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.innerHTML = 'Drag the <b style="color:#3b8cff">blue arrows</b> in the view to resize. Hold ⇧ for 0.1 mm steps, ⌥ for no snapping.';
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
        inp.dataset.key = field.key;
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
      case 'string': {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.dataset.key = field.key;
        inp.value = f.params[field.key] ?? '';
        inp.oninput = () => update(inp.value);
        inp.onkeydown = (e) => {
          if (e.key === 'Enter') { e.preventDefault(); this.flushRegen(); this.commitEdit(); }
          if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); }
        };
        row.appendChild(inp);
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
    this.vp.clearHandles();
    this.renderPanel();
    this.commit(ed.before);
    if (!this.result.errors[ed.feature.id] && CHEERS[ed.feature.type]) this.mascot.say(pick(CHEERS[ed.feature.type]), 'cheer', 3500);
  }

  cancelEdit() {
    const ed = this.editing;
    if (!ed) return;
    clearTimeout(this._regenT);
    this.editing = null;
    this.vp.detachGizmo();
    this.vp.clearHandles();
    this.doc = JSON.parse(ed.before);
    this.renderPanel();
    this.regen();
  }

  closePanel(silent) {
    if (this.editing) { if (silent) { this.editing = null; this.vp.detachGizmo(); this.vp.clearHandles(); } else this.commitEdit(); }
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
    this.mascot.say('Pick a plane to draw on — or click a flat face of a body.', 'think', 6000);
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
    if (isNew) this.mascot.say('Draw closed shapes. Type a number while drawing for an exact size. <b>Enter</b> finishes.', 'happy', 7000);
    this.sketcher.start(f, frame, {
      onFinish: (shapes) => {
        f.shapes = shapes;
        this.mode = 'normal';
        this.vp.resetUp();
        this.commit(before);
        this.vp.setView('iso');
        if (isNew && shapes.length) this.mascot.say('Sketch done! Press <b>E</b> to extrude it, or try <b>Revolve</b>.', 'happy', 7000);
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
    this.mascot.say('Click two points on your model and I’ll measure the distance.', 'think', 5000);
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
    dom.addEventListener('dblclick', (e) => {
      if (this.mode !== 'normal') return;
      const hit = this.vp.pickBody(e);
      const b = hit && this.result.bodies.find((x) => x.id === hit.bodyId);
      const f = b && this.featureById(b.creator);
      if (f && f.type !== 'importMesh') this.editFeature(f.id);
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
    doc.innerHTML = `${icon('folder')} <span>${esc(this.fileName)}</span>${this.cloudId ? icon('cloud', 'cloud-badge') : ''}`;
    doc.title = 'Click to rename';
    doc.onclick = () => this.renameDesign();
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
    this.cloudId = null;
    this.meshSource = null;
    this.lesson = null;
    this.renderLesson();
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
      this.mascot.say(`Saved <b>${esc(this.fileName)}</b>. 💾`, 'happy', 3000);
      this.discardAutosave();
      return true;
    } catch (e) {
      this.toast(`Save failed: ${e.message}`, 'error');
      return false;
    }
  }

  // ===================== cloud (Supabase) =====================

  async saveToCloud() {
    if (!cloud.cloudConfigured()) return this.toast('Cloud saving isn’t set up in this version.', 'error');
    if (!this.user) return this.showAuth({ reason: 'Sign in to save your designs to the cloud.', then: () => this.saveToCloud() });
    if (this.editing) this.commitEdit();
    const name = this.cloudId ? this.fileName : await this.askName(this.fileName === 'Untitled' ? '' : this.fileName);
    if (!name) return;
    try {
      let thumb = null;
      try { thumb = this.vp.thumbnail(320, 200); } catch { /* optional */ }
      const row = await cloud.saveDesign({ id: this.cloudId, name, doc: this.doc, thumb, org: this.org?.slug || null });
      this.cloudId = row.id;
      this.fileName = row.name;
      this.setDirty(false);
      this.discardAutosave();
      this.renderBrowser();
      this.toast(`Saved “${row.name}” to the cloud`);
      this.mascot.say(`Saved to the cloud ☁️ Open it from the start screen on any computer.`, 'cheer', 4500);
    } catch (e) {
      this.toast(`Cloud save failed: ${e.message}`, 'error');
      this.mascot.say(`I couldn’t save to the cloud: ${esc(e.message)}`, 'worried', 7000);
    }
  }

  /** Ask for a design name (pre-filled). Resolves to the name, or null if cancelled. */
  askName(current = '', { title = 'Name your design', action = 'Save to cloud' } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const m = this.modal({
        title,
        body: `<p class="muted">This is the name you'll see in your cloud designs.</p>
          <input class="prompt-input" id="cloud-name" maxlength="200" placeholder="e.g. Phone stand" value="${esc(current)}"/>
          <div class="auth-msg" id="cloud-name-msg" hidden>Please type a name.</div>`,
        buttons: [],
      });
      const inp = m.querySelector('#cloud-name');
      const msg = m.querySelector('#cloud-name-msg');
      const foot = m.querySelector('.modal-foot');
      const close = () => m.closest('.modal-backdrop')?.remove();
      const ok = () => {
        const v = inp.value.trim();
        if (!v) { msg.hidden = false; inp.focus(); return; }
        close();
        finish(v);
      };
      const cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.textContent = 'Cancel';
      cancel.onclick = () => { close(); finish(null); };
      const save = document.createElement('button');
      save.className = 'btn primary';
      save.textContent = action;
      save.onclick = ok;
      foot.append(cancel, save);
      m.querySelector('[data-cancel]').onclick = () => { close(); finish(null); };
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); ok(); }
        if (e.key === 'Escape') { e.preventDefault(); close(); finish(null); }
      });
      setTimeout(() => { inp.focus(); inp.select(); }, 20);
    });
  }

  /** Rename the open design (click its name in the left panel). */
  async renameDesign() {
    const name = await this.askName(this.fileName === 'Untitled' ? '' : this.fileName, { title: 'Rename design', action: 'Rename' });
    if (!name || name === this.fileName) return;
    this.fileName = name;
    this.setDirty(true);
    this.renderBrowser();
    if (this.cloudId && this.user) this.saveToCloud();
  }

  async openCloudDesign(id) {
    if (!this.landing.visible && !(await this.confirmDiscard())) return;
    try {
      const row = await cloud.loadDesign(id);
      this.loadDoc(row.doc, row.name);
      this.cloudId = row.id;
    } catch (e) {
      this.toast(`Couldn’t open that design: ${e.message}`, 'error');
    }
  }

  async deleteCloudDesign(id, name) {
    return new Promise((resolve) => {
      this.modal({
        title: `Delete “${esc(name)}”?`,
        body: '<p>This removes it from the cloud on every computer. It can’t be undone.</p>',
        buttons: [
          { label: 'Cancel', action: () => resolve(false) },
          { label: 'Delete', danger: true, action: async () => {
            try { await cloud.deleteDesign(id); if (this.cloudId === id) this.cloudId = null; resolve(true); }
            catch (e) { this.toast(e.message, 'error'); resolve(false); }
          } },
        ],
        onClose: () => resolve(false),
      });
    });
  }

  /** Sign in / create account window. */
  showAuth({ reason = '', then } = {}) {
    if (!cloud.cloudConfigured()) return this.toast('Cloud sign-in isn’t set up in this version.', 'error');
    let mode = 'signin';
    const m = this.modal({
      title: 'Sign in to OpenCAD',
      body: `${reason ? `<p class="muted">${esc(reason)}</p>` : ''}
        <form class="auth-form" novalidate>
          <label class="auth-row"><span>Email</span><input id="auth-email" type="email" autocomplete="email" required placeholder="you@example.com"/></label>
          <label class="auth-row"><span>Password</span><input id="auth-password" type="password" autocomplete="current-password" required minlength="6" placeholder="At least 6 characters"/></label>
          <div class="auth-msg" role="alert" hidden></div>
          <button class="btn primary auth-submit" type="submit">Sign in</button>
          <div class="auth-links">
            <button type="button" class="link-btn" data-toggle>New here? Create an account</button>
            <button type="button" class="link-btn" data-forgot>Forgot password?</button>
          </div>
        </form>`,
      buttons: [],
    });
    const form = m.querySelector('form');
    const email = m.querySelector('#auth-email');
    const pw = m.querySelector('#auth-password');
    const msg = m.querySelector('.auth-msg');
    const submit = m.querySelector('.auth-submit');
    const show = (text, ok = false) => { msg.hidden = !text; msg.textContent = text || ''; msg.classList.toggle('ok', ok); };
    const setMode = (md) => {
      mode = md;
      m.querySelector('.modal-head').firstChild.textContent = md === 'signup' ? 'Create your OpenCAD account' : 'Sign in to OpenCAD';
      submit.textContent = md === 'signup' ? 'Create account' : 'Sign in';
      pw.autocomplete = md === 'signup' ? 'new-password' : 'current-password';
      m.querySelector('[data-toggle]').textContent = md === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account';
      show('');
    };
    const close = () => m.closest('.modal-backdrop')?.remove();
    m.querySelector('[data-toggle]').onclick = () => setMode(mode === 'signup' ? 'signin' : 'signup');
    m.querySelector('[data-forgot]').onclick = async () => {
      if (!email.value.includes('@')) return show('Type your email above first.');
      try { await cloud.sendPasswordReset(email.value.trim()); show('Check your email for a link to reset your password.', true); }
      catch (e) { show(e.message); }
    };
    form.addEventListener('keydown', (e) => e.stopPropagation());
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!email.value.includes('@')) return show('Enter your email address.');
      if (pw.value.length < 6) return show('Use a password with at least 6 characters.');
      submit.disabled = true;
      submit.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';
      try {
        if (mode === 'signup') {
          const { needsConfirmation } = await cloud.signUp(email.value.trim(), pw.value);
          if (needsConfirmation) {
            setMode('signin');
            show('Account created! Check your email and click the confirmation link, then sign in here.', true);
            return;
          }
        } else {
          await cloud.signIn(email.value.trim(), pw.value);
        }
        this.user = await cloud.currentUser();
        close();
        this.toast(`Signed in as ${this.user?.email || 'you'}`);
        if (this.landing.visible) this.landing.render();
        if (!cloud.profileOf(this.user).fullName) await this.editProfile({ first: true });
        then?.();
      } catch (err) {
        show(err.message);
      } finally {
        submit.disabled = false;
        submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
      }
    };
    setTimeout(() => email.focus(), 20);
  }

  /** "Tonkla · 9B · Singapore International School of Bangkok" */
  whoAmI() {
    const p = cloud.profileOf(this.user);
    return [p.fullName || this.user?.email, p.className, this.org?.name].filter(Boolean).join(' · ');
  }

  accountMenu() {
    const p = cloud.profileOf(this.user);
    this.modal({
      title: 'Your account',
      body: `<p>Signed in as <b>${esc(p.fullName || this.user?.email || '')}</b>${p.className ? ` · ${esc(p.className)}` : ''}${this.org ? `<br/><span class="muted">${esc(this.org.name)}</span>` : ''}</p>
        <p class="muted">${esc(this.user?.email || '')}</p>`,
      buttons: [{ label: 'Close' }, { label: 'Edit name & class', action: () => this.editProfile() }, { label: 'Sign out', danger: true, action: () => this.doSignOut() }],
    });
  }

  /** Ask for the student's name and class (stored on the account). */
  editProfile({ first = false } = {}) {
    if (!this.user) return this.showAuth();
    const p = cloud.profileOf(this.user);
    return new Promise((resolve) => {
      const m = this.modal({
        title: first ? 'Welcome! What should we call you?' : 'Your name & class',
        body: `<p class="muted">${this.org ? `Shown to you and on your hand-ins for ${esc(this.org.name)}.` : 'Shown in the app and on your hand-ins.'}</p>
          <form class="auth-form" novalidate>
            <label class="auth-row"><span>Your name</span><input id="pf-name" maxlength="80" autocomplete="name" placeholder="e.g. Tonkla" value="${esc(p.fullName)}"/></label>
            <label class="auth-row"><span>Class (optional)</span><input id="pf-class" maxlength="40" placeholder="e.g. Year 9B" value="${esc(p.className)}"/></label>
            <div class="auth-msg" hidden></div>
            <button class="btn primary auth-submit" type="submit">Save</button>
          </form>`,
        buttons: [],
        onClose: () => resolve(false),
      });
      const form = m.querySelector('form');
      const msg = m.querySelector('.auth-msg');
      form.addEventListener('keydown', (e) => e.stopPropagation());
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fullName = m.querySelector('#pf-name').value.trim();
        if (!fullName) { msg.hidden = false; msg.textContent = 'Please type your name.'; return; }
        try {
          this.user = await cloud.updateProfile({ fullName, className: m.querySelector('#pf-class').value.trim() });
          m.closest('.modal-backdrop')?.remove();
          this.mascot.say(`Nice to meet you, <b>${esc(fullName)}</b>! 👋`, 'wave', 4000);
          if (this.landing.visible) this.landing.render();
          resolve(true);
        } catch (err) { msg.hidden = false; msg.textContent = err.message; }
      };
      setTimeout(() => m.querySelector('#pf-name')?.focus(), 20);
    });
  }

  async installApp() {
    const ev = this._installEvent;
    if (!ev) return this.toast('Use your browser’s menu to install: “Install OpenCAD Studio” or “Add to Home Screen”.');
    ev.prompt();
    const { outcome } = await ev.userChoice.catch(() => ({}));
    this._installEvent = null;
    this.canInstall = false;
    if (outcome === 'accepted') this.mascot.say('Installed! OpenCAD now opens like a normal app, even offline.', 'cheer', 5000);
    if (this.landing.visible) this.landing.render();
  }

  displayName() {
    return cloud.profileOf(this.user).fullName || this.user?.email?.split('@')[0] || '';
  }

  /** Public web address for this page (the desktop app links to the website). */
  webLink(hash = '') {
    if (location.protocol.startsWith('http')) return `${location.origin}${location.pathname}${hash}`;
    return `https://tkfam151.github.io/3DCAD/${this.org ? `org/${this.org.slug}/` : 'app/'}${hash}`;
  }

  confirm(title, body, okLabel = 'OK') {
    return new Promise((resolve) => {
      this.modal({
        title: esc(title),
        body: `<p>${esc(body)}</p>`,
        buttons: [{ label: 'Cancel', action: () => resolve(false) }, { label: okLabel, danger: true, action: () => resolve(true) }],
        onClose: () => resolve(false),
      });
    });
  }

  /** Open someone else's design (a submission or a share link) without linking it to their cloud copy. */
  openViewOnly(doc, name, bannerText) {
    this.loadDoc(doc, name);
    this.setViewBanner(bannerText);
  }

  setViewBanner(text) {
    let el = document.getElementById('view-banner');
    if (!text) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'view-banner';
      document.getElementById('viewport-wrap').appendChild(el);
    }
    el.innerHTML = `${icon('eye')}<span>${esc(text)}</span><span class="vb-note">Changes stay on your computer unless you save your own copy.</span>
      ${this.user ? '<button class="btn small primary" data-copy-cloud>Save a copy to my cloud</button>' : ''}<button class="icon-btn" data-x title="Dismiss">${icon('close')}</button>`;
    el.querySelector('[data-x]').onclick = () => el.remove();
    el.querySelector('[data-copy-cloud]')?.addEventListener('click', () => { el.remove(); this.cloudId = null; this.saveToCloud(); });
  }

  /** Deep links: #view=<id> (shared design), #join=<code> (class), #add-school. */
  async handleHash() {
    if (this._hashHandled) return;
    this._hashHandled = true;
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const clear = () => history.replaceState(null, '', location.pathname + location.search);
    if (h.get('view')) {
      clear();
      try {
        const d = await cloud.loadSharedDesign(h.get('view'));
        this.openViewOnly(d.doc, d.name, `Shared design: “${d.name}”`);
        this.mascot.say('Someone shared this design with you. Look around, or save your own copy to change it.', 'wave', 7000);
      } catch (e) {
        this.toast('That shared link doesn’t work any more. The owner may have stopped sharing it.', 'error');
      }
    } else if (h.get('join')) {
      clear();
      const code = h.get('join');
      const go = async () => {
        try {
          const c = await cloud.joinClass(code, this.displayName());
          this.toast(`You joined ${c.name}`);
          this.classes.open({ view: 'class', cls: { ...c, role: c.teacher_id === this.user?.id ? 'teacher' : 'student' } });
        } catch (e) { this.toast(e.message, 'error'); }
      };
      if (this.user) go(); else this.showAuth({ reason: 'Sign in to join the class.', then: go });
    } else if (location.hash === '#add-school') {
      clear();
      this.registerSchool();
    }
  }

  async lookupOrg(slug) {
    try {
      const o = await cloud.getOrg(slug);
      if (!o) {
        this.toast('There’s no school at this address. Find yours in the school directory.', 'error');
        return;
      }
      this.org = { ...o, currency: o.currency || 'THB', printer: 'bambu-a1' };
      document.body.classList.add('in-org');
      document.documentElement.style.setProperty('--org', this.org.color || '#3b8cff');
      this.buildToolbar();
      if (this.landing.visible) this.landing.render();
    } catch (e) {
      this.toast(e.message, 'error');
    }
  }

  /** Add a school to the directory; it gets its own address right away. */
  registerSchool() {
    if (!cloud.cloudConfigured()) return this.toast('Adding schools needs cloud sign-in, which isn’t set up in this version.', 'error');
    if (!this.user) return this.showAuth({ reason: 'Sign in to add your school.', then: () => this.registerSchool() });
    const m = this.modal({
      title: `${icon('school')} Add your school`,
      body: `<p class="muted">Your school gets its own OpenCAD space with your name, colour, classes and cloud designs. It appears in the school directory straight away; we mark it ✓ verified after a quick check.</p>
        <form class="auth-form" novalidate>
          <label class="auth-row"><span>School name</span><input id="sc-name" maxlength="120" placeholder="e.g. Bangkok Patana School"/></label>
          <div class="sc-grid">
            <label class="auth-row"><span>Short name (badge)</span><input id="sc-short" maxlength="12" placeholder="e.g. BPS"/></label>
            <label class="auth-row"><span>City / country</span><input id="sc-city" maxlength="80" placeholder="e.g. Bangkok, Thailand"/></label>
            <label class="auth-row"><span>School colour</span><input id="sc-color" type="color" value="#2f6fd0"/></label>
          </div>
          <label class="auth-row"><span>Web address</span><div class="sc-url"><span>tkfam151.github.io/3DCAD/org/</span><input id="sc-slug" maxlength="40" placeholder="bangkok-patana"/></div></label>
          <div class="auth-msg" hidden></div>
          <button class="btn primary auth-submit" type="submit">Add school</button>
        </form>`,
      buttons: [],
    });
    const $ = (id) => m.querySelector(id);
    const msg = m.querySelector('.auth-msg');
    let slugTouched = false;
    m.querySelector('form').addEventListener('keydown', (e) => e.stopPropagation());
    $('#sc-name').oninput = () => {
      if (!slugTouched) $('#sc-slug').value = slugify($('#sc-name').value);
      if (!$('#sc-short').dataset.touched) $('#sc-short').value = $('#sc-name').value.split(/\s+/).filter((w) => /^[A-Z0-9]/i.test(w) && !/^(of|the|and|de|la)$/i.test(w)).map((w) => w[0].toUpperCase()).join('').slice(0, 6);
    };
    $('#sc-slug').oninput = () => { slugTouched = true; };
    $('#sc-short').oninput = () => { $('#sc-short').dataset.touched = '1'; };
    m.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#sc-name').value.trim(), short = $('#sc-short').value.trim(), slug = slugify($('#sc-slug').value || name);
      const show = (t) => { msg.hidden = false; msg.textContent = t; };
      if (name.length < 3) return show('Type the school’s full name.');
      if (!short) return show('Add a short name for the badge.');
      if (slug.length < 2) return show('Choose a web address (letters, numbers and dashes).');
      try {
        if (await cloud.getOrg(slug)) return show(`The address “${slug}” is already taken. Try another one.`);
        const o = await cloud.registerOrg({ slug, name, short, city: $('#sc-city').value.trim(), color: $('#sc-color').value });
        m.closest('.modal-backdrop')?.remove();
        const url = `https://tkfam151.github.io/3DCAD/org/${o.slug}/`;
        this.modal({
          title: `🎉 ${esc(o.name)} is on OpenCAD`,
          body: `<p>Your school's space is ready:</p><p><a href="${url}" target="_blank" rel="noopener">${esc(url)}</a></p>
            <p class="muted">Share it with teachers and students. Teachers can create classes there under <b>Classes</b>.</p>`,
          buttons: [{ label: 'Copy link', action: () => navigator.clipboard?.writeText(url).catch(() => {}) }, { label: 'Done', primary: true }],
        });
      } catch (err) { show(err.message); }
    };
    setTimeout(() => $('#sc-name').focus(), 20);
  }

  /** Make a cloud design viewable by anyone with the link. */
  async shareDesign(id = this.cloudId, name = this.fileName) {
    if (!this.user) return this.showAuth({ reason: 'Sign in to share designs.', then: () => this.shareDesign() });
    if (!id) {
      await this.saveToCloud();
      id = this.cloudId;
      name = this.fileName;
      if (!id) return;
    }
    try {
      await cloud.setShared(id, true);
    } catch (e) { return this.toast(e.message, 'error'); }
    const link = this.webLink(`#view=${id}`);
    const m = this.modal({
      title: `${icon('export')} Share “${esc(name)}”`,
      body: `<p>Anyone with this link can view the design and save their own copy. They can't change yours.</p>
        <div class="share-row"><input id="share-link" readonly value="${esc(link)}"/><button class="btn primary" data-copy>Copy</button></div>`,
      buttons: [{ label: 'Stop sharing', danger: true, action: async () => { await cloud.setShared(id, false).catch(() => {}); this.toast('Link turned off'); if (this.landing.visible) this.landing.render(); } }, { label: 'Done', primary: true }],
    });
    const inp = m.querySelector('#share-link');
    m.querySelector('[data-copy]').onclick = async () => {
      try { await navigator.clipboard.writeText(link); this.toast('Link copied'); } catch { inp.select(); }
    };
    setTimeout(() => inp.select(), 20);
  }

  // ===================== student tools =====================

  printSettings() {
    let st = {};
    try { st = JSON.parse(localStorage.getItem('opencad-print-settings') || '{}'); } catch { st = {}; }
    return {
      printer: st.printer || this.org?.printer || 'bambu-a1',
      material: st.material || 'pla',
      infill: st.infill ?? 15,
      price: st.price ?? (this.org?.currency === 'THB' || !this.org ? 600 : 25),
      currency: st.currency || this.org?.currency || 'THB',
    };
  }

  buildPrintReport() {
    const st = this.printSettings();
    const bodies = this.result.bodies.filter((b) => (this.selection.size ? this.selection.has(b.id) : this.isBodyVisible(b.id)));
    return {
      st,
      report: printReport(bodies, {
        printer: PRINTERS.find((p) => p.id === st.printer) || PRINTERS[0],
        material: MATERIALS.find((m) => m.id === st.material) || MATERIALS[0],
        infill: st.infill / 100,
        pricePerKg: st.price,
      }),
    };
  }

  openPrintCheck() {
    if (this.editing) this.commitEdit();
    if (!this.result.bodies.length) return this.toast('Make something first, then check it for printing.', 'error');
    const draw = () => {
      const { st, report: r } = this.buildPrintReport();
      const opt = (list, cur) => list.map((x) => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
      body.innerHTML = `
        <div class="pc-settings">
          <label>Printer<select data-s="printer">${opt(PRINTERS, st.printer)}</select></label>
          <label>Material<select data-s="material">${opt(MATERIALS, st.material)}</select></label>
          <label>Infill %<input type="number" data-s="infill" min="0" max="100" step="5" value="${st.infill}"/></label>
          <label>Price per kg (${esc(st.currency)})<input type="number" data-s="price" min="0" step="10" value="${st.price}"/></label>
        </div>
        <div class="pc-total">
          <div><b>${Math.round(r.total.grams)} g</b><span>filament</span></div>
          <div><b>${formatHours(r.total.hours)}</b><span>print time*</span></div>
          <div><b>${formatMoney(r.total.cost, st.currency)}</b><span>material cost</span></div>
          <div><b>${r.total.metres.toFixed(1)} m</b><span>of 1.75 mm filament</span></div>
        </div>
        ${r.togetherFits ? '' : '<div class="pc-warn bad">⚠ All the parts together don’t fit on the bed. Print them in separate batches.</div>'}
        <div class="pc-items">${r.items.map((it) => `
          <div class="pc-item">
            <div class="pc-name"><b>${esc(it.name)}</b><span>${it.size.map((v) => v.toFixed(1)).join(' × ')} mm</span></div>
            ${it.warnings.map((w) => `<div class="pc-warn ${w.level}">${w.level === 'ok' ? '✓' : w.level === 'info' ? 'ℹ' : '⚠'} ${esc(w.text)}</div>`).join('')}
          </div>`).join('')}</div>
        <p class="muted small">*Times and weights are estimates. Your slicer gives exact numbers. ${this.selection.size ? 'Checking the selected bodies.' : 'Checking all visible bodies.'}</p>`;
      body.querySelectorAll('[data-s]').forEach((el) => {
        el.onchange = () => {
          const cur = this.printSettings();
          const k = el.dataset.s;
          cur[k] = el.type === 'number' ? Number(el.value) : el.value;
          try { localStorage.setItem('opencad-print-settings', JSON.stringify(cur)); } catch { /* optional */ }
          draw();
        };
      });
    };
    const m = this.modal({
      title: `${icon('print')} Print check`,
      body: '<div class="pc"></div>',
      wide: true,
      buttons: [
        { label: 'Drop to bed', action: () => this.dropToBed() },
        { label: 'Export STL', action: () => this.exportMesh('stl') },
        { label: 'Done', primary: true },
      ],
    });
    const body = m.querySelector('.pc');
    draw();
  }

  /** Move every floating (or sunken) body so it sits on the build plate (Z = 0). */
  dropToBed() {
    const moves = this.result.bodies.filter((b) => b.bbox && !b.meshOnly && Math.abs(b.bbox.min[2]) > 0.01);
    if (!moves.length) return this.toast('Everything already sits on the bed.');
    this.change((d) => {
      for (const b of moves) {
        d.features.push({ id: uid(), type: 'move', name: this.nextFeatureName('move'), params: { target: b.id, tx: '0', ty: '0', tz: String(Math.round(-b.bbox.min[2] * 1000) / 1000), rx: '0', ry: '0', rz: '0', px: '0', py: '0', pz: '0', copy: false } });
      }
    });
    this.mascot.say(`Dropped ${moves.length} part${moves.length > 1 ? 's' : ''} onto the bed.`, 'cheer', 3500);
  }

  openJournal() {
    if (this.editing) this.commitEdit();
    const j = this.doc.journal || {};
    const before = this.snapshot();
    const m = this.modal({
      title: `${icon('journal')} Design journal · ${esc(this.fileName)}`,
      wide: true,
      body: `<p class="muted">${this.user ? esc(this.whoAmI()) + ' · ' : ''}Write as you go. The journal is saved with your design and included when you hand in.</p>
        ${JOURNAL_SECTIONS.map((sec) => `
          <label class="jr-sec"><b>${esc(sec.title)}</b><span class="muted small">${esc(sec.prompt)}</span>
            <textarea data-j="${sec.key}" rows="4">${esc(j[sec.key] || '')}</textarea></label>`).join('')}`,
      buttons: [
        { label: 'Download as text', action: () => this.downloadJournal() },
        { label: 'Done', primary: true },
      ],
      onClose: () => {},
    });
    m.querySelectorAll('textarea').forEach((ta) => {
      ta.addEventListener('keydown', (e) => e.stopPropagation());
      ta.oninput = () => {
        this.doc.journal = { ...(this.doc.journal || {}), [ta.dataset.j]: ta.value };
        if (!this._journalDirty) { this._journalDirty = true; this.undoStack.push(before); }
        this.setDirty(true);
      };
    });
    this._journalDirty = false;
  }

  journalText(report) {
    const p = cloud.profileOf(this.user);
    return journalMarkdown(this.doc, { title: this.fileName, student: p.fullName || '', className: p.className || '', school: this.org?.name || '', report });
  }

  async downloadJournal() {
    const text = this.journalText(this.buildPrintReport().report);
    await this.saveBinary(new TextEncoder().encode(text), `${this.fileName} - journal.md`, 'text/markdown', [{ name: 'Markdown', extensions: ['md'] }]);
  }

  /** One ZIP for the teacher: design, STL, four views, journal and print check. */
  async handIn() {
    if (this.editing) this.commitEdit();
    if (!this.result.bodies.length) return this.toast('Make something first, then hand it in.', 'error');
    const p = cloud.profileOf(this.user);
    const base = this.fileName.replace(/[\\/:*?"<>|]+/g, '-');
    const who = (p.fullName || '').replace(/[\\/:*?"<>|]+/g, '-');
    const files = {};
    files[`${base}.ocad`] = strToU8(JSON.stringify(this.doc, null, 1));
    const group = this.exportGroup(this.result.bodies.filter((b) => this.isBodyVisible(b.id)).map((b) => b.id));
    const stl = new STLExporter().parse(group, { binary: true });
    files[`${base}.stl`] = new Uint8Array(stl.buffer);
    for (const v of ['iso', 'front', 'top', 'right']) {
      const url = this.vp.captureView(v, 1280, 800);
      const bin = atob(url.split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      files[`views/${v}.png`] = bytes;
    }
    const { st, report } = this.buildPrintReport();
    files['journal.md'] = strToU8(this.journalText(report));
    files['print-check.txt'] = strToU8(printReportText(report, st.currency));
    const zip = zipSync(files, { level: 6 });
    const name = `${who ? `${who} - ` : ''}${base} - hand-in.zip`;
    await this.saveBinary(zip, name, 'application/zip', [{ name: 'ZIP', extensions: ['zip'] }]);
    const empty = JOURNAL_SECTIONS.filter((sec) => !(this.doc.journal?.[sec.key] || '').trim()).length;
    this.mascot.say(empty ? `Hand-in pack ready! Tip: ${empty} journal section${empty > 1 ? 's are' : ' is'} still empty.` : 'Hand-in pack ready! Great work. 🎓', empty ? 'happy' : 'cheer', 6000, empty ? [{ label: 'Open journal', cmd: 'journal' }] : []);
  }

  openLessons() {
    const m = this.modal({
      title: `${icon('lesson')} Lessons`,
      wide: true,
      body: `<p class="muted">Pick a project. Pip walks you through it step by step.</p>
        <div class="examples">${LESSONS.map((l) => `<button class="ex-card" data-lesson="${l.id}"><b>${esc(l.title)}</b><span class="muted small">${esc(l.level)}</span><span>${esc(l.summary)}</span></button>`).join('')}</div>`,
      buttons: [{ label: 'Close' }],
    });
    m.querySelectorAll('[data-lesson]').forEach((b) => {
      b.onclick = () => { m.closest('.modal-backdrop').remove(); this.startLesson(b.dataset.lesson); };
    });
  }

  async startLesson(id) {
    const lesson = LESSONS.find((l) => l.id === id);
    if (!lesson) return;
    if (!this.landing.visible && this.doc.features.length && !(await this.confirmDiscard())) return;
    this.loadDoc(emptyDoc(), lesson.title);
    this.lesson = { lesson, step: 0 };
    this.renderLesson();
    this.mascot.say(`Let’s make a <b>${esc(lesson.title.toLowerCase())}</b>! Follow the steps in the card at the top left.`, 'wave', 6000);
  }

  renderLesson() {
    let card = document.getElementById('lesson-card');
    const st = this.lesson;
    if (!st) { card?.remove(); return; }
    if (!card) {
      card = document.createElement('div');
      card.id = 'lesson-card';
      document.getElementById('viewport-wrap').appendChild(card);
    }
    const { lesson, step } = st;
    const s = lesson.steps[step];
    const last = step === lesson.steps.length - 1;
    card.innerHTML = `
      <div class="ls-head">${icon('lesson')}<b>${esc(lesson.title)}</b><span>Step ${step + 1} of ${lesson.steps.length}</span><button class="icon-btn" data-ls="close" title="Close lesson">${icon('close')}</button></div>
      <div class="ls-bar"><i style="width:${((step + 1) / lesson.steps.length) * 100}%"></i></div>
      <p>${s.text}</p>
      <div class="ls-actions">
        ${s.cmd ? `<button class="btn small" data-ls="do">${esc(s.label || 'Do it')}</button>` : ''}
        <span class="ls-spacer"></span>
        ${step > 0 ? '<button class="btn small" data-ls="back">Back</button>' : ''}
        <button class="btn small primary" data-ls="next">${last ? 'Finish' : 'Next'}</button>
      </div>`;
    card.querySelector('[data-ls=close]').onclick = () => { this.lesson = null; this.renderLesson(); };
    card.querySelector('[data-ls=do]')?.addEventListener('click', () => this.command(s.cmd));
    card.querySelector('[data-ls=back]')?.addEventListener('click', () => { st.step--; this.renderLesson(); });
    card.querySelector('[data-ls=next]').onclick = () => {
      if (last) {
        this.lesson = null;
        this.renderLesson();
        this.mascot.say(`You finished <b>${esc(lesson.title)}</b>! 🎉 Try another lesson or make it your own.`, 'cheer', 6000);
        return;
      }
      st.step++;
      this.renderLesson();
      this.mascot.setMood('happy', 1200);
    };
  }

  async doSignOut() {
    try { await cloud.signOut(); } catch (e) { return this.toast(e.message, 'error'); }
    this.user = null;
    this.cloudId = null;
    this.toast('Signed out');
    if (this.landing.visible) this.landing.render();
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
        this.mascot.say('Exported! Ready for the slicer.', 'cheer', 4000);
      } else {
        download(new Blob([data], { type: mime }), name);
        this.toast(`Exported ${name}`);
        this.mascot.say('Exported! Ready for the slicer.', 'cheer', 4000);
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
      ['I', 'Measure'], ['H', 'Hide / show Pip, the helper'], ['F', 'Fit view'], ['0 / 1 / 2 / 3', 'Home / Front / Top / Right view'], ['Delete', 'Remove selected bodies'],
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
        if (!mod && !typing && e.key.toLowerCase() === 'h') { this.mascot.toggle(); this.landing.render(); }
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
      const map = { h: 'mascot', s: 'sketch', e: 'extrude', b: 'box', y: 'cylinder', m: 'move', j: 'combine', i: 'measure', f: 'fit', 0: 'view:iso', 1: 'view:front', 2: 'view:top', 3: 'view:right', '?': 'shortcuts' };
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
