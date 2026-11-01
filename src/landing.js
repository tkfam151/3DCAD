// Start screen: create a new design, open files, reopen recent work.
import { icon } from './ui/icons.js';
import { getRecents, removeRecent, clearRecents, timeAgo } from './recents.js';
import { buildExamples } from './examples.js';
import thumbBracket from './assets/examples/bracket.jpg';
import thumbEnclosure from './assets/examples/enclosure.jpg';
import thumbVase from './assets/examples/vase.jpg';
import thumbWheel from './assets/examples/wheel.jpg';

const EXAMPLE_THUMBS = [thumbBracket, thumbEnclosure, thumbVase, thumbWheel];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KIND_LABEL = { ocad: 'Design', stl: 'STL mesh', obj: 'OBJ mesh' };

export class Landing {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('landing');
    this.visible = false;
  }

  show() {
    this.visible = true;
    document.body.classList.add('on-landing');
    document.title = 'OpenCAD Studio';
    this.app.api?.setDirty(false, 'OpenCAD Studio');
    this.render();
    this.el.hidden = false;
    const m = this.app.mascot;
    if (m && !this._greeted) {
      this._greeted = true;
      m.say('Hi, I’m <b>Pip</b>! Start a <b>new design</b>, pick a template, or drop in an STL. Click me to ask a question, or press <b>H</b> to hide me.', 'wave', 9000);
    }
  }

  hide() {
    this.visible = false;
    document.body.classList.remove('on-landing');
    this.el.hidden = true;
    this.app.vp.resize();
  }

  render() {
    const recents = getRecents();
    const examples = buildExamples();
    const recovery = this.app.readAutosave();
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) || this.app.api?.platform === 'darwin' ? '⌘' : 'Ctrl+';

    this.el.innerHTML = `
      <div class="ld-top">
        <div class="ld-brand"><span class="logo">◆</span> OpenCAD Studio</div>
        <div class="ld-tagline">Free parametric 3D design</div>
      </div>
      <div class="ld-body">
        <nav class="ld-side">
          <button class="ld-action primary" data-act="new">
            ${icon('plus')}<span><b>New design</b><small>Start from a blank canvas · ${mod}N</small></span>
          </button>
          <button class="ld-action" data-act="open">
            ${icon('open')}<span><b>Open file…</b><small>.ocad designs, .stl and .obj models · ${mod}O</small></span>
          </button>
          <div class="ld-drop" data-drop>
            ${icon('import')}
            <span>Drop a <b>.ocad</b>, <b>.stl</b> or <b>.obj</b> file here</span>
          </div>
          ${this.app.mascot?.hidden ? '<button class="link-btn" data-act="show-pip">Bring back Pip, the helper (H)</button>' : ''}
          <div class="ld-tips">
            <div class="ld-h">Getting started</div>
            <ol>
              <li><b>Sketch</b> (S) on a plane or a face</li>
              <li><b>Extrude</b> (E) or <b>Revolve</b> the profile</li>
              <li>Click any timeline step to change it later</li>
              <li><b>Export STL</b> for your 3D printer</li>
            </ol>
          </div>
        </nav>
        <main class="ld-main">
          ${recovery ? `
            <div class="ld-recover">
              ${icon('warn')}
              <div><b>Recover unsaved work?</b><span>“${esc(recovery.name)}” · ${recovery.doc.features.length} steps · ${timeAgo(recovery.t)}</span></div>
              <button class="btn" data-act="discard-recovery">Discard</button>
              <button class="btn primary" data-act="recover">Recover</button>
            </div>` : ''}
          <section>
            <div class="ld-section-head">
              <h2>Recent</h2>
              ${recents.length ? '<button class="link-btn" data-act="clear-recents">Clear</button>' : ''}
            </div>
            ${recents.length ? `<div class="ld-grid">${recents.map((r) => this.recentCard(r)).join('')}</div>`
              : `<div class="ld-empty">${icon('folder')}<span>Designs you open or save will show up here.</span></div>`}
          </section>
          <section>
            <div class="ld-section-head"><h2>Start from a template</h2></div>
            <div class="ld-grid">
              <button class="ld-card" data-act="new">
                <div class="ld-thumb blank">${icon('plus')}</div>
                <div class="ld-meta"><b>Blank design</b><span>Empty workspace</span></div>
              </button>
              ${examples.map((x, i) => `
                <button class="ld-card" data-example="${i}">
                  <div class="ld-thumb"><img src="${EXAMPLE_THUMBS[i]}" alt=""/></div>
                  <div class="ld-meta"><b>${esc(x.name)}</b><span>${esc(x.description)}</span></div>
                </button>`).join('')}
            </div>
          </section>
        </main>
      </div>`;

    // Pip lives in the corner of whichever screen is showing
    this.app.mascot?.mount(this.el);
    this.el.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.action(b.dataset.act);
      });
    });
    this.el.querySelectorAll('[data-example]').forEach((b) => {
      b.onclick = () => {
        const x = examples[Number(b.dataset.example)];
        this.app.openTemplate(x);
      };
    });
    this.el.querySelectorAll('[data-recent]').forEach((card) => {
      const entry = recents.find((r) => r.id === card.dataset.recent);
      card.onclick = (e) => {
        if (e.target.closest('[data-remove]')) {
          e.stopPropagation();
          removeRecent(entry.id);
          this.render();
          return;
        }
        this.app.openRecent(entry);
      };
    });
  }

  recentCard(r) {
    const kind = r.kind || 'ocad';
    const unavailable = !r.path && !r.doc;
    return `
      <div class="ld-card${unavailable ? ' unavailable' : ''}" data-recent="${esc(r.id)}" role="button" tabindex="0"
        title="${esc(r.path || r.name)}${unavailable ? '\n(Use Open file… to open it again)' : ''}">
        <div class="ld-thumb">${r.thumb ? `<img src="${r.thumb}" alt=""/>` : icon(kind === 'ocad' ? 'body' : 'import')}
          <span class="ld-kind">${KIND_LABEL[kind] || kind}</span>
          <button class="ld-remove" data-remove title="Remove from list">${icon('close')}</button>
        </div>
        <div class="ld-meta"><b>${esc(r.name)}</b><span>${timeAgo(r.t)}</span></div>
      </div>`;
  }

  action(act) {
    const a = this.app;
    if (act === 'new') a.newDoc();
    else if (act === 'open') a.openDoc();
    else if (act === 'recover') a.recoverAutosave();
    else if (act === 'discard-recovery') { a.discardAutosave(); this.render(); }
    else if (act === 'clear-recents') { clearRecents(); this.render(); }
    else if (act === 'show-pip') { a.mascot.setHidden(false); this.render(); }
  }
}
