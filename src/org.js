// Organisation / school spaces: the same app served at /org/<slug>/.
import ORGS from './orgs.json';

export const orgs = ORGS;

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
  return String(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
