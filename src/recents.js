// Recently opened/saved designs, kept in localStorage.
// In the desktop app entries point at files on disk; in the browser we keep a
// copy of small .ocad designs so they can be reopened.

const KEY = 'opencad-recents-v1';
const MAX = 12;
const MAX_INLINE_DOC = 400_000;

export function getRecents() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list) {
  // drop thumbnails/inline docs from the oldest entries until it fits
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
      return;
    } catch {
      const victim = [...list].reverse().find((e) => e.thumb || e.doc);
      if (!victim) return;
      delete victim.thumb;
      delete victim.doc;
    }
  }
}

const sameEntry = (a, b) => (a.path && b.path ? a.path === b.path : !a.path && !b.path && a.name === b.name && a.kind === b.kind);

/** Add or refresh an entry and move it to the top. */
export function addRecent(entry) {
  const list = getRecents();
  const old = list.find((e) => sameEntry(e, entry));
  const merged = { id: old?.id || Math.random().toString(36).slice(2, 10), ...old, ...entry, t: Date.now() };
  if (merged.doc && JSON.stringify(merged.doc).length > MAX_INLINE_DOC) delete merged.doc;
  save([merged, ...list.filter((e) => e !== old)]);
  return merged;
}

export function removeRecent(id) {
  save(getRecents().filter((e) => e.id !== id));
}

export function clearRecents() {
  save([]);
}

export function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? 's' : ''} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(t).toLocaleDateString();
}
