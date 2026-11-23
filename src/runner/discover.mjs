// Action discovery and execution. Roles and names come from Accessibility.getFullAXTree; each
// candidate node is then resolved to its DOM element for a visibility and hit test and for the
// context the safety layer needs (href, surrounding form, dialog).
import { checkAction, checkFill, MARKER, TEXT_TYPES } from './safety.mjs';
import { syntheticValue } from './inputs.mjs';

const CLICK_ROLES = new Set(['button', 'link', 'checkbox', 'switch', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'PopUpButton', 'combobox', 'listbox']);
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox']);
const HEADING_ROLES = new Set(['heading']);
const DIALOG_ROLES = new Set(['dialog', 'alertdialog']);
const OBJECT_GROUP = 'agent-manuel-discover';

// Runs in the page with `this` bound to an AX node's DOM node. Self-contained.
function describeNode() {
  const el = this.nodeType === 1 ? this : this.parentElement;
  if (!el) return null;
  const visibleBox = e => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    const ok = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && !e.closest('[inert],[aria-hidden="true"]')
      && (typeof e.checkVisibility !== 'function' || e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
    return ok ? r : null;
  };
  const hitTest = (e, r) => {
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null; // off-screen: tested again at action time
    const t = document.elementFromPoint(x, y);
    return !!t && (t === e || e.contains(t) || (t.tagName === 'LABEL' && t.control === e));
  };
  let r = visibleBox(el), via = null;
  if (!r && el.labels && el.labels.length) { // visually hidden checkbox styled through its label
    for (const l of el.labels) { const lr = visibleBox(l); if (lr) { r = lr; via = 'label'; break; } }
  }
  const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || (tag === 'textarea' ? 'textarea' : tag === 'input' ? 'text' : '')).toLowerCase();
  const form = el.form || el.closest('form');
  const isSubmit = !!form && ((tag === 'button' && (!el.getAttribute('type') || el.getAttribute('type').toLowerCase() === 'submit')) || (tag === 'input' && (type === 'submit' || type === 'image')));
  const text = n => (n ? (n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '');
  const formInfo = form ? {
    name: form.getAttribute('aria-label') || (form.getAttribute('aria-labelledby') ? text(document.getElementById(form.getAttribute('aria-labelledby'))) : '') || form.getAttribute('name') || form.id || '',
    heading: text(form.querySelector('h1,h2,h3,h4,legend')) || text(form.closest('section,article,dialog,main,[role=dialog]')?.querySelector('h1,h2,h3,h4')),
    action: form.getAttribute('action') || '',
    submitLabels: [...form.querySelectorAll('button:not([type=button]):not([type=reset]),input[type=submit]')].map(b => (b.innerText || b.value || b.getAttribute('aria-label') || '').trim()).filter(Boolean),
  } : null;
  const a = el.closest('a[href]');
  const dlg = el.closest('dialog[open],[role=dialog],[role=alertdialog]');
  return {
    tag, type, visible: !!r, via, hit: r ? hitTest(via ? el.labels[0] : el, r) : false,
    disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true' || !!el.closest('fieldset[disabled]'),
    href: a ? a.href : null, target: a ? a.getAttribute('target') : null, download: a && a.hasAttribute('download') ? a.getAttribute('download') : null,
    isSubmit, form: formInfo, inDialog: !!dlg, modal: !!(dlg && (dlg.matches(':modal') || dlg.getAttribute('aria-modal') === 'true')),
    autocomplete: el.getAttribute('autocomplete') || '', placeholder: el.getAttribute('placeholder') || '', htmlName: el.getAttribute('name') || '',
    readOnly: !!el.readOnly, isSelect: tag === 'select', optionCount: tag === 'select' ? el.options.length : 0,
  };
}

/** Lists headings, controls, any open dialog and the actions available on the current screen. */
export async function observe(page) {
  const url = await page.url();
  const { nodes } = await page.send('Accessibility.getFullAXTree');
  const out = { url, headings: [], controls: [], dialog: null, actions: [], fields: [] };
  const counts = new Map();
  let modalOpen = false;
  const candidates = [];
  for (const n of nodes) {
    if (n.ignored || !n.backendDOMNodeId) continue;
    const role = n.role?.value, name = String(n.name?.value ?? '').replace(/\s+/g, ' ').trim();
    if (!(CLICK_ROLES.has(role) || FIELD_ROLES.has(role) || HEADING_ROLES.has(role) || DIALOG_ROLES.has(role))) continue;
    candidates.push({ role, name, backendNodeId: n.backendDOMNodeId });
  }
  try {
    for (const c of candidates) {
      let info;
      try {
        const { object } = await page.send('DOM.resolveNode', { backendNodeId: c.backendNodeId, objectGroup: OBJECT_GROUP });
        info = (await page.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: describeNode.toString(), returnByValue: true })).result.value;
      } catch { continue; }
      if (!info || !info.visible) continue;
      if (HEADING_ROLES.has(c.role)) { if (c.name) out.headings.push(c.name); continue; }
      if (DIALOG_ROLES.has(c.role)) { out.dialog ??= c.name || 'dialog'; if (info.modal || info.tag === 'dialog') modalOpen = true; continue; }
      out.controls.push({ role: c.role, name: c.name });
      const isField = FIELD_ROLES.has(c.role) && !info.isSelect;
      if (isField) { out.fields.push({ ...c, ...info }); continue; }
      if (info.disabled) continue;
      if (info.hit === false) continue; // covered by something else right now
      const kind = info.isSelect ? 'select' : 'click';
      const sig = `${kind}|${c.role}|${c.name}`;
      const nth = counts.get(sig) ?? 0; counts.set(sig, nth + 1);
      out.actions.push({ kind, role: c.role, name: c.name, nth, href: info.href, target: info.target, download: info.download, inputType: info.type, isSubmit: info.isSubmit, form: info.form, inDialog: info.inDialog, via: info.via, backendNodeId: c.backendNodeId });
    }
  } finally { await page.send('Runtime.releaseObjectGroup', { objectGroup: OBJECT_GROUP }).catch(() => {}); }
  // With a modal open, only the dialog is reachable.
  if (modalOpen) out.actions = out.actions.filter(a => a.inDialog);
  return out;
}

export function actionLabel(a) {
  if (a.kind === 'goto') return `open ${a.url}`;
  if (a.kind === 'back') return 'browser Back';
  if (a.kind === 'reload') return 'reload';
  return `${a.kind === 'select' ? 'choose in' : 'click'} ${a.role} "${a.name || '(unnamed)'}"${a.nth ? ` #${a.nth + 1}` : ''}`;
}

/** The part of an action that survives into the ledger and replays in a fresh context. */
export function actionRecord(a) {
  const r = { kind: a.kind, label: actionLabel(a) };
  if (a.kind === 'goto') r.url = a.url;
  if (a.kind === 'click' || a.kind === 'select') Object.assign(r, { role: a.role, name: a.name, nth: a.nth, ...(a.href ? { href: a.href } : {}) });
  return r;
}
export const actionSignature = a => `${a.kind}|${a.role ?? ''}|${a.name ?? ''}|${a.nth ?? 0}`;

async function resolve(page, backendNodeId) {
  const { object } = await page.send('DOM.resolveNode', { backendNodeId });
  return object.objectId;
}
const call = async (page, objectId, fn, args = []) => {
  const r = await page.send('Runtime.callFunctionOn', { objectId, functionDeclaration: fn.toString(), arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] ?? r.exceptionDetails.text);
  return r.result.value;
};

// In-page: scroll the click target into view and hit-test its centre.
function aimAt(viaLabel) {
  const el = viaLabel && this.labels?.length ? this.labels[0] : this;
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const t = document.elementFromPoint(x, y);
  const ok = !!t && (t === el || el.contains(t) || (t.tagName === 'LABEL' && t.control === this));
  const who = t ? t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + (t.classList[0] ? '.' + t.classList[0] : '') : 'nothing';
  return { x, y, ok, who };
}

// In-page: the empty text fields a button press would submit, scoped to its form, its dialog or the page.
function fieldsFor() {
  const scope = this.form || this.closest('form') || this.closest('dialog[open],[role=dialog]') || document;
  const skip = new Set(['hidden', 'file', 'checkbox', 'radio', 'submit', 'button', 'image', 'reset', 'range', 'color']);
  return [...scope.querySelectorAll('input,textarea')].filter(e => {
    if (skip.has((e.getAttribute('type') || 'text').toLowerCase()) || e.disabled || e.readOnly || e.value !== '') return false;
    if (scope === document && e.closest('form') && e.closest('form') !== this.closest('form')) return false;
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  });
}
function describeField() {
  const t = this.tagName.toLowerCase();
  const labelled = this.getAttribute('aria-label') || [...(this.labels ?? [])].map(l => l.innerText).join(' ') || '';
  return { tag: t, inputType: t === 'textarea' ? 'textarea' : (this.getAttribute('type') || 'text').toLowerCase(), autocomplete: this.getAttribute('autocomplete') || '', name: labelled.trim(), placeholder: this.getAttribute('placeholder') || '', htmlName: this.getAttribute('name') || '', maxLength: this.maxLength };
}
function focusAndSelect() { this.focus(); if (typeof this.select === 'function') this.select(); return document.activeElement === this; }
function fireChange() { this.dispatchEvent(new Event('change', { bubbles: true })); }
function chooseNext() {
  const opts = [...this.options]; if (!opts.length) return null;
  let i = this.selectedIndex;
  for (let k = 0; k < opts.length; k++) { i = (i + 1) % opts.length; if (!opts[i].disabled) break; }
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(this, opts[i].value);
  this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true }));
  return opts[i].textContent.trim();
}

/** Fits a value under maxLength without cutting the marker. Returns null if impossible. */
export function fitValue(value, maxLength, needsMarker) {
  if (!(maxLength > 0) || value.length <= maxLength) return value;
  if (!needsMarker) return value.slice(0, maxLength);
  return maxLength >= MARKER.length ? MARKER : null;
}

/** Fills empty fields with synthetic values. Returns what was typed, for the ledger. */
export async function autofill(page, objectId, cfg) {
  const { result } = await page.send('Runtime.callFunctionOn', { objectId, functionDeclaration: fieldsFor.toString(), returnByValue: false });
  if (!result.objectId) return [];
  const { result: props } = await page.send('Runtime.getProperties', { objectId: result.objectId, ownProperties: true });
  const filled = [];
  for (const p of props.filter(p => /^\d+$/.test(p.name) && p.value?.objectId)) {
    const id = p.value.objectId;
    const field = await call(page, id, describeField);
    const { cls, value: raw } = syntheticValue(field, cfg.syntheticInputs);
    const needsMarker = TEXT_TYPES.has(field.inputType);
    const value = fitValue(raw, field.maxLength, needsMarker);
    if (value == null) { filled.push({ field: field.name || field.htmlName, cls, skipped: 'maxLength too short for the marker' }); continue; }
    const verdict = checkFill(field, value);
    if (!verdict.allowed) { filled.push({ field: field.name || field.htmlName, cls, skipped: verdict.reason }); continue; }
    if (!(await call(page, id, focusAndSelect))) continue;
    await page.send('Input.insertText', { text: value });
    await call(page, id, fireChange);
    filled.push({ field: field.name || field.htmlName || field.placeholder, cls, value });
  }
  return filled;
}

/**
 * Finds `action` on the current screen and performs it, after a final safety check against
 * the live element. Returns { status:'passed'|'failed'|'blocked', reason?, filled? }.
 */
export async function perform(page, action, cfg, observed) {
  if (action.kind === 'goto') { await page.goto(action.url); return { status: 'passed' }; }
  if (action.kind === 'reload') { await page.send('Page.reload', { ignoreCache: true }); await page.settle(); return { status: 'passed' }; }
  if (action.kind === 'back') {
    const { currentIndex, entries } = await page.send('Page.getNavigationHistory');
    const prev = entries[currentIndex - 1];
    if (!prev || prev.url === 'about:blank') return { status: 'failed', reason: 'no earlier page in history' };
    await page.send('Page.navigateToHistoryEntry', { entryId: prev.id });
    await page.settle();
    return { status: 'passed' };
  }
  const now = observed ?? await observe(page);
  const live = now.actions.find(a => actionSignature(a) === actionSignature(action));
  if (!live) return { status: 'failed', reason: `control not found: ${actionLabel(action)}` };
  const verdict = checkAction(live, cfg, now.url);
  if (!verdict.allowed) return { status: 'blocked', reason: verdict.reason, rule: verdict.rule };

  const objectId = await resolve(page, live.backendNodeId);
  if (live.kind === 'select') {
    const chose = await call(page, objectId, chooseNext);
    await page.settle();
    return { status: 'passed', reason: chose ? `chose "${chose}"` : undefined };
  }
  const filled = live.role === 'link' ? [] : await autofill(page, objectId, cfg);
  const aim = await call(page, objectId, aimAt, [live.via === 'label']);
  if (!aim.ok) return { status: 'failed', reason: `covered by ${aim.who} at the moment of the click`, filled };
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x: aim.x, y: aim.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
  }
  await page.settle();
  return { status: 'passed', filled };
}
