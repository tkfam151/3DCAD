// Pip — the OpenCAD helper. A pixel critter (look borrowed from Claude Code's
// mascot) that stands in the bottom-left corner, reacts to what you do,
// gives tips and answers questions. Press H to hide or bring Pip back.
import { answer, SUGGESTIONS } from './pip-brain.js';

const HIDE_KEY = 'opencad-mascot-hidden';

const TIPS = [
  'Press <b>S</b> to sketch on a plane, or click a flat face of a body.',
  'Shapes drawn inside other shapes become <b>holes</b> when you extrude.',
  'Every field understands math: try <code>width/2 + 3</code> or <code>1in</code>.',
  'Click any step on the <b>timeline</b> to change it later.',
  'Right‑drag or ⇧‑drag to pan, scroll or pinch to zoom.',
  'Press <b>I</b> to measure between two points.',
  'Extrude a face sketch with a <b>negative</b> distance to cut a pocket.',
  'Name your sizes in <b>Parameters</b> and the whole model follows.',
  '<b>Export → STL</b> sends your part to the slicer.',
  'Press <b>H</b> to hide me, and <b>H</b> again to bring me back.',
];

// Pixel art on a 410 × 330 grid, matching the reference sticker.
const SVG = `
<svg class="pip-svg" viewBox="-14 -14 438 372" shape-rendering="crispEdges" aria-hidden="true">
  <g class="pip-body">
    <g class="pip-legs">
      <rect class="pip-leg l1" x="35" y="230" width="40" height="95"/>
      <rect class="pip-leg l2" x="110" y="230" width="40" height="95"/>
      <rect class="pip-leg l3" x="260" y="230" width="40" height="95"/>
      <rect class="pip-leg l4" x="335" y="230" width="40" height="95"/>
    </g>
    <rect class="pip-arm pip-arm-left" x="0" y="80" width="40" height="80"/>
    <rect class="pip-arm pip-arm-right" x="370" y="80" width="40" height="80"/>
    <rect class="pip-torso" x="35" y="0" width="340" height="240"/>
    <g class="pip-eyes">
      <rect class="pip-eye" x="75" y="80" width="40" height="40"/>
      <rect class="pip-eye" x="295" y="80" width="40" height="40"/>
    </g>
    <rect class="pip-sweat" x="392" y="20" width="18" height="26"/>
  </g>
  <g class="pip-zzz"><rect x="392" y="-6" width="22" height="6"/><rect x="408" y="-6" width="6" height="6"/><rect x="398" y="0" width="6" height="6"/><rect x="392" y="6" width="22" height="6"/></g>
</svg>`;

export class Mascot {
  constructor({ getContext = () => ({}), onAction = () => {} } = {}) {
    this.getContext = getContext;
    this.onAction = onAction;
    this.el = document.createElement('div');
    this.el.className = 'pip mood-idle';
    this.el.innerHTML = `
      <div class="pip-bubble" role="dialog" aria-label="Pip" hidden>
        <button class="pip-close" type="button" aria-label="Close">×</button>
        <div class="pip-q" hidden></div>
        <div class="pip-text" aria-live="polite"></div>
        <div class="pip-acts"></div>
        <div class="pip-chips"></div>
        <form class="pip-ask">
          <input class="pip-input" type="text" placeholder="Ask Pip a question…" autocomplete="off" aria-label="Ask Pip a question"/>
          <button type="submit" aria-label="Ask">➤</button>
        </form>
        <div class="pip-foot">
          <button class="pip-next" type="button">Another tip</button>
          <button class="pip-hide" type="button">Hide Pip <kbd>H</kbd></button>
        </div>
      </div>
      <button class="pip-char" type="button" aria-label="Pip, your OpenCAD helper. Click to ask a question">${SVG}</button>`;
    this.bubble = this.el.querySelector('.pip-bubble');
    this.text = this.el.querySelector('.pip-text');
    this.qEl = this.el.querySelector('.pip-q');
    this.acts = this.el.querySelector('.pip-acts');
    this.chips = this.el.querySelector('.pip-chips');
    this.input = this.el.querySelector('.pip-input');
    this.eyes = this.el.querySelector('.pip-eyes');
    this.tipIndex = Math.floor(Math.random() * TIPS.length);
    this.hidden = readHidden();
    this.el.hidden = this.hidden;

    this.el.querySelector('.pip-char').addEventListener('click', () => this.openChat());
    this.el.querySelector('.pip-close').addEventListener('click', () => this.hideBubble());
    this.el.querySelector('.pip-next').addEventListener('click', () => this.tip());
    this.el.querySelector('.pip-hide').addEventListener('click', () => this.setHidden(true));
    this.el.querySelector('.pip-ask').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = this.input.value.trim();
      if (q) this.ask(q);
      this.input.value = '';
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must not trigger app shortcuts
      if (e.key === 'Escape') { this.input.blur(); this.hideBubble(); }
    });
    // keep the bubble open while the pointer is over it
    this.bubble.addEventListener('pointerenter', () => clearTimeout(this._bubbleT));

    // eyes follow the cursor
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
    if (!h) this.say('I’m back! Click me to ask a question. Press <b>H</b> to hide me again.', 'wave');
  }

  toggle() { this.setHidden(!this.hidden); }

  lookAt(x, y) {
    if (this.hidden || this.mood === 'sleep' || this.mood === 'think') return;
    const r = this.el.querySelector('.pip-char').getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.35;
    const a = Math.atan2(y - cy, x - cx);
    const d = Math.min(1, Math.hypot(x - cx, y - cy) / 220);
    const dx = Math.round(Math.cos(a) * 14 * d), dy = Math.round(Math.sin(a) * 12 * d);
    this.eyes.setAttribute('transform', `translate(${dx} ${dy})`);
  }

  setMood(mood, ms = 0) {
    clearTimeout(this._moodT);
    this.mood = mood;
    this.el.className = `pip mood-${mood}`;
    if (mood === 'think') this.eyes.setAttribute('transform', 'translate(10 -10)');
    if (ms) this._moodT = setTimeout(() => this.setMood('idle'), ms);
  }

  /** Show a message. mood: idle | happy | cheer | worried | think | wave */
  say(html, mood = 'idle', ms = 6500, actions = []) {
    if (this.hidden) return;
    if (this.chatting && document.activeElement === this.input) return; // don't interrupt typing
    this.chatting = false;
    this.bubble.classList.remove('chat');
    this.qEl.hidden = true;
    this.show(html, mood, actions);
    clearTimeout(this._bubbleT);
    if (ms) this._bubbleT = setTimeout(() => { if (!this.bubble.matches(':hover')) this.hideBubble(); }, ms);
  }

  show(html, mood, actions = []) {
    this.text.innerHTML = html;
    this.acts.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pip-act';
      b.textContent = a.label;
      b.onclick = () => { this.hideBubble(); this.onAction(a.cmd); };
      this.acts.appendChild(b);
    }
    this.bubble.hidden = false;
    this.setMood(mood, mood === 'idle' ? 0 : 2400);
  }

  /** Open the question box. */
  openChat() {
    if (this.hidden) return;
    this.chatting = true;
    clearTimeout(this._bubbleT);
    this.bubble.classList.add('chat');
    this.qEl.hidden = true;
    this.show('Hi! I’m <b>Pip</b>. Ask me how to do something, or ask about your model.', 'wave');
    this.renderChips();
    setTimeout(() => this.input.focus(), 30);
  }

  renderChips() {
    this.chips.innerHTML = '';
    for (const s of SUGGESTIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pip-chip';
      b.textContent = s;
      b.onclick = () => this.ask(s);
      this.chips.appendChild(b);
    }
  }

  ask(question) {
    this.chatting = true;
    this.bubble.classList.add('chat');
    let res;
    try {
      res = answer(question, this.getContext());
    } catch {
      res = { html: 'Oops, my brain hiccuped. Try asking another way?', mood: 'worried', actions: [] };
    }
    this.qEl.textContent = question;
    this.qEl.hidden = false;
    this.show(res.html, res.mood, res.actions);
    this.chips.innerHTML = '';
    clearTimeout(this._bubbleT);
    this.input.focus();
  }

  tip() {
    this.tipIndex = (this.tipIndex + 1) % TIPS.length;
    this.chatting = false;
    this.bubble.classList.remove('chat');
    this.qEl.hidden = true;
    this.chips.innerHTML = '';
    this.show(TIPS[this.tipIndex], 'happy');
    clearTimeout(this._bubbleT);
  }

  hideBubble() {
    this.bubble.hidden = true;
    this.chatting = false;
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
