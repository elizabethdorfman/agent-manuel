// State identity. Two screens are the same state when they show the same headings, the same
// set of controls and the same dialog on the same normalized path. Counters, ids and repeated
// list rows are normalized away so equivalent states collapse to one key and lists or
// counters can't spawn endless "new" states.
import { createHash } from 'node:crypto';

const ID_SEGMENT = /^(\d+|[0-9a-f]{8,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{20,})$/i;

export function normalizePath(url) {
  let u;
  try { u = new URL(url); } catch { return String(url); }
  const parts = u.pathname.split('/').map(seg => (seg && ID_SEGMENT.test(seg) && /\d/.test(seg) ? ':id' : seg));
  let path = parts.join('/') || '/';
  if (u.protocol === 'file:') path = path.replace(/^.*\//, '/'); // file runs: the file name is the route
  return path.replace(/\/index\.html$/, '/').replace(/(.)\/$/, '$1');
}

export function normalizeText(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/\d+([.,]\d+)*/g, '#')
    .replace(/\s+/g, ' ').trim();
}

/**
 * snapshot: { url, headings:[string], controls:[{role,name}], dialog: string|null }
 * Returns { key, signature } where signature is the readable input to the hash.
 */
export function stateKey(snapshot) {
  const headings = snapshot.headings.map(normalizeText).filter(Boolean);
  const controls = [...new Set(snapshot.controls.map(c => `${c.role}:${normalizeText(c.name)}`))].sort();
  const signature = {
    path: normalizePath(snapshot.url),
    headings,
    controls,
    dialog: snapshot.dialog ? normalizeText(snapshot.dialog) || 'dialog' : null,
  };
  const key = createHash('sha256').update(JSON.stringify(signature)).digest('hex').slice(0, 12);
  return { key, signature };
}

/** Readable label for a state, used in progress lines and the report. */
export function stateLabel(snapshot) {
  const h = snapshot.headings.find(Boolean);
  const path = normalizePath(snapshot.url);
  return (snapshot.dialog ? `[${snapshot.dialog}] ` : '') + (h ? `${h} (${path})` : path);
}
