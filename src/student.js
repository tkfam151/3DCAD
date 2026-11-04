// Tools for students: 3D-print checks, design journal (IB MYP design cycle) and lessons.

export const PRINTERS = [
  { id: 'bambu-a1', name: 'Bambu Lab A1', bed: [256, 256, 256] },
  { id: 'bambu-a1-mini', name: 'Bambu Lab A1 mini', bed: [180, 180, 180] },
  { id: 'bambu-p1s', name: 'Bambu Lab P1S / X1C', bed: [256, 256, 256] },
  { id: 'prusa-mk4', name: 'Prusa MK4', bed: [250, 210, 220] },
  { id: 'prusa-mini', name: 'Prusa MINI', bed: [180, 180, 180] },
  { id: 'ender3', name: 'Creality Ender-3', bed: [220, 220, 250] },
  { id: 'ultimaker-s5', name: 'UltiMaker S5', bed: [330, 240, 300] },
];

export const MATERIALS = [
  { id: 'pla', name: 'PLA', density: 1.24 },
  { id: 'petg', name: 'PETG', density: 1.27 },
  { id: 'abs', name: 'ABS', density: 1.04 },
  { id: 'tpu', name: 'TPU', density: 1.21 },
];

const FILAMENT_AREA_CM2 = Math.PI * 0.0875 * 0.0875; // 1.75 mm filament

/**
 * Check bodies before 3D printing.
 * bodies: [{ name, positions, indices, volume, area, bbox, meshOnly }]
 * opts: { printer, material, infill (0..1), pricePerKg }
 */
export function printReport(bodies, { printer = PRINTERS[0], material = MATERIALS[0], infill = 0.15, pricePerKg = 600 } = {}) {
  const items = [];
  let total = { grams: 0, hours: 0, cost: 0, metres: 0 };
  // all bodies are printed together on one bed
  const minZ = Math.min(...bodies.filter((b) => b.bbox).map((b) => b.bbox.min[2]));
  for (const b of bodies) {
    if (!b.bbox) continue;
    const size = [0, 1, 2].map((i) => b.bbox.max[i] - b.bbox.min[i]);
    const fits = fitsOnBed(size, printer.bed);
    const z0 = b.bbox.min[2];
    const overhang = overhangShare(b, minZ);
    // material: three perimeters (~1.2 mm) plus sparse infill inside
    const shell = Math.min(b.volume, b.area * 1.2);
    const printedMm3 = shell + Math.max(0, b.volume - shell) * infill;
    const grams = (printedMm3 / 1000) * material.density;
    const metres = printedMm3 / 1000 / FILAMENT_AREA_CM2 / 100;
    const hours = grams / 11 + 0.1; // rough: ~11 g per hour on a modern printer
    const cost = (grams / 1000) * pricePerKg;
    const warnings = [];
    if (b.meshOnly) warnings.push({ level: 'bad', text: 'The mesh isn’t watertight, so slicers may print it wrong.' });
    if (!fits.fits) warnings.push({ level: 'bad', text: `Too big for the ${printer.name} (${printer.bed.join(' × ')} mm). Scale it down or split it into parts.` });
    else if (fits.rotated) warnings.push({ level: 'info', text: 'Fits only if you rotate it on the bed.' });
    if (z0 > minZ + 0.05) warnings.push({ level: 'warn', text: `Floats ${round(z0 - minZ)} mm above the bed. Use Drop to bed, or it needs supports.` });
    if (overhang > 0.03) warnings.push({ level: 'warn', text: `About ${Math.round(overhang * 100)}% of the surface hangs over at more than 45°. Turn on supports or rotate it.` });
    if (Math.min(...size) < 0.8) warnings.push({ level: 'warn', text: 'Very thin (under 0.8 mm). It may not print or may break.' });
    if (!warnings.some((w) => w.level !== 'info')) warnings.unshift({ level: 'ok', text: 'Looks ready to print.' });
    items.push({ name: b.name, size, fits: fits.fits, overhang, grams, metres, hours, cost, warnings });
    total = { grams: total.grams + grams, hours: total.hours + hours, cost: total.cost + cost, metres: total.metres + metres };
  }
  const footprint = bodies.length
    ? (() => {
      const mins = [0, 1].map((i) => Math.min(...bodies.filter((b) => b.bbox).map((b) => b.bbox.min[i])));
      const maxs = [0, 1].map((i) => Math.max(...bodies.filter((b) => b.bbox).map((b) => b.bbox.max[i])));
      return [maxs[0] - mins[0], maxs[1] - mins[1]];
    })()
    : [0, 0];
  return { items, total, printer, material, infill, pricePerKg, togetherFits: footprint[0] <= printer.bed[0] && footprint[1] <= printer.bed[1] };
}

function fitsOnBed(size, bed) {
  const [x, y, z] = size;
  if (z > bed[2]) return { fits: false };
  if (x <= bed[0] && y <= bed[1]) return { fits: true, rotated: false };
  if (y <= bed[0] && x <= bed[1]) return { fits: true, rotated: true };
  // diagonal placement
  const diag = Math.hypot(bed[0], bed[1]);
  if (Math.hypot(x, y) <= diag && Math.min(x, y) <= Math.min(bed[0], bed[1]) * 0.7) return { fits: true, rotated: true };
  return { fits: false };
}

/** Share of surface area facing down steeper than 45° and not resting on the bed. */
export function overhangShare(b, bedZ = 0) {
  const P = b.positions, I = b.indices;
  if (!P || !I || !I.length) return 0;
  let over = 0, total = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, c = I[t + 1] * 3, d = I[t + 2] * 3;
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2];
    const vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (!len) continue;
    const area = len / 2;
    total += area;
    const zMin = Math.min(P[a + 2], P[c + 2], P[d + 2]);
    if (nz / len < -0.7071 && zMin > bedZ + 0.2) over += area;
  }
  return total ? over / total : 0;
}

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function formatHours(h) {
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function formatMoney(v, currency = 'THB') {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: currency === 'THB' ? 0 : 2 }).format(v); } catch { return `${round(v, 2)} ${currency}`; }
}

// ---------- design journal (IB MYP design cycle) ----------

export const JOURNAL_SECTIONS = [
  { key: 'inquiring', title: 'A · Inquiring & analysing', prompt: 'What problem are you solving, and for whom? What did you research? List your design specification (size, material, must-haves).' },
  { key: 'developing', title: 'B · Developing ideas', prompt: 'Describe your design ideas. Which one did you choose and why? Note key dimensions.' },
  { key: 'creating', title: 'C · Creating the solution', prompt: 'How did you model and make it? What changed from your plan, and why?' },
  { key: 'evaluating', title: 'D · Evaluating', prompt: 'Does it meet your specification? How did you test it? What would you improve next time?' },
];

export function journalMarkdown(doc, { title, student, className, school, report } = {}) {
  const j = doc.journal || {};
  const lines = [`# ${title || 'Design journal'}`, ''];
  const who = [student, className, school].filter(Boolean).join(' · ');
  if (who) lines.push(`**${who}**`, '');
  lines.push(`Date: ${new Date().toLocaleDateString()}`, '');
  for (const s of JOURNAL_SECTIONS) {
    lines.push(`## ${s.title}`, '', (j[s.key] || '').trim() || '_Not filled in yet._', '');
  }
  lines.push('## Model', '');
  for (const f of doc.features || []) lines.push(`- ${f.name} (${f.type})${f.suppressed ? ' — suppressed' : ''}`);
  if (doc.parameters?.length) {
    lines.push('', '**Parameters:** ' + doc.parameters.map((p) => `${p.name} = ${p.expr}`).join(', '));
  }
  if (report) lines.push('', '## Print check', '', printReportText(report));
  return lines.join('\n') + '\n';
}

export function printReportText(r, currency = 'THB') {
  const out = [`Printer: ${r.printer.name} (${r.printer.bed.join(' × ')} mm), ${r.material.name}, ${Math.round(r.infill * 100)}% infill`];
  for (const it of r.items) {
    out.push(`- ${it.name}: ${it.size.map((v) => round(v)).join(' × ')} mm, about ${round(it.grams)} g, ${formatHours(it.hours)}, ${formatMoney(it.cost, currency)}`);
    for (const w of it.warnings) out.push(`  - ${w.level === 'ok' ? '✓' : w.level === 'info' ? 'ℹ' : '⚠'} ${w.text}`);
  }
  out.push(`Total: about ${round(r.total.grams)} g (${round(r.total.metres, 1)} m of filament), ${formatHours(r.total.hours)}, ${formatMoney(r.total.cost, currency)}`);
  return out.join('\n');
}

// ---------- guided lessons ----------

export const LESSONS = [
  {
    id: 'keychain',
    title: 'Name keychain',
    level: 'Beginner · 10 min',
    summary: 'A flat tag with your name in raised letters and a hole for a key ring.',
    steps: [
      { text: 'Add a <b>Box</b> for the tag. Make it about <b>60 × 20 × 3 mm</b> and give it an <b>Edge fillet</b> of 1 for smooth corners.', cmd: 'box', label: 'Add a box' },
      { text: 'Click <b>Text</b>, type your name, set <b>Letter height 10</b> and <b>Thickness 2</b>. Choose <b>Join</b>, pick the tag, and set <b>Z = 3</b> and <b>Y = −5</b> so the letters sit on top.', cmd: 'text', label: 'Add text' },
      { text: 'Add a <b>Cylinder</b> (radius 2.5, height 10) at <b>X = −25</b>, <b>Z = −2</b> with <b>Cut</b> to make the key-ring hole.', cmd: 'cylinder', label: 'Add a cylinder' },
      { text: 'Open <b>Print check</b> to see the filament weight and print time.', cmd: 'printCheck', label: 'Print check' },
      { text: 'Fill in your <b>Journal</b> and click <b>Hand in</b> to download everything for your teacher. 🎉', cmd: 'journal', label: 'Open journal' },
    ],
  },
  {
    id: 'phone-stand',
    title: 'Phone stand',
    level: 'Intermediate · 20 min',
    summary: 'Sketch a side profile, extrude it, and round it off. Uses parameters so it fits any phone.',
    steps: [
      { text: 'Open <b>Parameters</b> and add <code>width = 70</code> and <code>thick = 10</code>.', cmd: 'params', label: 'Open parameters' },
      { text: 'Press <b>S</b> and sketch on the <b>XZ (front)</b> plane. Use <b>Line</b> to draw an L‑shaped side profile with a lip at the front: about 80 mm deep and 90 mm tall, leaning back.', cmd: 'sketch', label: 'Start a sketch' },
      { text: 'Press <b>E</b> and extrude by <code>width</code> with <b>Symmetric</b>. Add <b>Round corners</b> 2 for a smooth look.', cmd: 'extrude', label: 'Extrude' },
      { text: 'Add a slot for the charging cable: a <b>Box</b> 15 × 30 × 20 with <b>Cut</b> at the front.', cmd: 'box', label: 'Add a box' },
      { text: 'Run <b>Print check</b>. If it says it needs supports, try rotating the stand so it prints on its side.', cmd: 'printCheck', label: 'Print check' },
    ],
  },
  {
    id: 'box-lid',
    title: 'Box with a lid',
    level: 'Intermediate · 15 min',
    summary: 'A hollow box and a lid that fits, using parameters and Hollow.',
    steps: [
      { text: 'Open <b>Parameters</b> and add <code>w = 60</code>, <code>d = 40</code>, <code>h = 30</code>, <code>wall = 2</code>.', cmd: 'params', label: 'Open parameters' },
      { text: 'Add a <b>Box</b> with width <code>w</code>, depth <code>d</code>, height <code>h</code> and fillet 3.', cmd: 'box', label: 'Add a box' },
      { text: 'Use <b>Hollow</b> with thickness <code>wall</code>, then cut the top off with a <b>Box</b> (<b>Cut</b>, Z = <code>h - 2</code>).', cmd: 'shell', label: 'Hollow' },
      { text: 'Make the lid: a <b>Box</b> <code>w</code> × <code>d</code> × <code>wall</code> beside it, plus a smaller box (<code>w - 2*wall - 0.4</code>) joined underneath as a lip.', cmd: 'box', label: 'Add a box' },
      { text: 'Change <code>w</code> in Parameters and watch both parts update. Then run <b>Print check</b>.', cmd: 'printCheck', label: 'Print check' },
    ],
  },
];
