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
  let q = sb().from('designs').select('id, name, thumb, updated_at');
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
