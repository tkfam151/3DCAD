// Pip's offline brain: answers questions about OpenCAD and about the open model.
// Pure functions so it can be unit-tested without a browser.

const SYN = {
  hole: 'cut', holes: 'cut', pocket: 'cut', subtract: 'cut', remove: 'cut', drill: 'cut', slot: 'cut', minus: 'cut',
  round: 'fillet', rounded: 'fillet', smooth: 'fillet', radius: 'fillet', bevel: 'chamfer',
  print: 'stl', printer: 'stl', printing: 'stl', slicer: 'stl', cura: 'stl', prusa: 'stl', bambu: 'stl',
  draw: 'sketch', drawing: 'sketch', '2d': 'sketch', profile: 'sketch',
  pull: 'extrude', push: 'extrude', thicken: 'extrude', height: 'extrude',
  spin: 'revolve', lathe: 'revolve', turn: 'revolve',
  resize: 'resize', bigger: 'resize', smaller: 'resize', taller: 'resize', wider: 'resize', longer: 'resize', stretch: 'resize', arrow: 'arrow', arrows: 'arrow',
  rotate: 'move', position: 'move', place: 'move', drag: 'move', translate: 'move',
  join: 'combine', merge: 'combine', union: 'combine', boolean: 'combine', intersect: 'combine', glue: 'combine',
  array: 'pattern', repeat: 'pattern', copies: 'pattern', duplicate: 'pattern', copy: 'pattern',
  symmetric: 'mirror', symmetry: 'mirror', flip: 'mirror',
  hollow: 'shell', wall: 'shell', walls: 'shell', thickness: 'shell',
  variable: 'parameter', variables: 'parameter', formula: 'parameter', expression: 'parameter', equation: 'parameter',
  size: 'measure', dimension: 'measure', dimensions: 'measure', distance: 'measure', length: 'measure', big: 'measure', ruler: 'measure',
  volume: 'weight', mass: 'weight', grams: 'weight', filament: 'weight', heavy: 'weight',
  save: 'file', saving: 'file', load: 'open', import: 'open', obj: 'open',
  key: 'shortcut', keys: 'shortcut', keyboard: 'shortcut', hotkey: 'shortcut', shortcuts: 'shortcut',
  zoom: 'navigate', pan: 'navigate', orbit: 'navigate', view: 'navigate', camera: 'navigate', look: 'navigate',
  colour: 'color', paint: 'color',
  delete: 'erase', erase: 'erase', trash: 'erase',
  inch: 'unit', inches: 'unit', mm: 'unit', millimeter: 'unit', units: 'unit', metric: 'unit', imperial: 'unit',
  wrong: 'error', broken: 'error', problem: 'error', fail: 'error', failed: 'error', red: 'error', warning: 'error',
  undo: 'undo', mistake: 'undo', back: 'undo',
  step: 'step', iges: 'step', fusion: 'step', solidworks: 'step', f3d: 'step',
  thread: 'unsupported', threads: 'unsupported', screw: 'unsupported', text: 'unsupported', font: 'unsupported',
  assembly: 'unsupported', joint: 'unsupported', drawing2d: 'unsupported', cam: 'unsupported', gear: 'unsupported',
  blocked: 'mac', gatekeeper: 'mac', notarized: 'mac', bounce: 'mac', bouncing: 'mac',
  who: 'pip', yourself: 'pip', name: 'pip',
  rect: 'rectangle', square: 'rectangle', box: 'box', cube: 'box', cylinder: 'cylinder', tube: 'cylinder', ball: 'sphere',
  circle: 'circle', polygon: 'circle', hexagon: 'circle',
  timeline: 'edit', change: 'edit', modify: 'edit', edit: 'edit', later: 'edit',
};

const KB = [
  {
    topic: ['step'],
    a: 'OpenCAD can\'t read STEP, IGES or Fusion files. Export an <b>STL</b> or <b>OBJ</b> from the other program and open that instead.',
  },
  {
    topic: ['unsupported'],
    a: 'I can\'t do that one yet. Threads, text, gears, assemblies and 2D drawings aren\'t built in. Tip: many threaded parts and gears are on Printables or Thingiverse as STL, and you can open those here and combine them.',
  },
  {
    topic: ['mac'],
    a: 'If the Mac app just bounces in the Dock, macOS is blocking it because it isn\'t notarized. See <b>“If the app is blocked”</b> in the project README for the one‑line Terminal fix.',
  },
  {
    topic: ['sketch'], also: ['rectangle', 'circle', 'line'],
    a: 'Press <b>S</b> (Sketch), then click an origin plane or any flat face of a body. Draw with <b>Line</b>, <b>Rectangle</b>, <b>Circle</b>, <b>Polygon</b> or <b>Slot</b>. While drawing, type a number for an exact size (for a rectangle, <code>40,20</code>). Press <b>Enter</b> to finish.',
    actions: [{ label: 'Start a sketch', cmd: 'sketch' }],
  },
  {
    topic: ['resize', 'arrow'],
    a: '<b>Double‑click</b> a shape (or click its step on the timeline) and drag the <b>blue arrows</b> to resize it. Hold <b>⇧</b> for 0.1 mm steps or <b>⌥</b> to turn off snapping. You can also type exact numbers in the panel.',
  },
  {
    topic: ['extrude'],
    a: 'Select a finished sketch and press <b>E</b> (Extrude). Type a distance and press Enter. Use <b>Symmetric</b> to grow both ways, and <b>Round corners</b>, <b>Taper</b> or <b>Twist</b> for fancier shapes.',
    actions: [{ label: 'Extrude', cmd: 'extrude' }],
  },
  {
    topic: ['cut'],
    a: 'Two easy ways to make a hole or pocket:<br>1. Sketch a circle (or any shape) <b>on the face</b>, press <b>E</b> and type a <b>negative distance</b>. It switches to <b>Cut</b> automatically.<br>2. Draw the hole <b>inside</b> another shape in the same sketch. Inner shapes become holes when extruded.',
    actions: [{ label: 'Sketch on a face', cmd: 'sketch' }],
  },
  {
    topic: ['fillet'], also: ['chamfer'],
    a: 'Boxes and cylinders have an <b>Edge fillet</b> field that rounds every edge. For a sketched shape, use <b>Round corners</b> in the Extrude panel to round its vertical edges. Picking single edges to fillet isn\'t supported yet.',
    actions: [{ label: 'Rounded box', cmd: 'box' }],
  },
  {
    topic: ['revolve'],
    a: 'Sketch half of the profile next to the sketch\'s vertical axis, then choose <b>Revolve</b>. Great for vases, knobs, wheels and bottles.',
    actions: [{ label: 'Revolve', cmd: 'revolve' }],
  },
  {
    topic: ['stl'],
    a: 'Click <b>Export → STL</b>. If bodies are selected, only those are exported; otherwise every visible body is. Open the file in your slicer (Cura, PrusaSlicer, Bambu Studio…). Units are millimetres.',
    actions: [{ label: 'Export STL', cmd: 'exportStl' }],
  },
  {
    topic: ['move'],
    a: 'Select a body and press <b>M</b>. Drag the arrows to slide it, switch to <b>Rotate</b> to spin it, or type exact values. Tick <b>Create copy</b> to move a duplicate instead.',
    actions: [{ label: 'Move selected body', cmd: 'move' }],
  },
  {
    topic: ['combine'],
    a: 'Click the main body, ⇧‑click the others, then press <b>J</b> (Combine) and choose <b>Join</b>, <b>Cut</b> or <b>Intersect</b>.',
    actions: [{ label: 'Combine', cmd: 'combine' }],
  },
  {
    topic: ['pattern'],
    a: 'Use <b>Pattern</b> for rows and grids of copies, or <b>Circular</b> for copies around an axis (bolt holes, spokes). Change the count later and everything updates.',
    actions: [{ label: 'Linear pattern', cmd: 'linearPattern' }, { label: 'Circular pattern', cmd: 'circularPattern' }],
  },
  {
    topic: ['mirror'],
    a: 'Select a body and choose <b>Mirror</b>. Pick the mirror plane (YZ, XZ or XY). Leave <b>Join to original</b> ticked to get one symmetric body.',
    actions: [{ label: 'Mirror', cmd: 'mirror' }],
  },
  {
    topic: ['shell'],
    a: 'Select a body and choose <b>Hollow</b>, then set the wall thickness. Then cut an opening (a box with <b>Cut</b>) to make a container.',
    actions: [{ label: 'Hollow', cmd: 'shell' }],
  },
  {
    topic: ['parameter'],
    a: 'Open <b>Parameters</b>, add names like <code>width = 40</code>, then type <code>width</code> or <code>width/2 + 3</code> in any field. Change the parameter and the whole model follows.',
    actions: [{ label: 'Open parameters', cmd: 'params' }],
  },
  {
    topic: ['edit'],
    a: 'Every step is on the <b>timeline</b> at the bottom. Click a step to change its numbers, or right‑click it to rename, suppress, reorder or delete it.',
  },
  {
    topic: ['measure'],
    a: 'Press <b>I</b> (Measure) and click two points on your model. Select a body to see its size, volume and weight in the left panel.',
    actions: [{ label: 'Measure', cmd: 'measure' }],
  },
  {
    topic: ['open'], also: ['file'],
    a: 'Use <b>Open</b> for <code>.ocad</code> designs and <code>.stl</code> / <code>.obj</code> models, or just drag a file onto the window. <b>Import</b> adds a mesh to the design you have open. Press <b>⌘S</b> / <b>Ctrl+S</b> to save.',
    actions: [{ label: 'Open a file', cmd: 'open' }, { label: 'Save', cmd: 'save' }],
  },
  {
    topic: ['navigate'],
    a: 'Drag to orbit, right‑drag or ⇧‑drag to pan, scroll or pinch to zoom. Press <b>F</b> to fit everything, <b>0</b> for the home view, <b>1</b>/<b>2</b>/<b>3</b> for front/top/right.',
    actions: [{ label: 'Fit view', cmd: 'fit' }, { label: 'Home view', cmd: 'view:iso' }],
  },
  {
    topic: ['shortcut'],
    a: 'Handy keys: <b>S</b> sketch, <b>E</b> extrude, <b>B</b> box, <b>M</b> move, <b>J</b> combine, <b>I</b> measure, <b>F</b> fit, <b>⌘Z</b> undo.',
    actions: [{ label: 'All shortcuts', cmd: 'shortcuts' }],
  },
  {
    topic: ['color'],
    a: 'Click the little colour square next to a body in the left panel, or right‑click the body and choose <b>Change color</b>.',
  },
  {
    topic: ['erase'],
    a: 'Select a body and press <b>Delete</b> to remove it, or right‑click a timeline step and choose <b>Delete</b>.',
  },
  {
    topic: ['undo'],
    a: 'Press <b>⌘Z</b> (Ctrl+Z on Windows) to undo and <b>⇧⌘Z</b> to redo. You can also fix any step later from the timeline.',
    actions: [{ label: 'Undo', cmd: 'undo' }],
  },
  {
    topic: ['unit'],
    a: 'OpenCAD works in millimetres. You can type other units in any field: <code>1in</code>, <code>2cm</code> or <code>0.5ft</code> get converted for you.',
  },
  {
    topic: ['box'], also: ['cylinder', 'sphere'],
    a: 'Press <b>B</b> for a box or <b>Y</b> for a cylinder (sphere, cone and torus are in the toolbar). Type the sizes and position, and add an <b>Edge fillet</b> for rounded edges.',
    actions: [{ label: 'Add a box', cmd: 'box' }, { label: 'Add a cylinder', cmd: 'cylinder' }],
  },
  {
    topic: ['pip'],
    a: 'I\'m <b>Pip</b>, your OpenCAD buddy! Ask me how to do things, or ask <i>“what\'s wrong?”</i> or <i>“how big is it?”</i> about your model.',
  },
];

const STOP = new Set('a an the i to do how can make my me it is in on of for and or with you your this that what whats what\'s please pls want need get some should would could does use using'.split(' '));

export function tokenize(text) {
  return String(text).toLowerCase().replace(/[’']/g, '\'').split(/[^a-z0-9']+/).filter(Boolean);
}

function stem(w) {
  if (SYN[w]) return SYN[w];
  for (const suf of ['ing', 'ed', 'es', 's']) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      const base = w.slice(0, -suf.length);
      if (SYN[base]) return SYN[base];
      if (KB.some((e) => e.topic.includes(base))) return base;
    }
  }
  return w;
}

const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Answer a question. ctx: { errors: [{name, message}], bodies: [{name, size:[x,y,z], volume}], selected: [...names] }
 * Returns { html, mood, actions }.
 */
export function answer(question, ctx = {}) {
  const words = tokenize(question);
  if (!words.length) return { html: 'Ask me anything about OpenCAD!', mood: 'idle', actions: [] };
  const terms = new Set(words.filter((w) => !STOP.has(w)).map(stem));
  const raw = new Set(words);

  // greetings & thanks
  if ([...raw].some((w) => ['hi', 'hello', 'hey', 'yo', 'sup'].includes(w)) && words.length <= 4) {
    return { html: 'Hi there! 👋 What are you building today?', mood: 'wave', actions: [] };
  }
  if ([...raw].some((w) => ['thanks', 'thank', 'thx', 'ty'].includes(w))) {
    return { html: 'Any time! Happy making. 🛠️', mood: 'cheer', actions: [] };
  }
  if (raw.has('good') && (raw.has('boy') || raw.has('pip') || raw.has('job'))) {
    return { html: '*happy beeps* 🟦 Thank you!', mood: 'cheer', actions: [] };
  }

  // questions about the open model
  if (terms.has('error')) {
    const errs = ctx.errors || [];
    if (!errs.length) return { html: 'Everything looks good. No steps have errors right now. ✅', mood: 'happy', actions: [] };
    const list = errs.slice(0, 4).map((e) => `<li><b>${escapeHtml(e.name)}</b>: ${escapeHtml(e.message)}</li>`).join('');
    return {
      html: `${errs.length === 1 ? 'One step needs attention' : `${errs.length} steps need attention`}:<ul>${list}</ul>Click the red step on the timeline to fix it, or press ⌘Z to undo.`,
      mood: 'worried', actions: [{ label: 'Undo last change', cmd: 'undo' }],
    };
  }
  const asksAboutModel = raw.has('big') || raw.has('weigh') || terms.has('weight') || (terms.has('measure') && !raw.has('how'));
  if (asksAboutModel) {
    const bodies = ctx.selected?.length ? ctx.bodies.filter((b) => ctx.selected.includes(b.name)) : ctx.bodies || [];
    if (!bodies.length) return { html: 'There\'s nothing to measure yet. Make a body first, like a box (<b>B</b>).', mood: 'think', actions: [{ label: 'Add a box', cmd: 'box' }] };
    {
      const rows = bodies.slice(0, 4).map((b) => `<li><b>${escapeHtml(b.name)}</b>: ${fmt(b.size[0])} × ${fmt(b.size[1])} × ${fmt(b.size[2])} mm, ${fmt(b.volume / 1000, 2)} cm³ ≈ <b>${fmt((b.volume / 1000) * 1.24, 1)} g</b> of PLA</li>`).join('');
      return { html: `Here's what I measured:<ul>${rows}</ul>${bodies.length > 4 ? `…and ${bodies.length - 4} more.` : ''}`, mood: 'happy', actions: [{ label: 'Measure two points', cmd: 'measure' }] };
    }
  }

  // knowledge base
  let best = null, bestScore = 0;
  for (const e of KB) {
    let score = 0;
    for (const t of e.topic) if (terms.has(t)) score += 3;
    for (const t of e.also || []) if (terms.has(t)) score += 1;
    if (score > bestScore) { best = e; bestScore = score; }
  }
  if (best && bestScore >= 1) return { html: best.a, mood: 'happy', actions: best.actions || [] };

  return {
    html: 'Hmm, I\'m not sure about that one. I know about <b>sketching</b>, <b>extruding</b>, <b>holes</b>, <b>rounded edges</b>, <b>patterns</b>, <b>moving</b>, <b>measuring</b> and <b>exporting for 3D printing</b>. Try asking one of those!',
    mood: 'think',
    actions: [],
  };
}

export const SUGGESTIONS = ['How do I make a hole?', 'Export for 3D printing', 'What\'s wrong?', 'How big is it?', 'Round the edges'];
