// Sign-in and cloud saving with Supabase.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './cloud-config.js';

const url = import.meta.env?.VITE_SUPABASE_URL || SUPABASE_URL;
const key = import.meta.env?.VITE_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;

// Where the email confirmation / password reset link sends people.
const WEB_APP_URL = 'https://tkfam151.github.io/3DCAD/app/';

let client = null;

export const cloudConfigured = () => !!(url && key);

function sb() {
  if (!cloudConfigured()) throw new Error('Cloud saving is not set up in this build.');
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: location.protocol.startsWith('http') },
    });
  }
  return client;
}

function friendly(error) {
  const m = error?.message || String(error);
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first — check your inbox for the link.';
  if (/user already registered/i.test(m)) return 'There is already an account with that email. Try signing in.';
  if (/password should be at least/i.test(m)) return 'Use a password with at least 6 characters.';
  if (/failed to fetch|network/i.test(m)) return 'Can’t reach the cloud. Check your internet connection.';
  if (/rate limit/i.test(m)) return 'Too many tries. Please wait a minute and try again.';
  if (/column .*org.* (does not exist|of 'designs')|Could not find the 'org' column/i.test(m)) {
    return 'The school space needs a database update: the app owner needs to run supabase/migrations/20261104090000_designs_org.sql in the Supabase SQL Editor (see the README).';
  }
  if (/(orgs|classes|class_members|assignments|submissions|join_class|shared).*(schema cache|does not exist)|function public\.join_class|column .*shared/i.test(m)) {
    return 'Schools, classes and share links need a database update: the app owner needs to run supabase/migrations/20261105090000_schools_classes.sql in the Supabase SQL Editor (see the README).';
  }
  if (/schema cache|relation .*designs.* does not exist|PGRST205|42P01/i.test(m) || error?.code === 'PGRST205' || error?.code === '42P01') {
    return 'The cloud database isn’t set up yet: the “designs” table is missing. The app owner needs to run supabase/migrations/20261103090000_designs.sql in the Supabase SQL Editor (see the README).';
  }
  return m;
}

async function run(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(friendly(error));
  return data;
}

export async function currentUser() {
  if (!cloudConfigured()) return null;
  const { data } = await sb().auth.getSession();
  return data.session?.user || null;
}

export function onAuthChange(cb) {
  if (!cloudConfigured()) return () => {};
  const { data } = sb().auth.onAuthStateChange((_event, session) => cb(session?.user || null));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email, password) {
  return (await run(sb().auth.signInWithPassword({ email, password }))).user;
}

/** Returns { user, needsConfirmation }. */
export async function signUp(email, password) {
  const data = await run(sb().auth.signUp({ email, password, options: { emailRedirectTo: WEB_APP_URL } }));
  return { user: data.user, needsConfirmation: !data.session };
}

/** Name and class shown in the app, stored on the account (user_metadata). */
export async function updateProfile({ fullName, className }) {
  const data = await run(sb().auth.updateUser({ data: { full_name: fullName, class_name: className || '' } }));
  return data.user;
}

export function profileOf(user) {
  const md = user?.user_metadata || {};
  return { fullName: md.full_name || '', className: md.class_name || '' };
}

export async function sendPasswordReset(email) {
  await run(sb().auth.resetPasswordForEmail(email, { redirectTo: WEB_APP_URL }));
}

export async function signOut() {
  await run(sb().auth.signOut());
}

/** The user's designs; in a school space only that school's designs. */
export async function listDesigns(org = null) {
  const me = await currentUser();
  if (!me) return [];
  // shared designs from other people are readable too, so always filter to your own
  let q = sb().from('designs').select('id, name, thumb, updated_at, shared').eq('user_id', me.id);
  if (org) q = q.eq('org', org);
  return run(q.order('updated_at', { ascending: false }).limit(60));
}

export async function loadDesign(id) {
  return run(sb().from('designs').select('id, name, doc').eq('id', id).single());
}

/** Create or update a design. Returns the saved row (id, name, updated_at). */
export async function saveDesign({ id, name, doc, thumb, org = null }) {
  const row = { name: name || 'Untitled', doc, thumb: thumb || null };
  if (org) row.org = org; // only school spaces need the org column
  if (id) {
    const rows = await run(sb().from('designs').update(row).eq('id', id).select('id, name, updated_at'));
    if (rows.length) return rows[0];
    // the row is gone (deleted elsewhere): save as a new one
  }
  return run(sb().from('designs').insert(row).select('id, name, updated_at').single());
}

export async function deleteDesign(id) {
  await run(sb().from('designs').delete().eq('id', id));
}

// ---------- share links ----------

export async function setShared(id, shared) {
  return run(sb().from('designs').update({ shared }).eq('id', id).select('id, shared').single());
}

/** Load a design someone shared (works signed out). */
export async function loadSharedDesign(id) {
  return run(sb().from('designs').select('id, name, doc, updated_at').eq('id', id).eq('shared', true).single());
}

// ---------- school directory ----------

export async function listOrgs() {
  return run(sb().from('orgs').select('slug, name, short, city, color, verified, created_by').order('name'));
}

export async function getOrg(slug) {
  const rows = await run(sb().from('orgs').select('slug, name, short, city, color, verified, created_by').eq('slug', slug).limit(1));
  return rows[0] || null;
}

/** Create a school with the creation code from the site admin; you become its owner. */
export async function createOrg({ slug, name, short, city, color, password, code }) {
  return run(sb().rpc('create_org', { p_slug: slug, p_name: name, p_short: short, p_city: city || '', p_color: color, p_password: password, p_code: code }));
}

export async function checkOrgPassword(slug, password) {
  return run(sb().rpc('check_org_password', { p_slug: slug, p_password: password }));
}

export async function setOrgPassword(slug, password) {
  await run(sb().rpc('set_org_password', { p_slug: slug, p_password: password }));
}

export async function setCreationCode(code) {
  await run(sb().rpc('set_creation_code', { p_code: code }));
}

/** { admin: bool, orgs: [{ org, role, username, display_name }] } for the signed-in user. */
export async function whoami() {
  if (!(await currentUser())) return { admin: false, orgs: [] };
  return run(sb().rpc('whoami'));
}

export async function deleteOrg(slug) {
  await run(sb().from('orgs').delete().eq('slug', slug));
}

/**
 * Account manager (the org-admin Edge Function, which keeps the secret key on Supabase).
 * action: list | create | update | remove | deleteAccount | setOwner
 */
export async function orgAdmin(action, payload = {}) {
  const { data, error } = await sb().functions.invoke('org-admin', { body: { action, ...payload } });
  if (error) {
    let msg = error.message;
    try { const body = await error.context?.json?.(); if (body?.error) msg = body.error; } catch { /* keep msg */ }
    if (/failed to send|not found|404|FunctionsFetchError|FunctionsRelayError/i.test(msg)) {
      msg = 'The account manager isn’t set up yet. The app owner needs to deploy the org-admin function (see the README).';
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function updateOrg(slug, patch) {
  return run(sb().from('orgs').update(patch).eq('slug', slug).select().single());
}

// ---------- classes, assignments, submissions ----------

export async function myClasses(org = null) {
  const me = await currentUser();
  if (!me) return { teaching: [], joined: [] };
  let q = sb().from('classes').select('id, org, name, teacher_id, teacher_name, join_code, created_at').order('created_at', { ascending: false });
  if (org) q = q.eq('org', org);
  const rows = await run(q);
  return { teaching: rows.filter((c) => c.teacher_id === me.id), joined: rows.filter((c) => c.teacher_id !== me.id) };
}

export async function createClass({ name, org, teacherName }) {
  return run(sb().from('classes').insert({ name, org: org || null, teacher_name: teacherName || null }).select().single());
}

export async function deleteClass(id) {
  await run(sb().from('classes').delete().eq('id', id));
}

export async function joinClass(code, displayName) {
  return run(sb().rpc('join_class', { code, display_name: displayName || null }));
}

export async function leaveClass(classId) {
  const me = await currentUser();
  await run(sb().from('class_members').delete().eq('class_id', classId).eq('user_id', me.id));
}

export async function classMembers(classId) {
  return run(sb().from('class_members').select('user_id, display_name, joined_at').eq('class_id', classId).order('display_name'));
}

export async function listAssignments(classId) {
  return run(sb().from('assignments').select('id, class_id, title, instructions, due_at, created_at').eq('class_id', classId).order('due_at', { ascending: true, nullsFirst: false }));
}

export async function createAssignment({ classId, title, instructions, dueAt }) {
  return run(sb().from('assignments').insert({ class_id: classId, title, instructions: instructions || null, due_at: dueAt || null }).select().single());
}

export async function deleteAssignment(id) {
  await run(sb().from('assignments').delete().eq('id', id));
}

/** Submissions for an assignment: a teacher sees all, a student sees their own. */
export async function listSubmissions(assignmentId) {
  return run(sb().from('submissions').select('id, assignment_id, student_id, student_name, name, thumb, submitted_at, feedback, grade, reviewed_at').eq('assignment_id', assignmentId).order('submitted_at', { ascending: false }));
}

export async function mySubmissions() {
  const me = await currentUser();
  if (!me) return [];
  return run(sb().from('submissions').select('id, assignment_id, name, submitted_at, feedback, grade, reviewed_at').eq('student_id', me.id));
}

export async function loadSubmission(id) {
  return run(sb().from('submissions').select('id, assignment_id, student_name, name, doc, submitted_at, feedback, grade').eq('id', id).single());
}

/** Hand in (or replace) your work for an assignment. */
export async function submitWork({ assignmentId, name, doc, thumb, studentName }) {
  const me = await currentUser();
  const existing = await run(sb().from('submissions').select('id').eq('assignment_id', assignmentId).eq('student_id', me.id).limit(1));
  const row = { name: name || 'Design', doc, thumb: thumb || null, student_name: studentName || null };
  if (existing.length) return run(sb().from('submissions').update(row).eq('id', existing[0].id).select('id, submitted_at').single());
  return run(sb().from('submissions').insert({ ...row, assignment_id: assignmentId }).select('id, submitted_at').single());
}

export async function reviewSubmission(id, { feedback, grade }) {
  return run(sb().from('submissions').update({ feedback: feedback || null, grade: grade || null }).eq('id', id).select('id, reviewed_at').single());
}

// ---------- assigning students and sharing with a class ----------

export async function assignToClass(classId, userId, displayName) {
  await run(sb().from('class_members').insert({ class_id: classId, user_id: userId, display_name: displayName || null }));
}

export async function removeFromClass(classId, userId) {
  await run(sb().from('class_members').delete().eq('class_id', classId).eq('user_id', userId));
}

/** People in a school (staff see everyone; RLS limits what others get). */
export async function orgMembers(org) {
  return run(sb().from('org_members').select('user_id, role, username, display_name').eq('org', org).order('display_name'));
}

export async function setSharedClass(designId, classId) {
  return run(sb().from('designs').update({ shared_class: classId || null }).eq('id', designId).select('id, shared_class').single());
}

/** Designs that classmates shared with a class. */
export async function classGallery(classId) {
  return run(sb().from('designs').select('id, name, thumb, updated_at, user_id').eq('shared_class', classId).order('updated_at', { ascending: false }).limit(60));
}

export async function loadDesignById(id) {
  return run(sb().from('designs').select('id, name, doc, user_id').eq('id', id).single());
}
