// OpenCAD Studio: account management for school owners and the site admin.
// Runs on Supabase (Deno). The service role key stays here, never in the website.
//
// POST JSON { action, ... } with the caller's access token in Authorization: Bearer <jwt>.
//   list         { org? }                                   owner of org, or admin (no org = every user)
//   create       { org, username, password, role, displayName, email? }
//   update       { org, userId, password?, role?, displayName? }
//   remove       { org, userId }                            removes from the school (admin: deleteAccount)
//   deleteAccount{ userId }                                 admin only
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const ADMIN_EMAIL = 'tonklapc.toogle@gmail.com';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (message: string, status = 400) => json({ error: message }, status);

// usernames become an address on the reserved .invalid domain, so no email is ever sent anywhere
export const usernameEmail = (username: string, org: string) => `${username}@${org}.opencad.invalid`;
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,30}$/;
const ROLES = ['owner', 'teacher', 'student'];

// Supabase gives functions the project keys. Newer projects use sb_secret_/sb_publishable_ keys
// (SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS, JSON by name); older ones the legacy JWT keys.
const pickKey = (jsonVar: string, legacyVar: string) => {
  try {
    const all = JSON.parse(Deno.env.get(jsonVar) || '{}');
    const k = all.default || Object.values(all)[0];
    if (typeof k === 'string' && k) return k;
  } catch { /* not set */ }
  return Deno.env.get(legacyVar) || '';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Use POST', 405);
  try {
    return await handle(req);
  } catch (e) {
    return fail('Account manager error: ' + ((e as Error)?.message || String(e)), 500);
  }
});

async function handle(req: Request): Promise<Response> {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const secret = pickKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  const publishable = pickKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  if (!url || !secret) return fail('The function has no Supabase secret key. Redeploy it from the Supabase dashboard.', 500);
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, secret, opts);

  // who is calling? (try the admin client, then the caller's own token as a normal client)
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token || token === publishable) return fail('Please sign in first.', 401);
  let caller = (await admin.auth.getUser(token)).data?.user ?? null;
  if (!caller && publishable) {
    const asUser = createClient(url, publishable, { ...opts, global: { headers: { Authorization: authHeader } } });
    caller = (await asUser.auth.getUser()).data?.user ?? null;
  }
  if (!caller) return fail('Please sign out and sign in again.', 401);
  const email = (caller.email || '').toLowerCase();
  const isAdmin = email === ADMIN_EMAIL && !!(caller.email_confirmed_at || (caller as any).confirmed_at);
  if (email === ADMIN_EMAIL && !isAdmin) return fail('Please confirm your email first (check your inbox for the Supabase link).', 403);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return fail('Bad request'); }
  const org = typeof body.org === 'string' ? body.org : null;

  const roleIn = async (o: string, uid: string) => {
    const { data } = await admin.from('org_members').select('role').eq('org', o).eq('user_id', uid).maybeSingle();
    return data?.role as string | undefined;
  };
  const isOwner = async (o: string) => isAdmin || (await roleIn(o, caller.id)) === 'owner';

  try {
    switch (body.action) {
      case 'list': {
        if (org) {
          if (!(await isOwner(org))) return fail('Only the school owner can manage people.', 403);
          const { data, error } = await admin.from('org_members').select('user_id, role, username, display_name, created_at').eq('org', org).order('role').order('display_name');
          if (error) throw error;
          return json({ people: data });
        }
        if (!isAdmin) return fail('Only the site admin can see every account.', 403);
        const { data, error } = await admin.auth.admin.listUsers({ page: Number(body.page) || 1, perPage: 200 });
        if (error) throw error;
        const ids = data.users.map((u) => u.id);
        const { data: memberships } = await admin.from('org_members').select('org, user_id, role, username').in('user_id', ids);
        return json({
          users: data.users.map((u) => ({
            id: u.id, email: u.email, confirmed: !!u.email_confirmed_at, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
            name: u.user_metadata?.full_name || '', orgs: (memberships || []).filter((m) => m.user_id === u.id),
          })),
        });
      }

      case 'create': {
        if (!org) return fail('Choose a school.');
        if (!(await isOwner(org))) return fail('Only the school owner can add people.', 403);
        const role = String(body.role || 'student');
        if (!ROLES.includes(role) || (role === 'owner' && !isAdmin)) return fail('Role must be teacher or student.');
        const username = String(body.username || '').trim().toLowerCase();
        if (!USERNAME.test(username)) return fail('Usernames use 2–31 lowercase letters, numbers, dots, dashes or underscores.');
        const password = String(body.password || '');
        if (password.length < 6) return fail('Use a password with at least 6 characters.');
        const displayName = String(body.displayName || username).slice(0, 80);
        const email = body.email && isAdmin ? String(body.email).trim().toLowerCase() : usernameEmail(username, org);
        const { data: taken } = await admin.from('org_members').select('user_id').eq('org', org).eq('username', username).maybeSingle();
        if (taken) return fail(`The username “${username}” is already used in this school.`);
        const { data: made, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name: displayName, username, org },
        });
        if (error) throw error;
        const { error: mErr } = await admin.from('org_members').insert({ org, user_id: made.user.id, role, username, display_name: displayName });
        if (mErr) { await admin.auth.admin.deleteUser(made.user.id); throw mErr; }
        return json({ user: { user_id: made.user.id, role, username, display_name: displayName } });
      }

      case 'update': {
        if (!org || !body.userId) return fail('Missing school or person.');
        if (!(await isOwner(org))) return fail('Only the school owner can change accounts.', 403);
        const targetRole = await roleIn(org, body.userId);
        if (!targetRole) return fail('That person is not in this school.', 404);
        if (targetRole === 'owner' && !isAdmin && body.userId !== caller.id) return fail('Only the site admin can change another owner.', 403);
        const patch: Record<string, unknown> = {};
        if (body.password) {
          if (String(body.password).length < 6) return fail('Use a password with at least 6 characters.');
          patch.password = String(body.password);
        }
        if (body.displayName) patch.user_metadata = { full_name: String(body.displayName).slice(0, 80) };
        if (Object.keys(patch).length) {
          const { error } = await admin.auth.admin.updateUserById(body.userId, patch);
          if (error) throw error;
        }
        const row: Record<string, unknown> = {};
        if (body.displayName) row.display_name = String(body.displayName).slice(0, 80);
        if (body.role) {
          if (!ROLES.includes(body.role) || (body.role === 'owner' && !isAdmin)) return fail('Role must be teacher or student.');
          row.role = body.role;
        }
        if (Object.keys(row).length) {
          const { error } = await admin.from('org_members').update(row).eq('org', org).eq('user_id', body.userId);
          if (error) throw error;
        }
        return json({ ok: true });
      }

      case 'remove': {
        if (!org || !body.userId) return fail('Missing school or person.');
        if (!(await isOwner(org))) return fail('Only the school owner can remove people.', 403);
        if (body.userId === caller.id) return fail('You can’t remove yourself.');
        const targetRole = await roleIn(org, body.userId);
        if (targetRole === 'owner' && !isAdmin) return fail('Only the site admin can remove an owner.', 403);
        const { data: target } = await admin.auth.admin.getUserById(body.userId);
        await admin.from('org_members').delete().eq('org', org).eq('user_id', body.userId);
        // accounts made for this school (username logins) are deleted completely
        if (target?.user?.email?.endsWith(`@${org}.opencad.invalid`)) await admin.auth.admin.deleteUser(body.userId);
        return json({ ok: true });
      }

      case 'deleteAccount': {
        if (!isAdmin) return fail('Only the site admin can delete accounts.', 403);
        if (body.userId === caller.id) return fail('You can’t delete your own admin account.');
        const { error } = await admin.auth.admin.deleteUser(String(body.userId));
        if (error) throw error;
        return json({ ok: true });
      }

      case 'setOwner': {
        // admin: make an existing account (by email or username@org) the owner of a school
        if (!isAdmin) return fail('Only the site admin can do this.', 403);
        if (!org || !body.userId) return fail('Missing school or person.');
        const { error } = await admin.from('org_members').upsert({ org, user_id: body.userId, role: 'owner', display_name: body.displayName || null });
        if (error) throw error;
        return json({ ok: true });
      }

      default:
        return fail('Unknown action');
    }
  } catch (e) {
    return fail((e as Error).message || 'Something went wrong');
  }
}
