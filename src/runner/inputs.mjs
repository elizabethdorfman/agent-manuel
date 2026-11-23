// Synthetic form filling. Each field is sorted into an input class from its type, autocomplete
// token and accessible name; the class picks the value. App configs override values per class
// through syntheticInputs. Every text value carries the QA-SYNTHETIC marker.
import { MARKER, withMarker } from './safety.mjs';

const today = () => new Date().toISOString().slice(0, 10);

export const DEFAULT_VALUES = {
  email: `qa+${MARKER}@example.invalid`,
  password: `${MARKER}-pass-4821`,
  name: `Quinn ${MARKER}`,
  phone: `+1 555 0100 ${MARKER}`,
  url: `https://example.invalid/${MARKER}`,
  search: `latte ${MARKER}`,
  story: `Bought a coffee for $4.50 and saved $20. ${MARKER}`,
  address: `1 Test Street ${MARKER}`,
  postal: `${MARKER}`,
  text: `Sample entry ${MARKER}`,
  // Numeric and date fields can't hold the marker; the marker rides along in the record's text fields.
  number: '12',
  date: today(),
};

/**
 * field: { inputType, autocomplete, name (accessible), placeholder, tag }
 * Returns one of the keys of DEFAULT_VALUES.
 */
export function inputClass(field) {
  const type = String(field.inputType ?? 'text').toLowerCase();
  const ac = String(field.autocomplete ?? '').toLowerCase();
  const hint = `${field.name ?? ''} ${field.placeholder ?? ''} ${field.htmlName ?? ''}`.toLowerCase();
  if (type === 'email' || /email/.test(ac) || /\be-?mail\b/.test(hint)) return 'email';
  if (type === 'password' || /password/.test(ac)) return 'password';
  if (type === 'number' || type === 'range') return 'number';
  if (['date', 'datetime-local', 'month', 'week', 'time'].includes(type)) return 'date';
  if (type === 'tel' || /^tel/.test(ac) || /\bphone\b/.test(hint)) return 'phone';
  if (type === 'url' || /\b(website|url)\b/.test(hint)) return 'url';
  if (type === 'search' || /\bsearch\b/.test(hint)) return 'search';
  if (/(^|\s)(name|given-name|family-name|nickname)/.test(ac) || /\b(your |full |first |last )?name\b/.test(hint)) return 'name';
  if (/postal|zip/.test(ac + hint)) return 'postal';
  if (/street|address/.test(ac + hint)) return 'address';
  if (field.tag === 'textarea' || type === 'textarea' || /\b(story|day|message|describe|about|note|comment|tell)\b/.test(hint)) return 'story';
  return 'text';
}

export function syntheticValue(field, overrides = {}) {
  const cls = inputClass(field);
  const raw = overrides[cls] ?? DEFAULT_VALUES[cls];
  const value = cls === 'number' || cls === 'date' ? String(raw).replace(/\s*QA-SYNTHETIC\s*/g, '') : withMarker(raw);
  return { cls, value };
}
