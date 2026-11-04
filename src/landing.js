// Start screen: create a new design, open files, reopen recent work.
import { icon } from './ui/icons.js';
import { getRecents, removeRecent, clearRecents, timeAgo } from './recents.js';
import { buildExamples } from './examples.js';
import * as cloud from './cloud.js';
import { LESSONS } from './student.js';
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
    const org = this.app.org;
    const recents = getRecents();
    const examples = buildExamples();
    const recovery = this.app.readAutosave();
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) || this.app.api?.platform === 'darwin' ? '⌘' : 'Ctrl+';

    this.el.innerHTML = `
      <div class="ld-top">
        <div class="ld-brand"><span class="logo">◆</span> OpenCAD Studio${org ? `<span class="org-chip">${esc(org.short)}</span>` : ''}</div>
        <div class="ld-tagline">${org ? `${icon('school')} ${esc(org.name)}` : 'Free parametric 3D design'}</div>
        <div class="ld-top-actions">
          <button class="btn small" data-act="install" ${this.app.canInstall ? '' : 'hidden'}>${icon('install')} Install app</button>
          ${!org ? `<a class="btn small" href="https://tkfam151.github.io/3DCAD/org/" target="_blank" rel="noopener">${icon('school')} Schools</a>` : ''}
        </div>
        ${cloud.cloudConfigured() ? `<div class="ld-account">${this.app.user
          ? `${icon('user')}<button class="link-btn ld-who" data-act="profile" title="Edit your name and class">${esc(this.app.whoAmI())}</button><button class="btn small" data-act="signout">Sign out</button>`
          : `<button class="btn small" data-act="signin">${icon('user')} Sign in</button>`}</div>` : ''}
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
          ${cloud.cloudConfigured() ? `<button class="ld-action" data-act="classes">
            ${icon('school')}<span><b>Classes</b><small>Join with a code, see assignments, hand in</small></span>
          </button>` : ''}
          ${cloud.cloudConfigured() && !org ? `<button class="ld-action" data-act="add-school">
            ${icon('plus')}<span><b>Add your school</b><small>Get a school space with classes</small></span>
          </button>` : ''}
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
          ${cloud.cloudConfigured() ? `
          <section>
            <div class="ld-section-head"><h2>${icon('cloud')} ${org ? `${esc(org.short)} cloud designs` : 'Cloud designs'}</h2></div>
            ${this.app.user
              ? `<div class="ld-grid" data-cloud><div class="ld-empty">${icon('cloud')}<span>Loading your designs…</span></div></div>`
              : `<div class="ld-empty">${icon('cloud')}<span><button class="link-btn inline" data-act="signin">Sign in</button> to save designs to the cloud and open them on any computer.</span></div>`}
          </section>` : ''}
          <section>
            <div class="ld-section-head">
              <h2>Recent</h2>
              ${recents.length ? '<button class="link-btn" data-act="clear-recents">Clear</button>' : ''}
            </div>
            ${recents.length ? `<div class="ld-grid">${recents.map((r) => this.recentCard(r)).join('')}</div>`
              : `<div class="ld-empty">${icon('folder')}<span>Designs you open or save will show up here.</span></div>`}
          </section>
          <section>
            <div class="ld-section-head"><h2>${icon('lesson')} Lessons</h2><span class="muted small">Step-by-step projects with Pip</span></div>
            <div class="ld-grid ld-lessons">${LESSONS.map((l) => `
              <button class="ld-card ld-lesson" data-lesson="${l.id}">
                <div class="ld-meta"><b>${esc(l.title)}</b><span class="ld-level">${esc(l.level)}</span><span>${esc(l.summary)}</span></div>
              </button>`).join('')}</div>
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

    if (this.app.user) this.loadCloud();
    // Pip lives in the corner of whichever screen is showing
    this.app.mascot?.mount(this.el);
    this.el.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.action(b.dataset.act);
      });
    });
    this.el.querySelectorAll('[data-lesson]').forEach((b) => { b.onclick = () => this.app.startLesson(b.dataset.lesson); });
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

  async loadCloud() {
    const grid = this.el.querySelector('[data-cloud]');
    if (!grid) return;
    let rows;
    try {
      rows = await cloud.listDesigns(this.app.org?.slug || null);
    } catch (e) {
      grid.innerHTML = `<div class="ld-empty">${icon('warn')}<span>Couldn’t load your cloud designs: ${esc(e.message)}</span></div>`;
      return;
    }
    if (!this.el.contains(grid)) return; // the screen was re-rendered meanwhile
    if (!rows.length) {
      grid.innerHTML = `<div class="ld-empty">${icon('cloud')}<span>No cloud designs yet. In the editor, click <b>Cloud</b> to save one.</span></div>`;
      return;
    }
    grid.innerHTML = rows.map((r) => `
      <div class="ld-card" data-cloud-id="${esc(r.id)}" role="button" tabindex="0" title="${esc(r.name)}">
        <div class="ld-thumb">${r.thumb && r.thumb.startsWith('data:image/') ? `<img src="${esc(r.thumb)}" alt=""/>` : icon('cloud')}
          <span class="ld-kind">${r.shared ? 'Shared' : 'Cloud'}</span>
          <button class="ld-remove" data-remove title="Delete from the cloud">${icon('close')}</button>
          <button class="ld-share" data-share title="Share a view-only link">${icon('link')}</button>
        </div>
        <div class="ld-meta"><b>${esc(r.name)}</b><span>${timeAgo(new Date(r.updated_at).getTime())}</span></div>
      </div>`).join('');
    grid.querySelectorAll('[data-cloud-id]').forEach((card) => {
      const row = rows.find((r) => r.id === card.dataset.cloudId);
      card.onclick = async (e) => {
        if (e.target.closest('[data-remove]')) {
          e.stopPropagation();
          if (await this.app.deleteCloudDesign(row.id, row.name)) this.loadCloud();
          return;
        }
        if (e.target.closest('[data-share]')) {
          e.stopPropagation();
          this.app.shareDesign(row.id, row.name);
          return;
        }
        this.app.openCloudDesign(row.id);
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
    else if (act === 'signin') a.showAuth();
    else if (act === 'profile') a.editProfile();
    else if (act === 'classes') a.classes.open();
    else if (act === 'add-school') a.registerSchool();
    else if (act === 'install') a.installApp();
    else if (act === 'signout') a.doSignOut();
    else if (act === 'show-pip') { a.mascot.setHidden(false); this.render(); }
  }
}
