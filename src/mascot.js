// Pip — the OpenCAD helper. A little cube that stands in the bottom-left
// corner, reacts to what you do and offers tips in a speech bubble.

const HIDE_KEY = 'opencad-mascot-hidden';

const TIPS = [
  'Press <b>S</b> to sketch on a plane — or click a flat face of a body.',
  'Shapes drawn inside other shapes become <b>holes</b> when you extrude.',
  'Every field understands math: try <code>width/2 + 3</code> or <code>1in</code>.',
  'Click any step on the <b>timeline</b> to change it later.',
  'Right‑drag or ⇧‑drag to pan, scroll or pinch to zoom.',
  'Press <b>I</b> to measure between two points.',
  'Extrude a face sketch with a <b>negative</b> distance to cut a pocket.',
  'Name your sizes in <b>Parameters</b> and the whole model follows.',
  '<b>Export → STL</b> sends your part to the slicer.',
  'Press <b>?</b> to see every keyboard shortcut.',
];

const SVG = `
<svg class="pip-svg" viewBox="0 0 96 112" aria-hidden="true">
  <defs>
    <linearGradient id="pipFront" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5aa6ff"/><stop offset="1" stop-color="#2f6fd0"/>
    </linearGradient>
    <linearGradient id="pipTop" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d9e9ff"/><stop offset="1" stop-color="#9cc4ff"/>
    </linearGradient>
  </defs>
  <ellipse class="pip-shadow" cx="48" cy="106" rx="26" ry="4.5"/>
  <g class="pip-body">
    <g class="pip-legs">
      <rect x="31" y="88" width="9" height="14" rx="4.5" fill="#1d4a8f"/>
      <rect x="56" y="88" width="9" height="14" rx="4.5" fill="#1d4a8f"/>
      <ellipse cx="34.5" cy="102" rx="7" ry="3.5" fill="#173b73"/>
      <ellipse cx="61.5" cy="102" rx="7" ry="3.5" fill="#173b73"/>
    </g>
    <g class="pip-arm-left">
      <path d="M17 58 q-10 8 -8 20" stroke="#2f6fd0" stroke-width="7" stroke-linecap="round" fill="none"/>
    </g>
    <g class="pip-arm-right">
      <path d="M79 58 q10 -6 10 -18" stroke="#2f6fd0" stroke-width="7" stroke-linecap="round" fill="none"/>
      <g class="pip-pencil" transform="translate(86 22) rotate(18)">
        <rect x="-3" y="0" width="6" height="18" rx="1.5" fill="#ffb02e"/>
        <path d="M-3 18 L0 25 L3 18 Z" fill="#f3d8a8"/><path d="M-1 22.6 L0 25 L1 22.6 Z" fill="#333"/>
        <rect x="-3" y="-3" width="6" height="4" rx="1.5" fill="#e5534b"/>
      </g>
    </g>
    <path d="M18 34 L48 20 L78 34 L48 48 Z" fill="url(#pipTop)"/>
    <ellipse cx="48" cy="34" rx="8" ry="3.6" fill="#2f6fd0" opacity=".75"/>
    <path d="M18 34 L48 48 L78 34 L78 80 Q78 90 68 90 L28 90 Q18 90 18 80 Z" fill="url(#pipFront)"/>
    <path d="M48 48 L48 90" stroke="#ffffff" stroke-opacity=".12" stroke-width="2"/>
    <g class="pip-face">
      <g class="pip-brows">
        <path d="M30 55 l9 -3" stroke="#0d2a6b" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M66 55 l-9 -3" stroke="#0d2a6b" stroke-width="2.4" stroke-linecap="round"/>
      </g>
      <g class="pip-eyes">
        <g class="pip-eye"><ellipse cx="36" cy="63" rx="6" ry="7" fill="#fff"/><circle class="pip-pupil" cx="36" cy="64" r="3.3" fill="#0d1b33"/><circle class="pip-glint" cx="37.4" cy="62.4" r="1.1" fill="#fff"/></g>
        <g class="pip-eye"><ellipse cx="60" cy="63" rx="6" ry="7" fill="#fff"/><circle class="pip-pupil" cx="60" cy="64" r="3.3" fill="#0d1b33"/><circle class="pip-glint" cx="61.4" cy="62.4" r="1.1" fill="#fff"/></g>
      </g>
      <g class="pip-happy-eyes">
        <path d="M30 64 q6 -7 12 0" stroke="#0d1b33" stroke-width="2.8" stroke-linecap="round" fill="none"/>
        <path d="M54 64 q6 -7 12 0" stroke="#0d1b33" stroke-width="2.8" stroke-linecap="round" fill="none"/>
      </g>
      <g class="pip-sleep-eyes">
        <path d="M30 64 q6 4 12 0" stroke="#0d1b33" stroke-width="2.6" stroke-linecap="round" fill="none"/>
        <path d="M54 64 q6 4 12 0" stroke="#0d1b33" stroke-width="2.6" stroke-linecap="round" fill="none"/>
      </g>
      <ellipse cx="27" cy="73" rx="4" ry="2.4" fill="#ff8fb1" opacity=".55"/>
      <ellipse cx="69" cy="73" rx="4" ry="2.4" fill="#ff8fb1" opacity=".55"/>
      <path class="pip-mouth pip-smile" d="M41 74 q7 6 14 0" stroke="#0d1b33" stroke-width="2.6" stroke-linecap="round" fill="none"/>
      <path class="pip-mouth pip-grin" d="M39 72 q9 11 18 0 z" fill="#0d1b33"/>
      <ellipse class="pip-mouth pip-oh" cx="48" cy="76" rx="3.6" ry="4.2" fill="#0d1b33"/>
    </g>
  </g>
  <g class="pip-zzz"><text x="74" y="18">z</text><text x="82" y="9">z</text></g>
</svg>`;

export class Mascot {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'pip mood-idle';
    this.el.innerHTML = `
      <div class="pip-bubble" role="status" aria-live="polite" hidden>
        <button class="pip-close" type="button" aria-label="Close">×</button>
        <div class="pip-text"></div>
        <div class="pip-actions">
          <button class="pip-next" type="button">Another tip</button>
          <button class="pip-hide" type="button" title="Hide Pip (bring back from Help → Show Pip)">Hide Pip</button>
        </div>
      </div>
      <button class="pip-char" type="button" aria-label="Pip, your OpenCAD helper — click for a tip">${SVG}</button>`;
    this.bubble = this.el.querySelector('.pip-bubble');
    this.text = this.el.querySelector('.pip-text');
    this.pupils = [...this.el.querySelectorAll('.pip-pupil, .pip-glint')];
    this.tipIndex = Math.floor(Math.random() * TIPS.length);
    this.hidden = readHidden();
    this.el.hidden = this.hidden;

    this.el.querySelector('.pip-char').addEventListener('click', () => this.tip());
    this.el.querySelector('.pip-close').addEventListener('click', () => this.hideBubble());
    this.el.querySelector('.pip-next').addEventListener('click', () => this.tip());
    this.el.querySelector('.pip-hide').addEventListener('click', () => this.setHidden(true));

    // eyes follow the cursor
    this._look = null;
    window.addEventListener('pointermove', (e) => {
      this._look = [e.clientX, e.clientY];
      if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = null; this.lookAt(...this._look); });
      this.poke();
    }, { passive: true });
    window.addEventListener('keydown', () => this.poke(), { passive: true });
    this.poke();
  }

  mount(container) {
    if (this.el.parentElement !== container) container.appendChild(this.el);
  }

  setHidden(h) {
    this.hidden = h;
    this.el.hidden = h;
    try { localStorage.setItem(HIDE_KEY, h ? '1' : '0'); } catch { /* storage unavailable */ }
    if (!h) this.say('I’m back! Click me any time for a tip.', 'happy');
  }

  toggle() { this.setHidden(!this.hidden); }

  lookAt(x, y) {
    if (this.hidden || this.mood === 'sleep') return;
    const r = this.el.querySelector('.pip-char').getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.55;
    const a = Math.atan2(y - cy, x - cx);
    const d = Math.min(1, Math.hypot(x - cx, y - cy) / 200);
    const dx = Math.cos(a) * 2.2 * d, dy = Math.sin(a) * 2.2 * d;
    for (const p of this.pupils) p.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
  }

  setMood(mood, ms = 0) {
    clearTimeout(this._moodT);
    this.mood = mood;
    this.el.className = `pip mood-${mood}`;
    if (ms) this._moodT = setTimeout(() => this.setMood('idle'), ms);
  }

  /** Show a message. mood: idle | happy | cheer | worried | think | wave */
  say(html, mood = 'idle', ms = 6500) {
    if (this.hidden) return;
    this.text.innerHTML = html;
    this.bubble.hidden = false;
    this.setMood(mood, mood === 'idle' ? 0 : Math.min(ms, 2400));
    clearTimeout(this._bubbleT);
    if (ms) this._bubbleT = setTimeout(() => this.hideBubble(), ms);
  }

  tip() {
    this.tipIndex = (this.tipIndex + 1) % TIPS.length;
    this.say(TIPS[this.tipIndex], 'happy', 9000);
  }

  hideBubble() {
    this.bubble.hidden = true;
    clearTimeout(this._bubbleT);
  }

  /** Any activity wakes Pip up; long inactivity puts Pip to sleep. */
  poke() {
    if (this.mood === 'sleep') this.setMood('idle');
    clearTimeout(this._sleepT);
    this._sleepT = setTimeout(() => {
      if (this.bubble.hidden) this.setMood('sleep');
    }, 120000);
  }
}

function readHidden() {
  try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
}
