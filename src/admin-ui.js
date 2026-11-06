// /3DCAD/admin/: the site admin's panel (only tonklapc.toogle@gmail.com, checked by the database
// and by the org-admin function; this page just hides itself from everyone else).
import * as cloud from './cloud.js';
import { icon } from './ui/icons.js';
import { usernameOf } from './org.js';
import { roleLabel } from './org-ui.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const day = (t) => (t ? new Date(t).toLocaleDateString() : '—');

export class AdminUI {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('landing');
    this.tab = 'schools';
  }

  async start() {
    const a = this.app;
    a.landing.visible = true;
    document.body.classList.add('on-landing', 'on-admin');
    this.el.hidden = false;
    if (!cloud.cloudConfigured()) return this.shell('<p>The cloud isn’t set up in this version.</p>');
    a.user = await cloud.currentUser().catch(() => null);
    if (!a.user) {
      this.shell(`<div class="ad-empty"><h2>Admin sign-in</h2><p class="muted">This page is only for the OpenCAD site admin.</p><button class="btn primary" data-signin>Sign in</button></div>`);
      this.el.querySelector('[data-signin]').onclick = () => a.showAuth({ then: () => this.start() });
      return;
    }
    const me = await cloud.whoami().catch((e) => ({ admin: false, error: e.message }));
    if (!me.admin) {
      this.shell(`<div class="ad-empty"><h2>Admins only</h2><p class="muted">${esc(a.user.email)} isn’t the site admin.${me.error ? `<br/>${esc(me.error)}` : ''}</p>
        <button class="btn" data-out>Sign out</button> <a class="btn primary" href="../app/">Open the app</a></div>`);
      this.el.querySelector('[data-out]').onclick = async () => { await cloud.signOut().catch(() => {}); this.start(); };
      return;
    }
    this.render();
  }

  shell(inner) {
    this.el.innerHTML = `
      <div class="ad">
        <header class="ad-top"><div class="ad-brand"><span class="logo">◆</span> OpenCAD <span class="ad-chip">Admin</span></div>
          ${this.app.user ? `<nav class="ad-tabs">${[['schools', 'Schools'], ['people', 'People'], ['settings', 'Settings']].map(([k, l]) => `<button data-tab="${k}" class="${this.tab === k ? 'active' : ''}">${l}</button>`).join('')}</nav>
          <div class="ad-me">${esc(this.app.user.email)} <button class="btn small" data-out>Sign out</button> <a class="btn small" href="../app/">Open app</a></div>` : ''}
        </header>
        <main class="ad-main">${inner}</main>
      </div>`;
    this.el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { this.tab = b.dataset.tab; this.render(); }; });
    this.el.querySelector('[data-out]')?.addEventListener('click', async () => { await cloud.signOut().catch(() => {}); this.app.user = null; this.start(); });
    this.el.querySelectorAll('input, textarea, select').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
  }

  async render() {
    this.shell('<p class="muted">Loading…</p>');
    try {
      if (this.tab === 'schools') await this.schools();
      else if (this.tab === 'people') await this.people();
      else await this.settings();
    } catch (e) {
      this.shell(`<div class="auth-msg">${esc(e.message)}</div>`);
    }
  }

  // ---------- schools ----------
  async schools() {
    const a = this.app;
    const orgs = await cloud.listOrgs();
    this.shell(`
      <div class="ad-head"><h2>Schools (${orgs.length})</h2><input id="ad-q" type="search" placeholder="Search schools…"/></div>
      <table class="pp-table ad-table"><thead><tr><th></th><th>School</th><th>Address</th><th>Verified</th><th></th></tr></thead><tbody>
      ${orgs.map((o) => `<tr data-slug="${esc(o.slug)}">
        <td><span class="gate-badge small" style="--org:${esc(/^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#3b8cff')}">${esc(o.short)}</span></td>
        <td><b>${esc(o.name)}</b><br/><span class="muted small">${esc(o.city || '')}</span></td>
        <td><a href="../org/${esc(o.slug)}/" target="_blank" rel="noopener"><code>/org/${esc(o.slug)}/</code></a></td>
        <td><input type="checkbox" data-verify ${o.verified ? 'checked' : ''}/></td>
        <td class="pp-actions"><button class="btn small" data-pw>Set password</button><button class="btn small" data-owner>Make owner…</button><button class="btn small danger" data-del>Delete</button></td>
      </tr>`).join('')}</tbody></table>`);
    this.el.querySelector('#ad-q').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      this.el.querySelectorAll('tbody tr').forEach((tr) => { tr.hidden = q && !tr.textContent.toLowerCase().includes(q); });
    };
    this.el.querySelectorAll('tbody tr').forEach((tr) => {
      const o = orgs.find((x) => x.slug === tr.dataset.slug);
      tr.querySelector('[data-verify]').onchange = async (e) => {
        try { await cloud.updateOrg(o.slug, { verified: e.target.checked }); a.toast(`${o.name} ${e.target.checked ? 'verified' : 'unverified'}`); } catch (err) { a.toast(err.message, 'error'); e.target.checked = !e.target.checked; }
      };
      tr.querySelector('[data-pw]').onclick = async () => {
        const pw = await a.askText(`New school password for ${o.name}`, 'At least 6 characters', 'Set password');
        if (!pw) return;
        try { await cloud.setOrgPassword(o.slug, pw); a.toast('School password set'); } catch (err) { a.toast(err.message, 'error'); }
      };
      tr.querySelector('[data-owner]').onclick = async () => {
        const who = await a.askText(`Owner of ${o.name}`, 'Email of an existing account', 'Make owner');
        if (!who) return;
        try {
          const { users } = await cloud.orgAdmin('list');
          const u = users.find((x) => (x.email || '').toLowerCase() === who.toLowerCase());
          if (!u) throw new Error('No account with that email. They need to sign up in the app first.');
          await cloud.orgAdmin('setOwner', { org: o.slug, userId: u.id, displayName: u.name || null });
          a.toast(`${who} now owns ${o.name}`);
        } catch (err) { a.toast(err.message, 'error'); }
      };
      tr.querySelector('[data-del]').onclick = async () => {
        if (!(await a.confirm(`Delete ${o.name}?`, 'This removes the school, its people list and its classes. Accounts with usernames stop working.', 'Delete school'))) return;
        try { await cloud.deleteOrg(o.slug); this.render(); } catch (err) { a.toast(err.message, 'error'); }
      };
    });
  }

  // ---------- every account ----------
  async people() {
    const a = this.app;
    const [{ users }, orgs] = await Promise.all([cloud.orgAdmin('list'), cloud.listOrgs()]);
    this.shell(`
      <div class="ad-head"><h2>People (${users.length})</h2><input id="ad-q" type="search" placeholder="Search name, email, username or school…"/></div>
      <details class="cl-add"><summary>${icon('plus')} Add a person to a school</summary>
        <form class="pp-form">
          <label>School<select id="ad-org">${orgs.map((o) => `<option value="${esc(o.slug)}">${esc(o.name)}</option>`).join('')}</select></label>
          <label>Name<input id="ad-name" maxlength="80"/></label>
          <label>Username<input id="ad-user" maxlength="31" autocomplete="off"/></label>
          <label>Password<input id="ad-pass" maxlength="72" autocomplete="new-password"/></label>
          <label>Role<select id="ad-role"><option value="student">Student</option><option value="teacher">Teacher</option><option value="owner">Owner</option></select></label>
          <button class="btn primary" type="submit">Add</button>
        </form><div class="auth-msg" hidden></div></details>
      <table class="pp-table ad-table"><thead><tr><th>Name</th><th>Sign-in</th><th>Schools</th><th>Joined</th><th>Last sign-in</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr data-id="${u.id}">
        <td>${esc(u.name || '—')}</td>
        <td>${usernameOf(u.email) ? `<code>${esc(usernameOf(u.email))}</code>` : esc(u.email)}${u.confirmed ? '' : ' <span class="cl-pill late">unconfirmed</span>'}</td>
        <td>${u.orgs.map((m) => `<span class="cl-pill todo">${esc(m.org)} · ${roleLabel(m.role)}</span>`).join(' ') || '<span class="muted">—</span>'}</td>
        <td>${day(u.created_at)}</td><td>${day(u.last_sign_in_at)}</td>
        <td class="pp-actions">${u.orgs.length ? '<button class="btn small" data-pw>Reset password</button>' : ''}${u.id !== a.user.id ? '<button class="btn small danger" data-del>Delete</button>' : ''}</td>
      </tr>`).join('')}</tbody></table>`);
    const msg = this.el.querySelector('.auth-msg');
    this.el.querySelector('#ad-q').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      this.el.querySelectorAll('tbody tr').forEach((tr) => { tr.hidden = q && !tr.textContent.toLowerCase().includes(q); });
    };
    this.el.querySelector('.pp-form').onsubmit = async (e) => {
      e.preventDefault();
      const v = (id) => this.el.querySelector(id).value.trim();
      try {
        await cloud.orgAdmin('create', { org: v('#ad-org'), displayName: v('#ad-name'), username: v('#ad-user').toLowerCase(), password: v('#ad-pass'), role: v('#ad-role') });
        a.toast('Added');
        this.render();
      } catch (err) { msg.hidden = false; msg.textContent = err.message; }
    };
    this.el.querySelectorAll('tbody tr').forEach((tr) => {
      const u = users.find((x) => x.id === tr.dataset.id);
      tr.querySelector('[data-pw]')?.addEventListener('click', async () => {
        const pw = await a.askText(`New password for ${u.name || u.email}`, 'At least 6 characters', 'Set password');
        if (!pw) return;
        try { await cloud.orgAdmin('update', { org: u.orgs[0].org, userId: u.id, password: pw }); a.toast('Password changed'); } catch (err) { a.toast(err.message, 'error'); }
      });
      tr.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await a.confirm(`Delete ${u.name || u.email}?`, 'Their account, designs and school memberships are deleted for good.', 'Delete account'))) return;
        try { await cloud.orgAdmin('deleteAccount', { userId: u.id }); this.render(); } catch (err) { a.toast(err.message, 'error'); }
      });
    });
  }

  // ---------- settings ----------
  async settings() {
    const a = this.app;
    this.shell(`
      <h2>Settings</h2>
      <section class="ad-card">
        <h3>School creation code</h3>
        <p class="muted">Teachers need this code to add a new school. It keeps working until you change it. It’s stored scrambled, so you can’t view it again here: write it down.</p>
        <form class="share-row" id="ad-code-form"><input id="ad-code" placeholder="New creation code (at least 6 characters)" autocomplete="off"/><button class="btn primary" type="submit">Save code</button></form>
      </section>
      <section class="ad-card">
        <h3>Useful links</h3>
        <p><a href="../org/" target="_blank" rel="noopener">School directory</a> · <a href="../app/" target="_blank" rel="noopener">Main app</a> · <a href="https://supabase.com/dashboard/project/lfplpizvmcgvvvvpgomv" target="_blank" rel="noopener">Supabase dashboard</a></p>
      </section>`);
    this.el.querySelector('#ad-code-form').onsubmit = async (e) => {
      e.preventDefault();
      const code = this.el.querySelector('#ad-code').value.trim();
      try { await cloud.setCreationCode(code); a.toast('Creation code saved'); this.el.querySelector('#ad-code').value = ''; } catch (err) { a.toast(err.message, 'error'); }
    };
  }
}
