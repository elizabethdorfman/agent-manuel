// Safety layer. Every action the explorer takes goes through checkAction first, and every
// value it types goes through checkFill. These are pure functions so they can be unit-tested
// without a browser; the run loop calls them again right before acting, using the element's
// live context.

export const MARKER = 'QA-SYNTHETIC';

/** Contract defaults. They apply to every run, including a bare --url run. */
export const DEFAULT_SAFETY = Object.freeze({
  sameOriginOnly: true,
  denyActions: ['/publish|share|delete|pay|subscribe|upgrade|checkout|log ?out|sign ?out/i'],
  denySubmitForms: ['/sign ?up|create account|register/i'],
  blockRequests: ['*posthog*', '*stripe.com*', '*google-analytics*'],
  allowAiConsent: false,
});

// Names of buttons that accept a consent prompt (analytics, AI processing, cookies). With
// allowAiConsent false the runner declines them, so a QA bot never opts a guest in.
export const CONSENT_PATTERN = /^\s*(yes[,!.]?\s*)?(allow|accept|agree|i agree|i accept|opt in|ok(ay)?,? (allow|accept))(\s+(all|analytics|cookies|tracking|recordings?))?\s*[.!]?\s*$/i;

// Config keys that would make a session signed in or reuse a profile. Guest-only is not optional.
const SIGNED_IN_KEYS = ['userDataDir', 'profile', 'profileDir', 'cookies', 'storageState', 'credentials', 'auth', 'login', 'password', 'headers'];

/**
 * Turns a config pattern into a RegExp. "/body/flags" strings are regular expressions;
 * any other string is a literal, case-insensitive substring.
 */
export function toRegExp(pattern) {
  if (pattern instanceof RegExp) return pattern;
  if (typeof pattern !== 'string' || !pattern) throw new Error('Patterns must be non-empty strings: ' + JSON.stringify(pattern));
  const m = /^\/(.+)\/([dgimsuvy]*)$/s.exec(pattern);
  if (m) return new RegExp(m[1], m[2].replace(/[gy]/g, ''));
  return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

/** The glob semantics Chrome's Network.setBlockedURLs uses: * matches any run of characters. */
export function globToRegExp(glob) {
  return new RegExp('^' + glob.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
}

export function isBlockedRequest(url, blockRequests) {
  return blockRequests.some(g => globToRegExp(g).test(url));
}

/** Guarantees the marker is in a synthetic value, so stray data can be found and deleted. */
export function withMarker(value) {
  const s = String(value ?? '');
  return s.includes(MARKER) ? s : (s ? s + ' ' + MARKER : MARKER);
}

/**
 * Validates and fills in an app config. Throws on anything that would weaken safety.
 * Compiled patterns live under config.safety so the JSON-facing fields stay as written.
 */
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Config must be an object.');
  for (const k of SIGNED_IN_KEYS) if (k in raw) throw new Error(`Config key "${k}" is not allowed: runs are guest-only with a fresh profile.`);
  if (!raw.baseUrl) throw new Error('Config needs baseUrl.');
  const base = new URL(raw.baseUrl);
  if (!['http:', 'https:', 'file:'].includes(base.protocol)) throw new Error('baseUrl must be http(s) or file.');
  const cfg = {
    ...raw,
    baseUrl: base.href,
    entry: (raw.entry?.length ? raw.entry : [base.protocol === 'file:' ? base.href : '/']).map(e => String(e)),
    sameOriginOnly: raw.sameOriginOnly ?? DEFAULT_SAFETY.sameOriginOnly,
    denyActions: raw.denyActions ?? [...DEFAULT_SAFETY.denyActions],
    denySubmitForms: raw.denySubmitForms ?? [...DEFAULT_SAFETY.denySubmitForms],
    blockRequests: raw.blockRequests ?? [...DEFAULT_SAFETY.blockRequests],
    allowAiConsent: raw.allowAiConsent ?? DEFAULT_SAFETY.allowAiConsent,
    budget: { maxStates: 40, maxActions: 200, maxMinutes: 15, ...(raw.budget ?? {}) },
    viewports: (raw.viewports ?? [{ width: 390, height: 844 }, { width: 1280, height: 800 }]).map(v => ({ width: Number(v.width), height: Number(v.height) })),
    maxEdgeRepeats: raw.maxEdgeRepeats ?? 4,
    maxDepth: raw.maxDepth ?? 20,
    settleMs: raw.settleMs ?? 250,
    syntheticInputs: Object.fromEntries(Object.entries(raw.syntheticInputs ?? {}).map(([k, v]) => [k, withMarker(v)])),
  };
  if (cfg.sameOriginOnly !== true) throw new Error('sameOriginOnly must be true; the runner never leaves the app under test.');
  if (cfg.allowAiConsent !== false && cfg.allowAiConsent !== true) throw new Error('allowAiConsent must be a boolean.');
  for (const k of ['denyActions', 'denySubmitForms', 'blockRequests']) if (!Array.isArray(cfg[k])) throw new Error(k + ' must be an array.');
  for (const k of ['maxStates', 'maxActions', 'maxMinutes']) if (!(Number(cfg.budget[k]) > 0)) throw new Error(`budget.${k} must be a positive number.`);
  for (const v of cfg.viewports) if (!Number.isInteger(v.width) || !Number.isInteger(v.height) || v.width < 200 || v.height < 200) throw new Error('Viewports need integer width and height of at least 200.');
  for (const e of cfg.entry) if (!isAllowedUrl(new URL(e, base).href, cfg)) throw new Error('Entry is outside the app origin: ' + e);
  cfg.safety = {
    denyActions: cfg.denyActions.map(toRegExp),
    denySubmitForms: cfg.denySubmitForms.map(toRegExp),
    consent: (raw.consentPatterns ?? []).map(toRegExp).concat(CONSENT_PATTERN),
  };
  return cfg;
}

/** Same origin as baseUrl. For file: apps, the URL must sit inside baseUrl's directory. */
export function isAllowedUrl(url, cfg) {
  let u, base;
  try { u = new URL(url); base = new URL(cfg.baseUrl); } catch { return false; }
  if (u.protocol === 'about:' && u.href === 'about:blank') return true;
  if (base.protocol === 'file:') {
    if (u.protocol !== 'file:') return false;
    const dir = base.pathname.endsWith('/') ? base.pathname : base.pathname.replace(/[^/]*$/, '');
    return decodeURIComponent(u.pathname).startsWith(decodeURIComponent(dir));
  }
  return u.origin === base.origin;
}

const firstMatch = (regexps, texts) => {
  for (const re of regexps) for (const t of texts) if (t && re.test(t)) return { re, text: t };
};
const clip = s => (s.length > 60 ? s.slice(0, 57) + '…' : s);

/**
 * Decides whether one action may run.
 * action: { kind:'click'|'select'|'back'|'reload', role, name, href?, target?, download?,
 *           inputType?, isSubmit?, form?: { name, heading, action, submitLabels:[] } }
 * Returns { allowed:true } or { allowed:false, rule, reason }.
 */
export function checkAction(action, cfg, currentUrl = cfg.baseUrl) {
  const s = cfg.safety ?? normalizeConfig(cfg).safety;
  if (action.kind === 'back' || action.kind === 'reload') return { allowed: true };
  const name = String(action.name ?? '').trim();

  if (action.inputType === 'file') return deny('file-upload', 'opens a file picker; uploads are out of scope');
  if (action.download != null && action.download !== false) return deny('download', 'downloads a file');

  if (action.href) {
    let target;
    try { target = new URL(action.href, currentUrl); } catch { return deny('bad-link', 'link has an unreadable address'); }
    if (!['http:', 'https:', 'file:'].includes(target.protocol)) return deny('non-web-link', `opens a ${target.protocol} link`);
    if (cfg.sameOriginOnly && !isAllowedUrl(target.href, cfg)) return deny('external-link', `links off the app origin to ${target.origin === 'null' ? target.href : target.origin}`);
  }
  if (action.form?.action) {
    let target;
    try { target = new URL(action.form.action, currentUrl); } catch { target = null; }
    if (action.isSubmit && target && cfg.sameOriginOnly && !isAllowedUrl(target.href, cfg)) return deny('external-form', `submits a form off the app origin to ${target.origin}`);
  }

  const hrefPath = action.href ? safePath(action.href, currentUrl) : '';
  const deny1 = firstMatch(s.denyActions, [name, hrefPath]);
  if (deny1) return deny('denyActions', `"${clip(deny1.text)}" matches denyActions ${deny1.re}`);

  // A submit is judged by its own label and by the form around it: a "continue" button
  // inside a sign-up form is still a sign-up.
  const formTexts = action.isSubmit && action.form
    ? [name, action.form.name, action.form.heading, action.form.action, ...(action.form.submitLabels ?? [])]
    : [name];
  const deny2 = firstMatch(s.denySubmitForms, formTexts.map(t => String(t ?? '').trim()));
  if (deny2) return deny('denySubmitForms', action.isSubmit && deny2.text !== name
    ? `submits a form whose "${clip(deny2.text)}" matches denySubmitForms ${deny2.re}`
    : `"${clip(deny2.text)}" matches denySubmitForms ${deny2.re}`);

  if (!cfg.allowAiConsent && firstMatch(s.consent, [name])) return deny('consent', `"${clip(name)}" accepts a consent prompt; allowAiConsent is false`);
  return { allowed: true };
}

/** Typed values must carry the marker when the field can hold text. */
export function checkFill(field, value) {
  if (field.inputType === 'file') return { allowed: false, rule: 'file-upload', reason: 'file inputs are never filled' };
  if (TEXT_TYPES.has(field.inputType ?? 'text') && !String(value).includes(MARKER)) return { allowed: false, rule: 'marker', reason: `typed value lacks ${MARKER}` };
  return { allowed: true };
}
export const TEXT_TYPES = new Set(['text', 'search', 'email', 'password', 'tel', 'url', 'textarea', 'contenteditable', '']);

function safePath(href, base) { try { const u = new URL(href, base); return u.pathname + u.search; } catch { return href; } }
function deny(rule, reason) { return { allowed: false, rule, reason }; }
