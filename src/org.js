// Organisation / school spaces: the same app served at /org/<slug>/.
import ORGS from './orgs.json';

export const orgs = ORGS;

/** The school this page belongs to (from the URL /org/<slug>/), or null. */
export function currentOrg() {
  const m = (typeof location !== 'undefined' ? location.pathname : '').match(/\/org\/([a-z0-9-]+)\/?/i);
  if (!m) return null;
  return ORGS.find((o) => o.slug === m[1].toLowerCase()) || null;
}
