// Safety decisions are the most important thing the runner gets right: a wrong "allowed"
// clicks Delete or signs a bot up on prod. These tests pin every rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAction, checkFill, normalizeConfig, isAllowedUrl, toRegExp, globToRegExp, isBlockedRequest, withMarker, MARKER, DEFAULT_SAFETY } from '../src/runner/safety.mjs';
import { syntheticValue, DEFAULT_VALUES } from '../src/runner/inputs.mjs';
import { fitValue } from '../src/runner/discover.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = normalizeConfig({ baseUrl: 'https://app.example.test/', ...structuredClone(DEFAULT_SAFETY) });
const btn = (name, extra = {}) => ({ kind: 'click', role: 'button', name, ...extra });
const link = (name, href, extra = {}) => ({ kind: 'click', role: 'link', name, href, ...extra });
const allowed = (a, c = cfg) => checkAction(a, c).allowed;
const rule = (a, c = cfg) => checkAction(a, c).rule;

test('Pattern parsing: /regex/flags strings are regexes, other strings are literal case-insensitive text.', () => {
  assert.deepEqual([toRegExp('/log ?out/i').source, toRegExp('/log ?out/i').flags], ['log ?out', 'i']);
  assert(toRegExp('Pay now').test('please PAY NOW'));
  assert(!toRegExp('a.b').test('axb'), 'literal dots stay literal');
  assert.equal(toRegExp('/x/gi').flags, 'i', 'g and y flags are dropped so .test() has no state');
  const re = toRegExp('/delete/gi'); assert(re.test('delete') && re.test('delete'));
  assert.throws(() => toRegExp(''));
});

test('denyActions blocks every contract-listed label, in any case and spacing variant.', () => {
  for (const name of ['Publish', 'Share both dreams with the community', 'Delete account', 'Pay $5', 'Subscribe', 'Upgrade to Pro', 'Checkout', 'Log out', 'Logout', 'Sign out', 'signout', 'DELETE']) {
    const v = checkAction(btn(name), cfg);
    assert.equal(v.allowed, false, `${name} should be blocked`);
    assert.equal(v.rule, 'denyActions');
    assert.match(v.reason, /denyActions/);
  }
  for (const name of ['Continue', 'Back', 'Open help', 'Save draft', 'tell froggy about my day']) assert(allowed(btn(name)), `${name} should be allowed`);
});

test('denyActions also matches the link target, so a harmless label cannot hide /logout or /checkout.', () => {
  assert.equal(rule(link('Bye for now', 'https://app.example.test/logout')), 'denyActions');
  assert.equal(rule(link('Next', '/checkout?step=1')), 'denyActions');
  assert(allowed(link('Pricing', '/pricing')));
});

test('denySubmitForms blocks a submit by its own label and by the surrounding form.', () => {
  assert.equal(rule(btn('Sign up', { isSubmit: true, form: { name: '', heading: '', action: '', submitLabels: ['Sign up'] } })), 'denySubmitForms');
  assert.equal(rule(btn('Register')), 'denySubmitForms', 'a register button is blocked even outside a form');
  // A generic "Continue" inside a sign-up form is still a sign-up.
  const inSignup = btn('Continue', { isSubmit: true, form: { name: '', heading: 'Create account', action: '/api/users', submitLabels: ['Continue'] } });
  const v = checkAction(inSignup, cfg);
  assert.equal(v.rule, 'denySubmitForms'); assert.match(v.reason, /Create account/);
  assert.equal(rule(btn('Go', { isSubmit: true, form: { name: 'signup', heading: '', action: '', submitLabels: [] } })), 'denySubmitForms', 'form name counts');
  assert.equal(rule(btn('Go', { isSubmit: true, form: { name: '', heading: '', action: '/register', submitLabels: [] } })), 'denySubmitForms', 'form action counts');
  assert.equal(rule(btn('Go', { isSubmit: true, form: { name: '', heading: '', action: '', submitLabels: ['Go', 'Sign up instead'] } })), 'denySubmitForms', 'sibling submit labels count');
  // Non-submit controls inside that form (show password, toggles) stay usable.
  assert(allowed(btn('show password', { isSubmit: false, form: inSignup.form })));
  // Submits of ordinary forms are fine.
  assert(allowed(btn('Send message', { isSubmit: true, form: { name: '', heading: 'Write to us', action: '/thanks', submitLabels: ['Send message'] } })));
});

test('sameOriginOnly blocks external links and forms, and only same-origin URLs are allowed.', () => {
  assert.equal(rule(link('Partner', 'https://partner.example.org/')), 'external-link');
  assert.equal(rule(link('Sub', 'https://evil.app.example.test/')), 'external-link', 'subdomains are other origins');
  assert.equal(rule(link('Port', 'https://app.example.test:8443/')), 'external-link', 'ports are other origins');
  assert.equal(rule(link('Http', 'http://app.example.test/')), 'external-link', 'scheme downgrade is another origin');
  assert(allowed(link('Relative', '/about')));
  assert(allowed(link('Absolute', 'https://app.example.test/about?x=1#y')));
  assert.equal(rule(btn('Send', { isSubmit: true, form: { name: '', heading: '', action: 'https://forms.other.test/post', submitLabels: [] } })), 'external-form');
  for (const href of ['mailto:a@b.c', 'tel:+15550100', 'javascript:alert(1)', 'data:text/html,hi']) assert.equal(rule(link('x', href)), 'non-web-link', href);
  assert(isAllowedUrl('about:blank', cfg));
  assert(!isAllowedUrl('not a url', cfg));
  assert.throws(() => normalizeConfig({ baseUrl: 'https://a.test/', sameOriginOnly: false }), /sameOriginOnly/);
  assert.throws(() => normalizeConfig({ baseUrl: 'https://a.test/', entry: ['https://b.test/'] }), /outside the app origin/);
});

test('file: apps are confined to the base directory.', () => {
  const f = normalizeConfig({ baseUrl: 'file:///tmp/app/index.html' });
  assert.deepEqual(f.entry, ['file:///tmp/app/index.html'], 'a file app starts at its own file');
  assert(isAllowedUrl('file:///tmp/app/form.html', f));
  assert(isAllowedUrl('file:///tmp/app/sub/page.html', f));
  assert(!isAllowedUrl('file:///tmp/other/page.html', f));
  assert(!isAllowedUrl('file:///etc/passwd', f));
  assert(!isAllowedUrl('https://example.org/', f));
});

test('Consent prompts are declined unless allowAiConsent is true.', () => {
  for (const name of ['allow', 'Allow', 'Accept all', 'I agree', 'Yes, allow', 'accept cookies', 'Allow analytics']) assert.equal(rule(btn(name)), 'consent', name);
  for (const name of ['no thanks', 'Allowance tracker', 'Accepted cards', 'Disagree']) assert(allowed(btn(name)), name);
  const yes = normalizeConfig({ baseUrl: 'https://a.test/', allowAiConsent: true });
  assert(checkAction(btn('allow'), yes).allowed);
  const extra = normalizeConfig({ baseUrl: 'https://a.test/', consentPatterns: ['/^use ai$/i'] });
  assert.equal(checkAction(btn('Use AI'), extra).rule, 'consent');
});

test('Downloads and file pickers are never triggered.', () => {
  assert.equal(rule({ kind: 'click', role: 'button', name: 'Choose file', inputType: 'file' }), 'file-upload');
  assert.equal(rule(link('Export', '/export.csv', { download: '' })), 'download');
  assert(allowed(link('Report', '/report', { download: null })));
});

test('Back and reload are always allowed; the off-origin guard covers where they land.', () => {
  assert(allowed({ kind: 'back' })); assert(allowed({ kind: 'reload' }));
});

test('Every config is guest-only: profile, cookie and credential keys are rejected.', () => {
  for (const k of ['userDataDir', 'profile', 'cookies', 'storageState', 'credentials', 'password', 'headers']) {
    assert.throws(() => normalizeConfig({ baseUrl: 'https://a.test/', [k]: 'x' }), /guest-only/, k);
  }
  assert.throws(() => normalizeConfig({}), /baseUrl/);
  assert.throws(() => normalizeConfig({ baseUrl: 'ftp://a.test/' }), /http/);
  assert.throws(() => normalizeConfig({ baseUrl: 'https://a.test/', budget: { maxStates: 0 } }), /maxStates/);
});

test('A bare config gets the contract safety defaults.', () => {
  const c = normalizeConfig({ baseUrl: 'https://a.test/' });
  assert.deepEqual(c.denyActions, DEFAULT_SAFETY.denyActions);
  assert.deepEqual(c.denySubmitForms, DEFAULT_SAFETY.denySubmitForms);
  assert.deepEqual(c.blockRequests, DEFAULT_SAFETY.blockRequests);
  assert.equal(c.allowAiConsent, false); assert.equal(c.sameOriginOnly, true);
  assert.equal(checkAction(btn('Delete'), c).allowed, false);
});

test('blockRequests globs match the way Network.setBlockedURLs does.', () => {
  const g = DEFAULT_SAFETY.blockRequests;
  for (const u of ['https://us.i.posthog.com/e/', 'https://js.stripe.com/v3', 'https://www.google-analytics.com/g/collect']) assert(isBlockedRequest(u, g), u);
  for (const u of ['https://www.coolgirlmath.com/api/session', 'https://cdn.example.com/app.js']) assert(!isBlockedRequest(u, g), u);
  assert(globToRegExp('*a.b*').test('xxa.byy')); assert(!globToRegExp('*a.b*').test('axb'));
});

test('Every synthetic text value carries the QA-SYNTHETIC marker.', () => {
  assert.equal(withMarker('hi'), 'hi ' + MARKER); assert.equal(withMarker('x QA-SYNTHETIC'), 'x QA-SYNTHETIC'); assert.equal(withMarker(''), MARKER);
  for (const [cls, v] of Object.entries(DEFAULT_VALUES)) if (!['number', 'date'].includes(cls)) assert(v.includes(MARKER), cls);
  // Config overrides get the marker added if the author forgot it.
  const c = normalizeConfig({ baseUrl: 'https://a.test/', syntheticInputs: { story: 'a latte' } });
  assert.equal(c.syntheticInputs.story, 'a latte ' + MARKER);
  for (const field of [{ inputType: 'email' }, { inputType: 'password' }, { inputType: 'text', name: 'Your name' }, { inputType: 'textarea', tag: 'textarea' }, { inputType: 'tel' }, { inputType: 'url' }, { inputType: 'search' }, { inputType: 'text' }]) {
    const { value } = syntheticValue(field, c.syntheticInputs);
    assert(value.includes(MARKER), JSON.stringify(field));
    assert(checkFill(field, value).allowed);
  }
  assert.equal(checkFill({ inputType: 'text' }, 'no marker').allowed, false);
  assert.equal(checkFill({ inputType: 'file' }, MARKER).allowed, false);
  assert(checkFill({ inputType: 'number' }, '12').allowed, 'numbers cannot hold the marker');
  // maxLength never cuts the marker off.
  assert.equal(fitValue('Sample entry QA-SYNTHETIC', 15, true), MARKER);
  assert.equal(fitValue('Sample entry QA-SYNTHETIC', 5, true), null);
  assert.equal(fitValue('123456', 3, false), '123');
});

test('Girl Math config: deny patterns match the real signed-out labels and leave the onboarding path open.', async () => {
  const gm = normalizeConfig(JSON.parse(await readFile(join(root, 'apps/girl-math/config.json'), 'utf8')));
  assert.equal(gm.allowAiConsent, false);
  assert.equal(gm.baseUrl, 'https://www.coolgirlmath.com/');
  // Blocked: login, sign-up, sharing, uploads, analytics consent.
  const blocked = {
    'i already have an account': link('i already have an account', '/signin'),
    'make my account': btn('make my account', { isSubmit: true, form: { name: '', heading: 'save your board', action: '', submitLabels: ['make my account'] } }),
    'let me in': btn('let me in', { isSubmit: true, form: { name: '', heading: '', action: '', submitLabels: ['let me in'] } }),
    'i forgot my password': btn('i forgot my password'),
    'email me a reset link': btn('email me a reset link', { isSubmit: true, form: { name: '', heading: '', action: '', submitLabels: [] } }),
    'share both dreams with the community': btn('share both dreams with the community'),
    'upload my photos': btn('upload my photos'),
    'allow (analytics consent)': btn('allow'),
    // UX-only scope (2026-11-22): anything that sends the story to AI is blocked.
    'continue': btn('continue'),
    'send reply': btn('send reply'),
    'make my plan and dreams': btn('make my plan and dreams'),
  };
  for (const [label, a] of Object.entries(blocked)) assert.equal(checkAction(a, gm).allowed, false, label);
  // Allowed: the guest onboarding path up to the AI step, Back, edits and declining consent.
  for (const name of ['tell froggy about my day', 'add the money bits myself', 'use starter estimates', 'add a money bit', 'remove', 'change my story', 'edit my dreams', 'open dream for travel', 'close dream', 'no thanks', 'show password', 'i’m new here', 'add my own category or dream']) {
    assert(checkAction(btn(name), gm).allowed, name);
  }
  assert.equal(checkAction(link('Instagram', 'https://instagram.com/girlmath'), gm).rule, 'external-link');
  for (const u of ['https://us.i.posthog.com/e/', 'https://js.stripe.com/v3']) assert(isBlockedRequest(u, gm.blockRequests));
});
