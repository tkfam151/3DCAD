import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { frameMatrix, shapeOutline } from './kernel/kernel.js';

const Z_UP = new THREE.Vector3(0, 0, 1);

const PALETTE = ['#8fa6bf', '#c9a26b', '#7fb08f', '#c27d7d', '#9d8fc4', '#6fb3b8', '#b8b06f', '#c48fb5'];
export const defaultBodyColor = (i) => PALETTE[i % PALETTE.length];

export class Viewport {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);
    this.dom = this.renderer.domElement;

    this.scene = new THREE.Scene();
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

    const aspect = 1;
    this.perspCam = new THREE.PerspectiveCamera(40, aspect, 0.1, 100000);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    for (const c of [this.perspCam, this.orthoCam]) c.up.copy(Z_UP);
    this.camera = this.perspCam;
    this.camera.position.set(120, -160, 110);

    this.controls = this.makeControls();

    // lighting
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.7);
    this.keyLight.position.set(0.5, -0.6, 1);
    this.scene.add(this.keyLight);
    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this.fillLight.position.set(-1, 0.8, -0.3);
    this.scene.add(this.fillLight);

    this.gridGroup = new THREE.Group();
    this.scene.add(this.gridGroup);
    this.buildGrid(10, 400);

    this.bodyGroup = new THREE.Group();
    this.sketchGroup = new THREE.Group();
    this.overlayGroup = new THREE.Group();
    this.scene.add(this.bodyGroup, this.sketchGroup, this.overlayGroup);

    this.bodyObjects = new Map(); // id -> {group, mesh, edges, data}
    this.selected = new Set();
    this.hovered = null;
    this.wireframe = false;
    this.showEdges = true;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 1;
    this.pointer = new THREE.Vector2();

    this.labels = [];
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'label-layer';
    container.appendChild(this.labelLayer);

    // Transform gizmo
    this.gizmo = new TransformControls(this.camera, this.dom);
    this.gizmo.setSize(1.1);
    this.gizmoHelper = this.gizmo.getHelper();
    this.scene.add(this.gizmoHelper);
    this.gizmoPivot = new THREE.Object3D();
    this.scene.add(this.gizmoPivot);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (e.value) this._gizmoStart = this.gizmoPivot.matrixWorld.clone();
      else if (this._gizmoStart && this.onGizmoEnd) {
        const delta = this.gizmoPivot.matrixWorld.clone().multiply(this._gizmoStart.clone().invert());
        this.onGizmoEnd(delta, this.gizmoTarget);
      }
    });
    this.gizmo.addEventListener('objectChange', () => {
      if (!this._gizmoStart || !this.gizmoTarget) return;
      const obj = this.bodyObjects.get(this.gizmoTarget);
      if (obj) {
        const delta = this.gizmoPivot.matrixWorld.clone().multiply(this._gizmoStart.clone().invert());
        obj.group.matrixAutoUpdate = false;
        obj.group.matrix.copy(delta);
        obj.group.matrixWorldNeedsUpdate = true;
      }
      this.requestRender();
    });
    this.gizmo.addEventListener('change', () => this.requestRender());

    this._needsRender = true;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  makeControls() {
    if (this.controls) this.controls.dispose();
    const c = new OrbitControls(this.camera, this.dom);
    c.enableDamping = false;
    c.zoomToCursor = true;
    c.screenSpacePanning = true;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    c.addEventListener('change', () => this.requestRender());
    if (this.controls) {
      c.target.copy(this.controls.target);
      c.enableRotate = this.controls.enableRotate;
    }
    c.update();
    return c;
  }

  buildGrid(step = 10, size = 400) {
    this.gridGroup.clear();
    const mk = (s, divs, color, opacity) => {
      const g = new THREE.GridHelper(s, divs, color, color);
      g.rotation.x = Math.PI / 2;
      g.material.transparent = true;
      g.material.opacity = opacity;
      g.material.depthWrite = false;
      return g;
    };
    this.gridGroup.add(mk(size, size / (step / 10), 0x8899aa, 0.12));
    this.gridGroup.add(mk(size, size / step, 0x8899aa, 0.3));
    const axis = (dir, color) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(size / 2)]);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false }));
      l.renderOrder = 1;
      return l;
    };
    this.gridGroup.add(axis(new THREE.Vector3(1, 0, 0), 0xe0524f));
    this.gridGroup.add(axis(new THREE.Vector3(0, 1, 0), 0x5fbf5f));
    this.gridGroup.add(axis(new THREE.Vector3(0, 0, 1), 0x4f8fe0));
    this.requestRender();
  }

  setGridVisible(v) { this.gridGroup.visible = v; this.requestRender(); }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.dom.style.width = '100%';
    this.dom.style.height = '100%';
    this.perspCam.aspect = w / h;
    this.perspCam.updateProjectionMatrix();
    this.updateOrthoFrustum();
    this.requestRender();
  }

  updateOrthoFrustum() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const dist = this.orthoDistance || 200;
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(this.perspCam.fov / 2));
    this.orthoCam.left = (-halfH * w) / h;
    this.orthoCam.right = (halfH * w) / h;
    this.orthoCam.top = halfH;
    this.orthoCam.bottom = -halfH;
    this.orthoCam.updateProjectionMatrix();
  }

  setOrthographic(on) {
    if ((this.camera === this.orthoCam) === on) return;
    const from = this.camera;
    const target = this.controls.target.clone();
    if (on) {
      this.orthoDistance = from.position.distanceTo(target);
      this.orthoCam.zoom = 1;
      this.updateOrthoFrustum();
      this.orthoCam.position.copy(from.position);
      this.orthoCam.up.copy(from.up);
      this.camera = this.orthoCam;
    } else {
      const dist = (this.orthoDistance || 200) / this.orthoCam.zoom;
      const dir = from.position.clone().sub(target).normalize();
      this.perspCam.position.copy(target).addScaledVector(dir, dist);
      this.perspCam.up.copy(from.up);
      this.camera = this.perspCam;
    }
    this.camera.lookAt(target);
    this.controls = this.makeControls();
    this.controls.target.copy(target);
    this.controls.update();
    this.gizmo.camera = this.camera;
    this.requestRender();
  }

  requestRender() { this._needsRender = true; }

  loop() {
    requestAnimationFrame(() => this.loop());
    if (this._anim) this._anim();
    if (!this._needsRender) return;
    this._needsRender = false;
    // keep key light relative to camera for consistent shading
    const camDir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.keyLight.position.copy(camDir).add(new THREE.Vector3(0.3, 0.2, 0.6)).normalize();
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.updateHandleScale();
    if (this.onRender) this.onRender();
  }

  // ---------- bodies ----------

  setBodies(bodies, props = {}) {
    const keep = new Set();
    bodies.forEach((b, i) => {
      keep.add(b.id);
      let obj = this.bodyObjects.get(b.id);
      if (obj && obj.data === b) return;
      if (obj) this.disposeBody(obj);
      obj = this.makeBodyObject(b, props[b.id], i);
      this.bodyObjects.set(b.id, obj);
      this.bodyGroup.add(obj.group);
    });
    for (const [id, obj] of this.bodyObjects) {
      if (!keep.has(id)) { this.disposeBody(obj); this.bodyObjects.delete(id); }
    }
    this.applyBodyProps(props);
    this.refreshHighlight();
    this.requestRender();
  }

  makeBodyObject(b, prop, index) {
    let geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
    geom.setIndex(new THREE.BufferAttribute(b.indices, 1));
    const edgesGeom = new THREE.EdgesGeometry(geom, 25);
    const shaded = toCreasedNormals(geom, THREE.MathUtils.degToRad(30));
    geom.dispose();
    geom = shaded;
    const color = prop?.color || defaultBodyColor(index);
    const mat = new THREE.MeshStandardMaterial({
      color, metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.bodyId = b.id;
    const edges = new THREE.LineSegments(edgesGeom, new THREE.LineBasicMaterial({ color: 0x1b2129, transparent: true, opacity: 0.9 }));
    edges.raycast = () => {};
    const group = new THREE.Group();
    group.add(mesh, edges);
    group.userData.bodyId = b.id;
    return { group, mesh, edges, data: b, baseColor: color };
  }

  disposeBody(obj) {
    this.bodyGroup.remove(obj.group);
    obj.mesh.geometry.dispose();
    obj.mesh.material.dispose();
    obj.edges.geometry.dispose();
    obj.edges.material.dispose();
  }

  applyBodyProps(props = {}) {
    let i = 0;
    for (const [id, obj] of this.bodyObjects) {
      const p = props[id] || {};
      obj.group.visible = p.visible !== false;
      const color = p.color || defaultBodyColor(i);
      obj.baseColor = color;
      obj.mesh.material.color.set(color);
      obj.mesh.material.wireframe = this.wireframe;
      obj.mesh.material.opacity = p.opacity ?? (this.xray ? 0.35 : 1);
      obj.mesh.material.transparent = obj.mesh.material.opacity < 1;
      obj.mesh.material.depthWrite = !obj.mesh.material.transparent;
      obj.edges.visible = this.showEdges;
      i++;
    }
    this.requestRender();
  }

  setDisplay({ wireframe, edges, xray }, props) {
    if (wireframe !== undefined) this.wireframe = wireframe;
    if (edges !== undefined) this.showEdges = edges;
    if (xray !== undefined) this.xray = xray;
    this.applyBodyProps(props);
  }

  setSelection(ids) {
    this.selected = new Set(ids);
    this.refreshHighlight();
  }

  setHover(id) {
    if (this.hovered === id) return;
    this.hovered = id;
    this.refreshHighlight();
  }

  refreshHighlight() {
    for (const [id, obj] of this.bodyObjects) {
      const sel = this.selected.has(id);
      const hov = this.hovered === id;
      obj.mesh.material.emissive.set(sel ? 0x1d5fb8 : hov ? 0x2a4060 : 0x000000);
      obj.mesh.material.emissiveIntensity = sel ? 0.55 : hov ? 0.5 : 0;
      obj.edges.material.color.set(sel ? 0x4aa3ff : 0x1b2129);
    }
    this.requestRender();
  }

  // ---------- sketches ----------

  setSketches(sketches, visibleIds, activeId, segments = 64) {
    this.sketchGroup.clear();
    for (const s of sketches) {
      if (s.id === activeId) continue;
      if (!visibleIds.has(s.id)) continue;
      this.sketchGroup.add(this.makeSketchObject(s.frame, s.shapes, { color: 0x6fb6ff, segments }));
    }
    this.requestRender();
  }

  makeSketchObject(frame, shapes, { color = 0x6fb6ff, selected = new Set(), segments = 64, profileFill = true } = {}) {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.matrix.copy(frameMatrix(frame));
    shapes.forEach((s, idx) => {
      const pts = shapeOutline(s, segments);
      if (pts.length < 2) return;
      const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], p[1], 0)));
      const isSel = selected.has(idx);
      const mat = s.construction
        ? new THREE.LineDashedMaterial({ color: isSel ? 0xffb02e : 0xb08850, dashSize: 2, gapSize: 1.5, depthTest: false })
        : new THREE.LineBasicMaterial({ color: isSel ? 0xffb02e : color, depthTest: false });
      const line = new THREE.Line(g, mat);
      if (s.construction) line.computeLineDistances();
      line.renderOrder = 5;
      line.userData.shapeIndex = idx;
      group.add(line);
      if (profileFill && !s.construction && (s.type !== 'poly' || s.closed) && pts.length > 3) {
        const shape = new THREE.Shape(pts.slice(0, -1).map((p) => new THREE.Vector2(p[0], p[1])));
        const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({
          color: isSel ? 0xffb02e : color, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false,
        }));
        fill.raycast = () => {};
        fill.renderOrder = 4;
        group.add(fill);
      }
    });
    group.updateMatrixWorld(true);
    return group;
  }

  // ---------- picking ----------

  setPointer(ev) {
    const r = this.dom.getBoundingClientRect();
    this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  pickBody(ev) {
    this.setPointer(ev);
    const meshes = [];
    for (const obj of this.bodyObjects.values()) if (obj.group.visible) meshes.push(obj.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
    // flat face normal (creased normals are interpolated; use geometric triangle)
    if (hit.face) {
      const pos = hit.object.geometry.attributes.position;
      const a = new THREE.Vector3().fromBufferAttribute(pos, hit.face.a);
      const b = new THREE.Vector3().fromBufferAttribute(pos, hit.face.b);
      const c = new THREE.Vector3().fromBufferAttribute(pos, hit.face.c);
      const n = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
      if (n.dot(this.raycaster.ray.direction) > 0) n.negate();
      return { bodyId: hit.object.userData.bodyId, point: hit.point.clone(), normal: n };
    }
    return { bodyId: hit.object.userData.bodyId, point: hit.point.clone(), normal };
  }

  /** Intersect pointer ray with a sketch plane; returns local [u, v] or null. */
  planePoint(ev, frame) {
    this.setPointer(ev);
    const n = new THREE.Vector3(...frame.n);
    const o = new THREE.Vector3(...frame.origin);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, p)) return null;
    const d = p.sub(o);
    return [d.dot(new THREE.Vector3(...frame.u)), d.dot(new THREE.Vector3(...frame.v))];
  }

  /** World units per screen pixel at the controls target. */
  worldPerPixel() {
    const h = this.container.clientHeight || 1;
    if (this.camera.isOrthographicCamera) return (this.camera.top - this.camera.bottom) / this.camera.zoom / h;
    const dist = this.camera.position.distanceTo(this.controls.target);
    return (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
  }

  // ---------- origin plane picker ----------

  showPlanePicker(onPick) {
    this.hidePlanePicker();
    const g = new THREE.Group();
    const size = 60;
    const mk = (name, color, rot) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
      }));
      m.position.set(size / 2, size / 2, 0);
      const holder = new THREE.Group();
      holder.add(m);
      holder.rotation.copy(rot);
      m.userData.plane = name;
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
      edge.position.copy(m.position);
      edge.raycast = () => {};
      holder.add(edge);
      g.add(holder);
      return m;
    };
    this.pickerPlanes = [
      mk('XY', 0x4f8fe0, new THREE.Euler(0, 0, 0)),
      mk('XZ', 0x5fbf5f, new THREE.Euler(Math.PI / 2, 0, 0)),
      mk('YZ', 0xe0524f, new THREE.Euler(Math.PI / 2, 0, Math.PI / 2)),
    ];
    this.planePicker = g;
    this.overlayGroup.add(g);
    this.onPlanePick = onPick;
    this.requestRender();
  }

  pickPlane(ev) {
    if (!this.planePicker) return null;
    this.setPointer(ev);
    const hit = this.raycaster.intersectObjects(this.pickerPlanes, false)[0];
    if (!hit) return null;
    // body faces take priority; origin planes are still available from the panel buttons
    if (this.pickBody(ev)) return null;
    return hit.object.userData.plane;
  }

  highlightPickerPlane(name) {
    if (!this.pickerPlanes) return;
    for (const m of this.pickerPlanes) m.material.opacity = m.userData.plane === name ? 0.4 : 0.16;
    this.requestRender();
  }

  hidePlanePicker() {
    if (this.planePicker) this.overlayGroup.remove(this.planePicker);
    this.planePicker = null;
    this.pickerPlanes = null;
    this.requestRender();
  }

  // ---------- dimension arrows (drag to resize) ----------

  /**
   * Show draggable arrows. Each handle: { key, origin:[x,y,z], dir:[x,y,z], value, factor, label, min }.
   * Dragging along `dir` changes value by (distance moved × factor).
   */
  setHandles(handles, { onDrag, onEnd } = {}) {
    if (this._handleDrag) return; // keep the arrows steady while one is being dragged
    this.clearHandles();
    if (!handles?.length) return;
    this._handleCbs = { onDrag, onEnd };
    this.handleGroup = new THREE.Group();
    this.handleMeshes = [];
    for (const h of handles) {
      const g = new THREE.Group();
      const dir = new THREE.Vector3(...h.dir).normalize();
      g.position.set(...h.origin);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const mat = new THREE.MeshBasicMaterial({ color: 0x3b8cff, depthTest: false, transparent: true, opacity: 0.95 });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 16, 10), mat);
      shaft.position.y = 10;
      const head = new THREE.Mesh(new THREE.ConeGeometry(3.2, 8, 16), mat);
      head.position.y = 21;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 8), mat);
      // a fat invisible target that is easy to grab
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 28, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 13;
      for (const m of [shaft, head, dot]) m.renderOrder = 20;
      g.add(shaft, head, dot, hit);
      g.userData = { handle: h, mat, dir };
      hit.userData.handleGroup = g;
      this.handleMeshes.push(hit);
      this.handleGroup.add(g);
    }
    this.overlayGroup.add(this.handleGroup);
    if (!this._handleEvents) this.bindHandleEvents();
    this.updateHandleScale();
    this.requestRender();
  }

  clearHandles() {
    if (this.handleGroup) {
      this.overlayGroup.remove(this.handleGroup);
      this.handleGroup.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    }
    this.handleGroup = null;
    this.handleMeshes = [];
    if (this._handleLabel) { this.removeLabel(this._handleLabel); this._handleLabel = null; }
    this.requestRender();
  }

  /** Keep arrows the same size on screen at any zoom. */
  updateHandleScale() {
    if (!this.handleGroup) return;
    for (const g of this.handleGroup.children) {
      const d = this.camera.isOrthographicCamera
        ? (this.camera.top - this.camera.bottom) / this.camera.zoom
        : g.position.distanceTo(this.camera.position) * 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const s = (d / (this.container.clientHeight || 1)) * 2.4;
      g.scale.setScalar(s);
    }
  }

  pickHandle(ev) {
    if (!this.handleMeshes?.length) return null;
    this.setPointer(ev);
    this.handleGroup.updateMatrixWorld(true);
    const hit = this.raycaster.intersectObjects(this.handleMeshes, false)[0];
    return hit ? hit.object.userData.handleGroup : null;
  }

  /** Parameter t of the point on the handle's line closest to the pointer ray. */
  lineParam(ev, origin, dir) {
    this.setPointer(ev);
    const r = this.raycaster.ray;
    const w0 = origin.clone().sub(r.origin);
    const a = dir.dot(dir), b = dir.dot(r.direction), c = r.direction.dot(r.direction);
    const d = dir.dot(w0), e = r.direction.dot(w0);
    const den = a * c - b * b;
    if (Math.abs(den) < 1e-9) return null; // looking straight down the arrow
    return (b * e - c * d) / den;
  }

  bindHandleEvents() {
    this._handleEvents = true;
    const dom = this.dom;
    const highlight = (g, on) => { if (g) g.userData.mat.color.set(on ? 0xffb02e : 0x3b8cff); this.requestRender(); };
    dom.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const g = this.pickHandle(ev);
      if (!g) return;
      ev.stopImmediatePropagation();
      ev.preventDefault();
      dom.setPointerCapture(ev.pointerId);
      const origin = g.position.clone();
      const t0 = this.lineParam(ev, origin, g.userData.dir);
      this._handleDrag = { g, origin, t0: t0 ?? 0, start: g.userData.handle.value, last: g.userData.handle.value };
      this.controls.enabled = false;
      highlight(g, true);
    }, true);
    dom.addEventListener('pointermove', (ev) => {
      const drag = this._handleDrag;
      if (!drag) {
        if (ev.buttons) return;
        const g = this.pickHandle(ev);
        if (g !== this._hoverHandle) { highlight(this._hoverHandle, false); highlight(g, true); this._hoverHandle = g; }
        if (g) { dom.style.cursor = 'grab'; ev.stopImmediatePropagation(); }
        return;
      }
      ev.stopImmediatePropagation();
      dom.style.cursor = 'grabbing';
      const h = drag.g.userData.handle;
      const t = this.lineParam(ev, drag.origin, drag.g.userData.dir);
      if (t === null) return;
      const step = ev.shiftKey ? 0.1 : ev.altKey ? 0 : 1;
      let v = drag.start + (t - drag.t0) * (h.factor ?? 1);
      if (step) v = Math.round(v / step) * step;
      if (h.min !== undefined) v = Math.max(h.min, v);
      v = Math.round(v * 1000) / 1000;
      // move the arrow along with the face it belongs to
      drag.g.position.copy(drag.origin).addScaledVector(drag.g.userData.dir, (v - drag.start) / (h.factor || 1));
      this.showHandleLabel(drag.g.position, `${h.label} ${v}`);
      if (v !== drag.last) {
        drag.last = v;
        this._handleCbs?.onDrag?.(h, v);
      }
      this.requestRender();
    }, true);
    const end = (ev) => {
      const drag = this._handleDrag;
      if (!drag) return;
      ev.stopImmediatePropagation();
      this._handleDrag = null;
      this.controls.enabled = true;
      dom.style.cursor = '';
      if (this._handleLabel) { this.removeLabel(this._handleLabel); this._handleLabel = null; }
      this._handleCbs?.onEnd?.(drag.g.userData.handle, drag.last);
    };
    dom.addEventListener('pointerup', end, true);
    dom.addEventListener('pointercancel', end, true);
  }

  showHandleLabel(pos, text) {
    if (!this._handleLabel) this._handleLabel = this.addLabel(pos, text, 'handle');
    this._handleLabel.pos.copy(pos);
    this._handleLabel.el.textContent = text;
  }

  // ---------- gizmo ----------

  attachGizmo(bodyId, mode = 'translate') {
    const obj = this.bodyObjects.get(bodyId);
    if (!obj) return this.detachGizmo();
    const box = new THREE.Box3().setFromObject(obj.mesh);
    const c = box.getCenter(new THREE.Vector3());
    this.gizmoPivot.position.copy(c);
    this.gizmoPivot.rotation.set(0, 0, 0);
    this.gizmoPivot.scale.set(1, 1, 1);
    this.gizmoPivot.updateMatrixWorld(true);
    this.gizmoTarget = bodyId;
    this.gizmo.setMode(mode);
    this.gizmo.attach(this.gizmoPivot);
    this.requestRender();
    return c.toArray();
  }

  setGizmoSnap(translate, rotateDeg) {
    this.gizmo.setTranslationSnap(translate || null);
    this.gizmo.setRotationSnap(rotateDeg ? THREE.MathUtils.degToRad(rotateDeg) : null);
  }

  detachGizmo() {
    this.gizmo.detach();
    this.gizmoTarget = null;
    this._gizmoStart = null;
    this.requestRender();
  }

  // ---------- camera ----------

  sceneBounds() {
    const box = new THREE.Box3();
    for (const obj of this.bodyObjects.values()) if (obj.group.visible) box.expandByObject(obj.mesh);
    this.sketchGroup.traverse((o) => { if (o.isLine) box.expandByObject(o); });
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 30));
    return box;
  }

  viewDirection(name) {
    const dirs = {
      top: [[0, -1e-4, 1], [0, 0, 1]],
      bottom: [[0, 1e-4, -1], [0, 0, 1]],
      front: [[0, -1, 0], [0, 0, 1]],
      back: [[0, 1, 0], [0, 0, 1]],
      right: [[1, 0, 0], [0, 0, 1]],
      left: [[-1, 0, 0], [0, 0, 1]],
      iso: [[1, -1, 0.85], [0, 0, 1]],
    };
    return dirs[name] || dirs.iso;
  }

  setView(name, box = this.sceneBounds()) {
    const [d, up] = this.viewDirection(name);
    this.animateTo(new THREE.Vector3(...d).normalize(), new THREE.Vector3(...up), box);
  }

  fit(box = this.sceneBounds()) {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.animateTo(dir, this.camera.up.clone(), box);
  }

  lookAtPlane(frame, box) {
    const n = new THREE.Vector3(...frame.n);
    const up = new THREE.Vector3(...frame.v);
    let b = box;
    if (!b || b.isEmpty()) {
      const o = new THREE.Vector3(...frame.origin);
      b = new THREE.Box3(o.clone().addScalar(-50), o.clone().addScalar(50));
    }
    this.animateTo(n, up, b, 0.9);
  }

  animateTo(dir, up, box, padding = 1.25) {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 5) * padding;
    const fov = THREE.MathUtils.degToRad(this.perspCam.fov);
    const aspect = this.perspCam.aspect;
    const dist = r / Math.sin(Math.min(fov, fov * aspect) / 2);
    const target = sphere.center.clone();
    const endPos = target.clone().addScaledVector(dir.clone().normalize(), dist);
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const startUp = this.camera.up.clone();
    const startZoom = this.camera.zoom;
    // avoid degenerate orbit when looking straight along Z with Z-up controls
    const t0 = performance.now();
    const dur = 350;
    const startDist = startPos.distanceTo(startTarget);
    const startDir = startPos.clone().sub(startTarget).normalize();
    const endDir = dir.clone().normalize();
    this._anim = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const curDir = startDir.clone().lerp(endDir, e);
      if (curDir.lengthSq() < 1e-6) curDir.copy(endDir);
      curDir.normalize();
      const curTarget = startTarget.clone().lerp(target, e);
      const curDist = startDist + (dist - startDist) * e;
      this.camera.position.copy(curTarget).addScaledVector(curDir, curDist);
      this.camera.up.copy(startUp.clone().lerp(up, e).normalize());
      this.controls.target.copy(curTarget);
      if (this.camera.isOrthographicCamera) {
        this.orthoDistance = dist;
        this.updateOrthoFrustum();
        this.camera.zoom = startZoom + (1 - startZoom) * e;
        this.camera.updateProjectionMatrix();
      }
      this.camera.lookAt(curTarget);
      this.requestRender();
      if (k >= 1) {
        this._anim = null;
        this.camera.up.copy(up);
        this.camera.lookAt(target);
        // OrbitControls derives its orbit frame from camera.up at construction
        this.controls = this.makeControls();
        this.controls.target.copy(target);
        this.controls.update();
        if (this.onCameraSettled) this.onCameraSettled();
      }
    };
  }

  resetUp() {
    if (this.camera.up.equals(Z_UP)) return;
    this.camera.up.copy(Z_UP);
    this.controls = this.makeControls();
  }

  // ---------- overlays & labels ----------

  addLabel(pos, text, cls = '') {
    const el = document.createElement('div');
    el.className = `vp-label ${cls}`;
    el.textContent = text;
    this.labelLayer.appendChild(el);
    const l = { pos: pos.clone(), el };
    this.labels.push(l);
    this.requestRender();
    return l;
  }

  removeLabel(l) {
    l.el.remove();
    this.labels = this.labels.filter((x) => x !== l);
  }

  updateLabels() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    for (const l of this.labels) {
      const p = l.pos.clone().project(this.camera);
      l.el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -130%)`;
      l.el.style.display = p.z > 1 ? 'none' : '';
    }
  }

  addOverlay(obj) { this.overlayGroup.add(obj); this.requestRender(); }
  removeOverlay(obj) { this.overlayGroup.remove(obj); this.requestRender(); }

  /** Small JPEG of the current view, cropped to fill w×h (for recent-file cards). */
  thumbnail(w = 320, h = 200) {
    const gridWas = this.gridGroup.visible;
    this.gridGroup.visible = false;
    this.renderer.render(this.scene, this.camera);
    this.gridGroup.visible = gridWas;
    this.requestRender();
    const src = this.dom;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(w / 2, h * 0.3, 10, w / 2, h / 2, w * 0.8);
    g.addColorStop(0, '#3a4553');
    g.addColorStop(1, '#1c2128');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const scale = Math.max(w / src.width, h / src.height);
    const sw = w / scale, sh = h / scale;
    ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.82);
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.dom.toDataURL('image/png');
  }
}
