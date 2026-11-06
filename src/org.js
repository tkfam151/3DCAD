// Organisation / school spaces: the same app served at /org/<slug>/.
import ORGS from './orgs.json' with { type: 'json' };

export const orgs = ORGS;

/**
 * Which page this is:
 *   /3DCAD/admin/                 -> { mode: 'admin' }
 *   /3DCAD/org/<slug>/student/    -> { mode: 'student', slug }
 *   /3DCAD/org/<slug>/            -> { mode: 'staff', slug }
 *   anything else                 -> { mode: 'normal' }
 */
export function pageMode(pathname = typeof location !== 'undefined' ? location.pathname : '') {
  if (/\/admin\/?($|index\.html$)/i.test(pathname)) return { mode: 'admin' };
  const m = pathname.match(/\/org\/([a-z0-9-]+)(\/student)?\/?/i);
  if (m) return { mode: m[2] ? 'student' : 'staff', slug: m[1].toLowerCase() };
  return { mode: 'normal' };
}

/** Sign-in name for a school account: "tonkla" at "sisb" -> tonkla@sisb.opencad.invalid */
export function usernameEmail(username, slug) {
  return `${String(username).trim().toLowerCase()}@${slug}.opencad.invalid`;
}

/** The username shown for a school account, or null for a normal email account. */
export function usernameOf(email) {
  const m = String(email || '').match(/^([^@]+)@([a-z0-9-]+)\.opencad\.invalid$/);
  return m ? m[1] : null;
}

/** The school slug in the URL (/org/<slug>/), or null. */
export function orgSlugFromPath() {
  const m = (typeof location !== 'undefined' ? location.pathname : '').match(/\/org\/([a-z0-9-]+)\/?/i);
  return m ? m[1].toLowerCase() : null;
}

/** A built-in school for this page, or null (registered schools are looked up in the cloud). */
export function currentOrg() {
  const slug = orgSlugFromPath();
  return slug ? ORGS.find((o) => o.slug === slug) || null : null;
}

/** Turn a school name into a web address part: "Singapore Intl School" -> "singapore-intl-school". */
export function slugify(name) {
  const full = String(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (full.length <= 40) return full;
  const cut = full.slice(0, 40);
  // don't stop in the middle of a word
  return full[40] === '-' ? cut : cut.slice(0, Math.max(cut.lastIndexOf('-'), 2));
}
