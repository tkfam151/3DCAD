// Classes window: teachers create classes and assignments and review work;
// students join with a code, see assignments and hand in their design.
import * as cloud from './cloud.js';
import { icon } from './ui/icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const when = (t) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const dueText = (t) => {
  if (!t) return 'No due date';
  const ms = new Date(t) - Date.now();
  const days = Math.round(ms / 86400000);
  if (ms < 0) return `Was due ${when(t)}`;
  if (days === 0) return `Due today, ${new Date(t).toLocaleTimeString(undefined, { timeStyle: 'short' })}`;
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days (${new Date(t).toLocaleDateString()})`;
};

export class ClassesUI {
  constructor(app) {
    this.app = app;
  }

  async open(start = { view: 'list' }) {
    const a = this.app;
    if (!cloud.cloudConfigured()) return a.toast('Classes need cloud sign-in, which isn’t set up in this version.', 'error');
    if (!a.user) return a.showAuth({ reason: 'Sign in to join or run a class.', then: () => this.open(start) });
    this.m = a.modal({ title: `${icon('school')} Classes`, body: '<div class="cl"></div>', wide: true, buttons: [{ label: 'Close' }] });
    this.m.classList.add('classes-modal');
    this.body = this.m.querySelector('.cl');
    this.go(start);
  }


  async go(state) {
    this.state = state;
    this.body.innerHTML = '<p class="muted">Loading…</p>';
    try {
      if (state.view === 'list') await this.renderList();
      else if (state.view === 'class') await this.renderClass(state.cls);
      else if (state.view === 'assignment') await this.renderAssignment(state.cls, state.asg);
    } catch (e) {
      this.body.innerHTML = `<div class="auth-msg">${esc(e.message)}</div><button class="btn small" data-back>Back</button>`;
      this.body.querySelector('[data-back]').onclick = () => this.go({ view: 'list' });
    }
  }

  // ---------- all my classes ----------
  async renderList() {
    const a = this.app;
    const { teaching, joined } = await cloud.myClasses(a.org?.slug || null);
    const card = (c, role) => `<button class="cl-card" data-class="${c.id}" data-role="${role}">
        <b>${esc(c.name)}</b><span>${role === 'teacher' ? `You teach · code <code>${esc(c.join_code)}</code>` : `Teacher: ${esc(c.teacher_name || '—')}`}</span></button>`;
    this.body.innerHTML = `
      <div class="cl-cols">
        <section>
          <h3>${icon('user')} Join a class</h3>
          <form class="cl-join"><input id="cl-code" maxlength="8" placeholder="Code from your teacher, e.g. 7F3K2A" autocomplete="off"/><button class="btn primary" type="submit">Join</button></form>
          <div class="cl-msg auth-msg" hidden></div>
          ${joined.length ? `<div class="cl-list">${joined.map((c) => card(c, 'student')).join('')}</div>` : '<p class="muted small">Classes you join will appear here.</p>'}
        </section>
        <section>
          <h3>${icon('school')} Teach a class</h3>
          <form class="cl-new"><input id="cl-name" maxlength="80" placeholder="Class name, e.g. Year 9 Design" autocomplete="off"/><button class="btn" type="submit">Create</button></form>
          ${teaching.length ? `<div class="cl-list">${teaching.map((c) => card(c, 'teacher')).join('')}</div>` : '<p class="muted small">Create a class to get a join code for your students.</p>'}
        </section>
      </div>`;
    const msg = this.body.querySelector('.cl-msg');
    this.body.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    this.body.querySelector('.cl-join').onsubmit = async (e) => {
      e.preventDefault();
      const code = this.body.querySelector('#cl-code').value.trim();
      if (!code) return;
      try {
        const c = await cloud.joinClass(code, a.displayName());
        a.mascot.say(`You joined <b>${esc(c.name)}</b>! 🎒`, 'cheer', 4000);
        this.go({ view: 'class', cls: { ...c, role: 'student' } });
      } catch (err) { msg.hidden = false; msg.textContent = err.message; }
    };
    this.body.querySelector('.cl-new').onsubmit = async (e) => {
      e.preventDefault();
      const name = this.body.querySelector('#cl-name').value.trim();
      if (!name) return;
      try {
        const c = await cloud.createClass({ name, org: a.org?.slug, teacherName: a.displayName() });
        this.go({ view: 'class', cls: { ...c, role: 'teacher' } });
      } catch (err) { msg.hidden = false; msg.textContent = err.message; }
    };
    this.body.querySelectorAll('[data-class]').forEach((b) => {
      const c = [...teaching, ...joined].find((x) => x.id === b.dataset.class);
      b.onclick = () => this.go({ view: 'class', cls: { ...c, role: b.dataset.role } });
    });
  }

  // ---------- one class ----------
  async renderClass(cls) {
    const teacher = cls.role === 'teacher';
    const [assignments, mine] = await Promise.all([cloud.listAssignments(cls.id), teacher ? [] : cloud.mySubmissions()]);
    const members = teacher ? await cloud.classMembers(cls.id) : [];
    const status = (asg) => {
      if (teacher) return '';
      const s = mine.find((x) => x.assignment_id === asg.id);
      if (!s) return `<span class="cl-pill ${asg.due_at && new Date(asg.due_at) < Date.now() ? 'late' : 'todo'}">To do</span>`;
      if (s.grade || s.feedback) return `<span class="cl-pill done">Reviewed${s.grade ? ` · ${esc(s.grade)}` : ''}</span>`;
      return '<span class="cl-pill sent">Handed in</span>';
    };
    this.body.innerHTML = `
      <button class="link-btn" data-back>← All classes</button>
      <div class="cl-head"><h3>${esc(cls.name)}</h3>
        ${teacher ? `<div class="cl-code">Join code <code>${esc(cls.join_code)}</code> <button class="btn small" data-copy>Copy invite</button></div>` : `<span class="muted">Teacher: ${esc(cls.teacher_name || '—')}</span>`}
      </div>
      ${teacher ? `
        <details class="cl-add"><summary>${icon('plus')} New assignment</summary>
          <form class="cl-asg-form">
            <label>Title<input id="as-title" maxlength="120" placeholder="e.g. Design a phone stand"/></label>
            <label>Instructions<textarea id="as-ins" rows="3" maxlength="4000" placeholder="What should students make? Size limits, criteria…"></textarea></label>
            <label>Due<input id="as-due" type="datetime-local"/></label>
            <button class="btn primary" type="submit">Post assignment</button>
          </form>
        </details>` : ''}
      <h4>Assignments</h4>
      ${assignments.length ? `<div class="cl-list">${assignments.map((x) => `
        <button class="cl-card" data-asg="${x.id}"><b>${esc(x.title)}</b><span>${esc(dueText(x.due_at))}</span>${status(x)}</button>`).join('')}</div>`
        : `<p class="muted small">${teacher ? 'Post the first assignment above.' : 'No assignments yet.'}</p>`}
      ${teacher ? `<h4>Students (${members.length})</h4>${members.length ? `<div class="cl-members">${members.map((m) => `<span>${esc(m.display_name || 'Student')}</span>`).join('')}</div>` : '<p class="muted small">Share the join code with your class.</p>'}
        <p><button class="btn small danger" data-del>Delete class</button></p>`
        : '<p><button class="btn small" data-leave>Leave class</button></p>'}`;
    this.body.querySelectorAll('input, textarea').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    this.body.querySelector('[data-back]').onclick = () => this.go({ view: 'list' });
    this.body.querySelector('[data-copy]')?.addEventListener('click', async () => {
      const link = this.app.webLink(`#join=${cls.join_code}`);
      const text = `Join my OpenCAD class “${cls.name}”: open ${link} or enter code ${cls.join_code} under Classes.`;
      try { await navigator.clipboard.writeText(text); this.app.toast('Invite copied. Paste it to your class.'); } catch { this.app.toast(`Code: ${cls.join_code}`); }
    });
    this.body.querySelector('.cl-asg-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = this.body.querySelector('#as-title').value.trim();
      if (!title) return this.app.toast('Give the assignment a title.', 'error');
      const due = this.body.querySelector('#as-due').value;
      await cloud.createAssignment({ classId: cls.id, title, instructions: this.body.querySelector('#as-ins').value.trim(), dueAt: due ? new Date(due).toISOString() : null });
      this.go({ view: 'class', cls });
    });
    this.body.querySelectorAll('[data-asg]').forEach((b) => {
      b.onclick = () => this.go({ view: 'assignment', cls, asg: assignments.find((x) => x.id === b.dataset.asg) });
    });
    this.body.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await this.app.confirm(`Delete “${cls.name}”?`, 'This removes the class, its assignments and all submissions. It can’t be undone.', 'Delete'))) return;
      await cloud.deleteClass(cls.id);
      this.go({ view: 'list' });
    });
    this.body.querySelector('[data-leave]')?.addEventListener('click', async () => {
      if (!(await this.app.confirm(`Leave “${cls.name}”?`, 'You can join again later with the code.', 'Leave'))) return;
      await cloud.leaveClass(cls.id);
      this.go({ view: 'list' });
    });
  }

  // ---------- one assignment ----------
  async renderAssignment(cls, asg) {
    const a = this.app;
    const teacher = cls.role === 'teacher';
    const subs = await cloud.listSubmissions(asg.id);
    const head = `
      <button class="link-btn" data-back>← ${esc(cls.name)}</button>
      <div class="cl-head"><h3>${esc(asg.title)}</h3><span class="muted">${esc(dueText(asg.due_at))}</span></div>
      ${asg.instructions ? `<div class="cl-ins">${esc(asg.instructions).replace(/\n/g, '<br/>')}</div>` : ''}`;
    if (teacher) {
      this.body.innerHTML = `${head}
        <h4>Submissions (${subs.length})</h4>
        ${subs.length ? `<div class="cl-subs">${subs.map((s) => `
          <div class="cl-sub" data-sub="${s.id}">
            <div class="cl-thumb">${s.thumb?.startsWith('data:image/') ? `<img src="${esc(s.thumb)}" alt=""/>` : icon('body')}</div>
            <div class="cl-sub-main">
              <b>${esc(s.student_name || 'Student')}</b><span class="muted small">${esc(s.name)} · ${esc(when(s.submitted_at))}${asg.due_at && new Date(s.submitted_at) > new Date(asg.due_at) ? ' · <span class="late-txt">late</span>' : ''}</span>
              <textarea rows="2" placeholder="Feedback for the student" data-fb>${esc(s.feedback || '')}</textarea>
              <div class="cl-sub-row"><input data-grade maxlength="20" placeholder="Grade (e.g. 6/8)" value="${esc(s.grade || '')}"/>
                <button class="btn small primary" data-save>Save feedback</button><button class="btn small" data-open>Open design</button></div>
            </div>
          </div>`).join('')}</div>` : '<p class="muted small">Nobody has handed in yet.</p>'}`;
      this.body.querySelectorAll('textarea, input').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
      this.body.querySelectorAll('[data-sub]').forEach((row) => {
        const id = row.dataset.sub;
        row.querySelector('[data-save]').onclick = async () => {
          await cloud.reviewSubmission(id, { feedback: row.querySelector('[data-fb]').value.trim(), grade: row.querySelector('[data-grade]').value.trim() });
          a.toast('Feedback saved');
        };
        row.querySelector('[data-open]').onclick = async () => {
          const s = await cloud.loadSubmission(id);
          this.m.closest('.modal-backdrop')?.remove();
          a.openViewOnly(s.doc, `${s.student_name || 'Student'} – ${s.name}`, `Viewing ${s.student_name || 'a student'}’s submission for “${asg.title}”`);
        };
      });
    } else {
      const s = subs[0];
      const hasDesign = a.doc.features.length && !a.landing.visible;
      this.body.innerHTML = `${head}
        ${s ? `<div class="cl-mine"><b>Handed in</b> “${esc(s.name)}” · ${esc(when(s.submitted_at))}
            ${s.grade || s.feedback ? `<div class="cl-feedback">${s.grade ? `<div class="cl-grade">${esc(s.grade)}</div>` : ''}${s.feedback ? `<p>${esc(s.feedback).replace(/\n/g, '<br/>')}</p>` : ''}</div>` : '<p class="muted small">Your teacher hasn’t reviewed it yet.</p>'}</div>` : ''}
        <div class="cl-submit">
          ${hasDesign
            ? `<p>Hand in <b>${esc(a.fileName)}</b>${s ? ' (replaces your earlier hand-in)' : ''}.</p><button class="btn primary" data-submit>${icon('handin')} Hand in this design</button>`
            : '<p class="muted">Open or make your design first, then come back here to hand it in.</p>'}
        </div>`;
      this.body.querySelector('[data-submit]')?.addEventListener('click', async (e) => {
        if (a.fileName === 'Untitled') {
          const n = await a.askName('', { title: 'Name your work', action: 'Hand in' });
          if (!n) return;
          a.fileName = n;
          a.renderBrowser();
        }
        e.target.disabled = true;
        let thumb = null;
        try { thumb = a.vp.thumbnail(320, 200); } catch { /* optional */ }
        try {
          await cloud.submitWork({ assignmentId: asg.id, name: a.fileName, doc: a.doc, thumb, studentName: a.displayName() });
          a.mascot.say(`Handed in to <b>${esc(cls.name)}</b>! 🎓`, 'cheer', 5000);
          this.go({ view: 'assignment', cls, asg });
        } catch (err) { a.toast(err.message, 'error'); e.target.disabled = false; }
      });
    }
    this.body.querySelector('[data-back]').onclick = () => this.go({ view: 'class', cls });
  }
}
