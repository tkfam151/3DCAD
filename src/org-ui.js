// School pages: the organisation-password door, sign-in, role checks,
// People (owner: create and edit accounts) and School settings.
import * as cloud from './cloud.js';
import { icon } from './ui/icons.js';
import { usernameOf } from './org.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const UNLOCK_KEY = (slug) => `opencad-org-unlocked:${slug}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ROLE_LABEL = { owner: 'Owner', teacher: 'Teacher', student: 'Student', admin: 'Site admin' };

export function roleLabel(r) { return ROLE_LABEL[r] || r; }

/**
 * Full-screen steps shown over the start screen on /org/<slug>/ and /org/<slug>/student/:
 * 1. organisation password  2. sign in  3. right role for this page.
 * Resolves once the person may use the page.
 */
export class OrgGate {
  constructor(app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.id = 'org-gate';
    document.body.appendChild(this.el);
  }

  unlocked(slug) {
    try { return localStorage.getItem(UNLOCK_KEY(slug)) === '1'; } catch { return false; }
  }

  lock(slug) {
    try { localStorage.removeItem(UNLOCK_KEY(slug)); } catch { /* ignore */ }
  }

  frame(inner) {
    const o = this.app.org || {};
    this.el.hidden = false;
    this.el.style.setProperty('--org', o.color || '#3b8cff');
    this.el.innerHTML = `
      <div class="gate-card">
        <div class="gate-school"><span class="gate-badge">${esc(o.short || '…')}</span>
          <div><b>${esc(o.name || 'Loading school…')}</b><span>${this.app.page.mode === 'student' ? 'Student page' : 'Teachers & staff'}</span></div></div>
        ${inner}
        <div class="gate-foot"><span class="logo">◆</span> OpenCAD Studio${this.app.page.mode === 'student'
          ? ` · <a href="../">Staff page</a>` : ` · <a href="student/">Student page</a>`} · <a href="https://tkfam151.github.io/3DCAD/org/">All schools</a></div>
      </div>`;
    this.el.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
  }

  hide() { this.el.hidden = true; this.el.innerHTML = ''; }

  /** Runs the steps; resolves with { role } when done. */
  async run() {
    const a = this.app;
    const slug = a.page.slug;
    if (!cloud.cloudConfigured()) {
      this.frame('<p class="gate-msg">School pages need the cloud, which isn’t set up in this version.</p>');
      return new Promise(() => {});
    }
    if (!a.org) {
      this.frame('<p class="gate-msg">Loading…</p>');
      await a.lookupOrg(slug, { quiet: true });
      if (!a.org) {
        this.frame(`<p class="gate-msg">There’s no school at this address.</p><a class="btn primary" href="https://tkfam151.github.io/3DCAD/org/">Find your school</a>`);
        return new Promise(() => {});
      }
    }
    // 1. organisation password (remembered on this device)
    if (!this.unlocked(slug)) await this.askPassword(slug);
    // 2. sign in
    a.user = await cloud.currentUser().catch(() => null);
    while (true) {
      if (!a.user) await this.askSignIn(slug);
      // 3. role
      const me = await cloud.whoami().catch(() => ({ admin: false, orgs: [] }));
      const m = me.orgs.find((x) => x.org === slug);
      const role = me.admin ? 'admin' : m?.role || null;
      if (!role) {
        const ok = await this.message(`Your account <b>${esc(a.user.email)}</b> isn’t part of ${esc(a.org.name)}. Ask your school owner to add you.`, 'Use another account');
        if (ok) { await cloud.signOut().catch(() => {}); a.user = null; continue; }
      } else if (a.page.mode === 'staff' && role === 'student') {
        this.frame(`<p class="gate-msg">This page is for teachers and staff. Students use the student page.</p>
          <a class="btn primary" href="student/">Go to the student page</a>
          <button class="btn" data-out>Use another account</button>`);
        await new Promise((resolve) => { this.el.querySelector('[data-out]').onclick = resolve; });
        await cloud.signOut().catch(() => {}); a.user = null; continue;
      }
      this.hide();
      return { role, membership: m || null, admin: me.admin };
    }
  }

  askPassword(slug) {
    return new Promise((resolve) => {
      this.frame(`
        <h2>Enter the school password</h2>
        <p class="gate-sub">Your school gave you this password. You only need it once on this device.</p>
        <form class="gate-form"><input id="gate-pw" type="password" autocomplete="off" placeholder="School password"/>
          <div class="auth-msg" hidden></div><button class="btn primary" type="submit">Continue</button></form>`);
      const f = this.el.querySelector('form');
      const msg = this.el.querySelector('.auth-msg');
      f.onsubmit = async (e) => {
        e.preventDefault();
        const pw = this.el.querySelector('#gate-pw').value;
        if (!pw) return;
        try {
          if (await cloud.checkOrgPassword(slug, pw)) {
            try { localStorage.setItem(UNLOCK_KEY(slug), '1'); } catch { /* ignore */ }
            resolve();
          } else { msg.hidden = false; msg.textContent = 'That password isn’t right. Check with your teacher.'; }
        } catch (err) { msg.hidden = false; msg.textContent = err.message; }
      };
      setTimeout(() => this.el.querySelector('#gate-pw')?.focus(), 30);
    });
  }

  askSignIn(slug) {
    const a = this.app;
    return new Promise((resolve) => {
      this.frame(`
        <h2>Sign in</h2>
        <p class="gate-sub">Use the username and password from your school${a.page.mode === 'staff' ? ', or your email if you set up this school' : ''}.</p>
        <form class="gate-form">
          <input id="gate-user" autocomplete="username" placeholder="Username${a.page.mode === 'staff' ? ' or email' : ''}"/>
          <input id="gate-pass" type="password" autocomplete="current-password" placeholder="Password"/>
          <div class="auth-msg" hidden></div><button class="btn primary" type="submit">Sign in</button>
          <p class="gate-sub small">Forgot your password? Ask your school owner to reset it.</p>
        </form>`);
      const msg = this.el.querySelector('.auth-msg');
      this.el.querySelector('form').onsubmit = async (e) => {
        e.preventDefault();
        const id = this.el.querySelector('#gate-user').value.trim();
        const pw = this.el.querySelector('#gate-pass').value;
        if (!id || !pw) return;
        try {
          a.user = await cloud.signIn(a.loginEmail(id), pw);
          resolve();
        } catch (err) { msg.hidden = false; msg.textContent = /wrong email/i.test(err.message) ? 'Wrong username or password.' : err.message; }
      };
      setTimeout(() => this.el.querySelector('#gate-user')?.focus(), 30);
    });
  }

  message(html, button) {
    return new Promise((resolve) => {
      this.frame(`<p class="gate-msg">${html}</p><button class="btn primary" data-ok>${esc(button)}</button>`);
      this.el.querySelector('[data-ok]').onclick = () => resolve(true);
    });
  }
}

/** Owner / admin: create, edit and remove teacher and student accounts in a school. */
export class PeopleUI {
  constructor(app) { this.app = app; }

  async open() {
    const a = this.app;
    this.m = a.modal({ title: `${icon('user')} People · ${esc(a.org.name)}`, body: '<div class="pp"><p class="muted">Loading…</p></div>', wide: true, buttons: [{ label: 'Close' }] });
    this.m.classList.add('classes-modal');
    this.body = this.m.querySelector('.pp');
    this.render();
  }

  async render() {
    const a = this.app;
    let people;
    try { ({ people } = await cloud.orgAdmin('list', { org: a.org.slug })); } catch (e) {
      this.body.innerHTML = `<div class="auth-msg">${esc(e.message)}</div>`;
      return;
    }
    const count = (r) => people.filter((p) => p.role === r).length;
    this.body.innerHTML = `
      <details class="cl-add" ${people.length < 2 ? 'open' : ''}><summary>${icon('plus')} Add a student or teacher</summary>
        <form class="pp-form">
          <label>Name<input id="pp-name" maxlength="80" placeholder="e.g. Tonkla S."/></label>
          <label>Username<input id="pp-user" maxlength="31" placeholder="e.g. tonkla" autocomplete="off"/></label>
          <label>Password<input id="pp-pass" maxlength="72" placeholder="At least 6 characters" autocomplete="new-password"/></label>
          <label>Role<select id="pp-role"><option value="student">Student</option><option value="teacher">Teacher</option>${a.membership?.admin ? '<option value="owner">Owner</option>' : ''}</select></label>
          <button class="btn primary" type="submit">Add</button>
        </form>
        <div class="auth-msg" hidden></div>
        <p class="muted small">They sign in at <b>${esc(a.orgLink(''))}</b> (teachers) or <b>${esc(a.orgLink('student/'))}</b> (students) with this username and password, after the school password.</p>
      </details>
      <div class="pp-head"><h4>${plural(people.length, 'person', 'people')} · ${plural(count('teacher'), 'teacher')} · ${plural(count('student'), 'student')}</h4>
        <input id="pp-search" type="search" placeholder="Search…"/></div>
      <table class="pp-table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th></th></tr></thead><tbody>
        ${people.map((p) => `<tr data-id="${p.user_id}">
          <td>${esc(p.display_name || '—')}</td><td><code>${esc(p.username || '(email)')}</code></td>
          <td><select data-role ${p.role === 'owner' && !a.membership?.admin ? 'disabled' : ''}>
            ${['student', 'teacher', 'owner'].filter((r) => r !== 'owner' || a.membership?.admin || p.role === 'owner').map((r) => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${roleLabel(r)}</option>`).join('')}
          </select></td>
          <td class="pp-actions"><button class="btn small" data-pw>Reset password</button>${p.user_id !== a.user?.id && (p.role !== 'owner' || a.membership?.admin) ? '<button class="btn small danger" data-rm>Remove</button>' : ''}</td></tr>`).join('')}
      </tbody></table>`;
    const $ = (s) => this.body.querySelector(s);
    const msg = $('.auth-msg');
    this.body.querySelectorAll('input, select').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    $('#pp-name').oninput = () => {
      if (!$('#pp-user').dataset.touched) $('#pp-user').value = $('#pp-name').value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 30);
    };
    $('#pp-user').oninput = () => { $('#pp-user').dataset.touched = '1'; };
    $('.pp-form').onsubmit = async (e) => {
      e.preventDefault();
      msg.hidden = true;
      try {
        await cloud.orgAdmin('create', { org: a.org.slug, displayName: $('#pp-name').value.trim(), username: $('#pp-user').value.trim().toLowerCase(), password: $('#pp-pass').value, role: $('#pp-role').value });
        a.toast(`Added ${$('#pp-name').value.trim() || $('#pp-user').value}`);
        this.render();
      } catch (err) { msg.hidden = false; msg.textContent = err.message; }
    };
    $('#pp-search').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      this.body.querySelectorAll('tbody tr').forEach((tr) => { tr.hidden = q && !tr.textContent.toLowerCase().includes(q); });
    };
    this.body.querySelectorAll('tbody tr').forEach((tr) => {
      const p = people.find((x) => x.user_id === tr.dataset.id);
      tr.querySelector('[data-role]').onchange = async (e) => {
        try { await cloud.orgAdmin('update', { org: a.org.slug, userId: p.user_id, role: e.target.value }); a.toast(`${p.display_name || p.username} is now a ${roleLabel(e.target.value).toLowerCase()}`); } catch (err) { a.toast(err.message, 'error'); e.target.value = p.role; }
      };
      tr.querySelector('[data-pw]').onclick = async () => {
        const pw = await a.askText(`New password for ${p.display_name || p.username}`, 'At least 6 characters', 'Set password');
        if (!pw) return;
        try { await cloud.orgAdmin('update', { org: a.org.slug, userId: p.user_id, password: pw }); a.toast('Password changed'); } catch (err) { a.toast(err.message, 'error'); }
      };
      tr.querySelector('[data-rm]')?.addEventListener('click', async () => {
        if (!(await a.confirm(`Remove ${p.display_name || p.username}?`, p.username ? 'Their school account and its designs are deleted.' : 'They leave the school; their own account stays.', 'Remove'))) return;
        try { await cloud.orgAdmin('remove', { org: a.org.slug, userId: p.user_id }); this.render(); } catch (err) { a.toast(err.message, 'error'); }
      });
    });
  }
}

/** Owner / admin: school name, badge, colour and password. */
export function openSchoolSettings(app) {
  const o = app.org;
  const m = app.modal({
    title: `${icon('school')} School settings`,
    body: `<form class="auth-form" novalidate>
        <label class="auth-row"><span>School name</span><input id="ss-name" maxlength="120" value="${esc(o.name)}"/></label>
        <div class="sc-grid">
          <label class="auth-row"><span>Short name (badge)</span><input id="ss-short" maxlength="12" value="${esc(o.short)}"/></label>
          <label class="auth-row"><span>City / country</span><input id="ss-city" maxlength="80" value="${esc(o.city || '')}"/></label>
          <label class="auth-row"><span>Colour</span><input id="ss-color" type="color" value="${esc(o.color || '#3b8cff')}"/></label>
        </div>
        <label class="auth-row"><span>New school password (leave empty to keep it)</span><input id="ss-pw" type="text" autocomplete="off" placeholder="At least 6 characters"/></label>
        <div class="auth-msg" hidden></div>
        <button class="btn primary auth-submit" type="submit">Save</button>
      </form>
      <p class="muted small">Web addresses: staff <b>${esc(app.orgLink(''))}</b> · students <b>${esc(app.orgLink('student/'))}</b></p>`,
    buttons: [],
  });
  const $ = (s) => m.querySelector(s);
  const msg = $('.auth-msg');
  m.querySelector('form').addEventListener('keydown', (e) => e.stopPropagation());
  m.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const row = await cloud.updateOrg(o.slug, { name: $('#ss-name').value.trim(), short: $('#ss-short').value.trim(), city: $('#ss-city').value.trim() || null, color: $('#ss-color').value });
      if ($('#ss-pw').value) await cloud.setOrgPassword(o.slug, $('#ss-pw').value);
      Object.assign(app.org, row);
      app.applyOrgLook();
      m.closest('.modal-backdrop')?.remove();
      app.toast($('#ss-pw').value ? 'Saved. Share the new school password with your school.' : 'Saved');
    } catch (err) { msg.hidden = false; msg.textContent = err.message; }
  };
}

/** Normal app / desktop app: go to my school's page. */
export function openMySchool(app) {
  let last = '';
  try { last = localStorage.getItem('opencad-my-school') || ''; } catch { /* ignore */ }
  const m = app.modal({
    title: `${icon('school')} Go to my school`,
    body: `<p class="muted">Type your school's web address name (ask your teacher), or find it in the directory.</p>
      <form class="auth-form" novalidate>
        <label class="auth-row"><span>School</span><div class="sc-url"><span>…/3DCAD/org/</span><input id="ms-slug" maxlength="40" placeholder="e.g. sisb" value="${esc(last)}"/></div></label>
        <div class="ms-roles"><button class="btn primary" type="submit" data-r="student">I’m a student</button><button class="btn" type="submit" data-r="staff">I’m a teacher or owner</button></div>
      </form>
      <p class="small"><a href="https://tkfam151.github.io/3DCAD/org/" target="_blank" rel="noopener">Find your school in the directory</a></p>`,
    buttons: [],
  });
  let role = 'student';
  m.querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => { role = b.dataset.r; }; });
  m.querySelector('form').addEventListener('keydown', (e) => e.stopPropagation());
  m.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    const slug = m.querySelector('#ms-slug').value.trim().toLowerCase().replace(/^.*\/org\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) return app.toast('Type the school’s address name, like “sisb”.', 'error');
    try { localStorage.setItem('opencad-my-school', slug); } catch { /* ignore */ }
    const url = `https://tkfam151.github.io/3DCAD/org/${slug}/${role === 'student' ? 'student/' : ''}`;
    m.closest('.modal-backdrop')?.remove();
    if (app.api) window.open(url, '_blank'); // desktop app: opens the browser
    else location.href = url;
  };
}

export { usernameOf };
