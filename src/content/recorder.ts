// Tier 0 — workflow recorder & step player (in-page half).
//
// Recording captures each interaction as a *list* of selector candidates,
// strongest first, plus the element's visible label. Playback walks that list
// until something resolves, so a workflow survives the class-name churn and
// hashed attributes that break single-selector automation.

export interface RecordedStep {
  type: 'click' | 'type' | 'key' | 'scroll' | 'navigate' | 'select';
  selectors?: string[];
  label?: string;
  value?: string;
  url?: string;
  ms?: number;
  id?: string;
  at?: number;
  /** For 'select': the chosen option(s), by value and visible text. */
  options?: SelectedOption[];
}

export interface SelectedOption { value: string; text: string }

let recording = false;
let steps: RecordedStep[] = [];
let lastTypedTarget: HTMLElement | null = null;
let scrollTimer: number | null = null;
/** Steps in the whole recording so far (it can span several pages), as the background counts them. */
let totalSteps = 0;
const SENSITIVE = /pass(word|wd)|\b(cvv|cvc|otp|pin|ssn|token|secret|security.?code|verification.?code)\b|credit.?card|card.?number|\bcc-(number|csc|exp)/i;

function isSensitive(el: HTMLElement): boolean {
  return SENSITIVE.test(['type', 'name', 'id', 'autocomplete', 'aria-label', 'placeholder']
    .map(k => el.getAttribute(k) || '').join(' '));
}

function capture(step: RecordedStep) {
  const saved = { ...step, id: crypto.randomUUID(), at: Date.now() };
  steps.push(saved);
  totalSteps++;
  chrome.runtime.sendMessage({ type: 'ECHO_RECORD_STEP', step: saved })
    .then((r: any) => { if (typeof r?.count === 'number') totalSteps = Math.max(totalSteps, r.count); updateBar(); })
    .catch(() => {});
  updateBar();
}

/** ECHO's own controls: the command bar and the recording bar are never part of a recording. */
const isEchoUi = (el: Element | null) => !!el?.closest?.('#echo-extension-root, #echo-rec-bar');

// --- selector generation ---------------------------------------------------

/** True for classes that look generated (hashes, CSS-modules, utility soup). */
function isStableClass(c: string): boolean {
  if (!c || c.length < 3 || c.length > 40) return false;
  if (/^(css|sc|jsx|emotion)-/i.test(c)) return false;
  if (/[0-9a-f]{6,}/i.test(c)) return false;    // hashed
  if (/^[a-z]{1,3}-?\d+$/i.test(c)) return false; // tailwind-ish p-4, mt-2
  return true;
}

function nthOfTypePath(el: HTMLElement): string {
  const parts: string[] = [];
  let node: HTMLElement = el;
  let depth = 0;
  while (node.nodeType === 1 && node !== document.body && depth < 6) {
    const current: HTMLElement = node;
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;
    const tag = current.tagName.toLowerCase();
    const siblings: Element[] = Array.from(parent.children)
      .filter((c: Element) => c.tagName === current.tagName);
    const idx = siblings.indexOf(current) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
    node = parent;
    depth++;
  }
  return parts.join(' > ');
}

export function buildSelectors(el: HTMLElement): string[] {
  const out: string[] = [];
  const tag = el.tagName.toLowerCase();
  const add = (s: string) => { if (s && !out.includes(s)) out.push(s); };

  const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
  if (testId) add(`[data-testid="${CSS.escape(testId)}"]`);

  const id = el.getAttribute('id');
  // Skip ids that look auto-generated (react-select-3-input, :r1a:, etc.)
  if (id && !/^[:.]|\d{4,}|^ember|^react-/.test(id)) add(`#${CSS.escape(id)}`);

  const name = el.getAttribute('name');
  if (name) add(`${tag}[name="${CSS.escape(name)}"]`);

  const aria = el.getAttribute('aria-label');
  if (aria) add(`${tag}[aria-label="${CSS.escape(aria)}"]`);

  const ph = el.getAttribute('placeholder');
  if (ph) add(`${tag}[placeholder="${CSS.escape(ph)}"]`);

  const role = el.getAttribute('role');
  const type = el.getAttribute('type');
  if (type) add(`${tag}[type="${CSS.escape(type)}"]`);
  if (role) add(`${tag}[role="${CSS.escape(role)}"]`);

  const stable = Array.from(el.classList).filter(isStableClass).slice(0, 2);
  if (stable.length) add(`${tag}.${stable.map(c => CSS.escape(c)).join('.')}`);

  add(nthOfTypePath(el));
  return out;
}

function labelOf(el: HTMLElement): string {
  const raw = (
    (el as any).innerText ||
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('title') ||
    el.getAttribute('name') ||
    (['button', 'submit'].includes((el.getAttribute('type') || '').toLowerCase()) ? el.getAttribute('value') : '') ||
    ''
  );
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, 60);
}

// --- selector resolution (playback) ----------------------------------------

function visible(el: Element): boolean {
  const s = getComputedStyle(el as HTMLElement);
  if (s.display === 'none' || s.visibility === 'hidden') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Try each selector in order; fall back to matching the visible label. */
export function resolveStep(step: RecordedStep): HTMLElement | null {
  for (const sel of step.selectors || []) {
    try {
      const found = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(visible);
      if (found.length) return found[0];
    } catch { /* invalid selector after a site redesign — try the next */ }
  }
  if (step.label && step.label.length > 2) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(
      'a,button,input,textarea,select,[role="button"],[role="link"],[role="tab"],[contenteditable="true"]'
    )).filter(visible);
    const want = step.label.toLowerCase();
    const exact = candidates.find(c => labelOf(c).toLowerCase() === want);
    if (exact) return exact;
    const partial = candidates.find(c => {
      const l = labelOf(c).toLowerCase();
      return l.length > 2 && (l.includes(want) || want.includes(l));
    });
    if (partial) return partial;
  }
  return null;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Execute one recorded step against the live page. */
export function playStep(step: RecordedStep): { success: boolean; error?: string; result?: string } {
  if (step.type === 'scroll') {
    window.scrollTo({ top: Number(step.value) || 0, behavior: 'smooth' });
    return { success: true, result: 'scrolled' };
  }
  if (step.type === 'key') {
    const target = (document.activeElement as HTMLElement) || document.body;
    const key = step.value || 'Enter';
    const code = key === 'Enter' ? 13 : key === 'Escape' ? 27 : key === 'Tab' ? 9 : 0;
    const opts = { key, code: key, keyCode: code, which: code, bubbles: true } as any;
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keypress', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
    return { success: true, result: `pressed ${key}` };
  }

  const el = resolveStep(step);
  if (!el) return { success: false, error: `Could not find "${step.label || step.selectors?.[0] || step.type}"` };
  if ((step.type === 'type' || step.type === 'select') && isSensitive(el)) {
    return { success: false, error: 'Sensitive fields cannot be filled by a workflow.' };
  }

  try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch { /* ignore */ }

  if (step.type === 'click') {
    el.click();
    return { success: true, result: `clicked ${step.label || ''}`.trim() };
  }
  if (step.type === 'type') {
    el.focus();
    if (el.isContentEditable) {
      el.textContent = step.value || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      setNativeValue(el as HTMLInputElement, step.value || '');
    }
    return { success: true, result: `typed into ${step.label || 'field'}` };
  }
  if (step.type === 'select') return chooseOptions(el, step);
  return { success: false, error: `Unknown step type ${step.type}` };
}

function optionText(o: HTMLOptionElement): string {
  return (o.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Re-select recorded options. Match value+text first, then visible text (sites
 * often renumber option values), then value alone.
 */
function chooseOptions(el: HTMLElement, step: RecordedStep): { success: boolean; error?: string; result?: string } {
  if (el.tagName !== 'SELECT') return { success: false, error: `"${step.label || 'That control'}" is no longer a dropdown.` };
  const select = el as HTMLSelectElement;
  const all = Array.from(select.options);
  const chosen = new Set<HTMLOptionElement>();
  for (const want of step.options || []) {
    const hit = all.find(o => o.value === want.value && optionText(o) === want.text)
      || all.find(o => optionText(o) === want.text)
      || all.find(o => o.value === want.value);
    if (!hit) return { success: false, error: `Couldn't find option "${want.text || want.value}" in ${step.label || 'the dropdown'}.` };
    chosen.add(hit);
  }
  if (!chosen.size) return { success: false, error: 'No option was recorded for this dropdown.' };

  select.focus();
  if (select.multiple) all.forEach(o => { o.selected = chosen.has(o); });
  else select.selectedIndex = all.indexOf([...chosen][0]);
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const names = [...chosen].map(optionText).join(', ');
  return { success: true, result: `chose ${names} in ${step.label || 'dropdown'}` };
}

// --- recording -------------------------------------------------------------

function onClick(e: MouseEvent) {
  if (!recording) return;
  const el = e.target as HTMLElement;
  if (!el || !el.tagName) return;
  if (isEchoUi(el)) return; // never record ECHO's own UI

  // Attribute the click to the nearest real control, not a nested <span>.
  // Native dropdowns are recorded from their change event (onChange); the
  // click that opens one does nothing on replay.
  if (el.closest('select')) return;

  const actionable = (el.closest(
    'a,button,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[onclick],[contenteditable="true"]'
  ) as HTMLElement) || el;
  if (isSensitive(actionable)) return;

  flushTyping();
  capture({ type: 'click', selectors: buildSelectors(actionable), label: labelOf(actionable) });
}

/**
 * Typing is captured on blur/enter rather than per-keystroke, so a 20-character
 * field becomes one step with the final value instead of 20 noisy ones.
 */
function onInput(e: Event) {
  if (!recording) return;
  const el = e.target as HTMLElement;
  if (!el || isEchoUi(el)) return;
  if (!/^(INPUT|TEXTAREA)$/.test(el.tagName) && !el.isContentEditable) return;
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (type === 'password' || isSensitive(el)) return; // never record secrets
  lastTypedTarget = el;
}

function flushTyping() {
  if (!lastTypedTarget) return;
  const el = lastTypedTarget;
  lastTypedTarget = null;
  const value = el.isContentEditable ? (el.textContent || '') : (el as HTMLInputElement).value;
  if (!value) return;
  capture({ type: 'type', selectors: buildSelectors(el), label: labelOf(el), value });
}

/** A native <select> changed: record which option(s) were chosen. */
function onChange(e: Event) {
  if (!recording) return;
  const el = e.target as HTMLElement;
  if (!el || el.tagName !== 'SELECT' || isEchoUi(el)) return;
  if (isSensitive(el)) return; // e.g. card expiry month
  const select = el as HTMLSelectElement;
  const options = Array.from(select.selectedOptions || [])
    .slice(0, 50).map(o => ({ value: o.value.slice(0, 200), text: optionText(o) }));
  if (!options.length) return;
  flushTyping();
  capture({ type: 'select', selectors: buildSelectors(select), label: labelOf(select), options });
}

function onKeyDown(e: KeyboardEvent) {
  if (!recording || isEchoUi(e.target as Element)) return;
  if (e.key === 'Enter') {
    flushTyping();
    capture({ type: 'key', value: 'Enter' });
  }
}

function onScroll() {
  if (!recording) return;
  if (scrollTimer) window.clearTimeout(scrollTimer);
  // Collapse a scroll gesture into one step once it settles.
  scrollTimer = window.setTimeout(() => {
    const last = steps[steps.length - 1];
    if (last?.type === 'scroll') return;
    capture({ type: 'scroll', value: String(Math.round(window.scrollY)) });
  }, 500);
}

// --- the recording bar ------------------------------------------------------
// Top of the page while ECHO watches: how many steps so far, Done and Cancel.
// Done asks for a name and saves the task. It lives in a closed shadow root,
// so the page's CSS can't restyle it and the page's scripts can't reach in;
// its buttons only act on real clicks and key presses.

type BarState = 'recording' | 'naming' | 'saving' | 'saved' | 'error';
let bar: { host: HTMLElement; root: ShadowRoot } | null = null;
let barState: BarState = 'recording';
let barMessage = '';
let barTimer: number | null = null;

const BAR_CSS = `
:host { all: initial; position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 2147483647; }
.bar { display: flex; align-items: center; gap: 10px; max-width: min(560px, calc(100vw - 32px)); padding: 7px 8px 7px 14px;
  border-radius: 999px; background: rgba(20, 20, 28, 0.94); color: #fff; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35), inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  font: 500 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: #ff453a; animation: pulse 1.4s ease-in-out infinite; }
.ok { flex: none; color: #30d158; font-weight: 700; }
.text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.text small { color: rgba(255, 255, 255, 0.6); font-size: 12px; margin-left: 6px; }
input { width: 190px; min-width: 0; padding: 6px 10px; border: none; border-radius: 8px; background: rgba(255, 255, 255, 0.12); color: #fff;
  font: inherit; outline: none; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18); }
input:focus { box-shadow: inset 0 0 0 2px #0a84ff; }
button { flex: none; padding: 6px 14px; border: none; border-radius: 999px; font: 600 12.5px/1.2 inherit; font-family: inherit; cursor: pointer;
  background: rgba(255, 255, 255, 0.14); color: #fff; }
button.primary { background: #fff; color: #111; }
button:hover { filter: brightness(1.1); }
button:focus-visible { outline: 2px solid #0a84ff; outline-offset: 2px; }
@keyframes pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; } }`;

function suggestedName(): string {
  const title = (document.title || location.hostname).split(/\s[|\-–·:]\s/)[0];
  return title.replace(/[^\p{L}\p{N} '&-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'My task';
}

function el(tag: string, props: Record<string, string | number> = {}, ...children: (Node | string)[]): HTMLElement {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** A button that ignores synthetic clicks from page scripts. */
function trustedButton(label: string, onPress: () => void, primary = false) {
  const b = el('button', { type: 'button', className: primary ? 'primary' : '' }, label);
  b.addEventListener('click', e => { if (e.isTrusted) onPress(); });
  return b;
}

function setBar(state: BarState, message = '') {
  barState = state;
  barMessage = message;
  updateBar();
}

function updateBar() {
  if (!bar) return;
  const steps = `${totalSteps} step${totalSteps === 1 ? '' : 's'}`;
  const box = el('div', { className: 'bar' });
  box.setAttribute('role', 'status');
  if (barState === 'recording') {
    box.append(el('span', { className: 'dot' }), el('span', { className: 'text' }, 'ECHO is watching', el('small', {}, steps)),
      trustedButton('Done', () => setBar('naming'), true), trustedButton('Cancel', cancelFromBar));
  } else if (barState === 'naming') {
    const input = el('input', { value: suggestedName(), maxLength: 40, placeholder: 'Name this task' }) as HTMLInputElement;
    input.setAttribute('aria-label', 'Name this task');
    input.addEventListener('keydown', e => {
      if (!e.isTrusted) return;
      if (e.key === 'Enter') saveFromBar(input.value);
      if (e.key === 'Escape') setBar('recording');
    });
    box.append(el('span', { className: 'text' }, 'Name it', el('small', {}, steps)), input,
      trustedButton('Save', () => saveFromBar(input.value), true), trustedButton('Back', () => setBar('recording')));
    bar.root.replaceChildren(el('style', {}, BAR_CSS), box);
    input.focus();
    input.select();
    return;
  } else if (barState === 'saving') {
    box.append(el('span', { className: 'text' }, 'Saving…'));
  } else if (barState === 'saved') {
    box.append(el('span', { className: 'ok' }, '✓'), el('span', { className: 'text' }, barMessage), trustedButton('OK', hideBar, true));
  } else {
    box.append(el('span', { className: 'text' }, barMessage), trustedButton('OK', hideBar, true));
  }
  bar.root.replaceChildren(el('style', {}, BAR_CSS), box);
}

function saveFromBar(raw: string) {
  const name = raw.trim();
  if (!name) return;
  setBar('saving');
  chrome.runtime.sendMessage({ type: 'ECHO_WORKFLOW', action: 'stop', name })
    .then((r: any) => {
      if (!r?.success) { setBar('error', r?.error || 'Could not save the task.'); return; }
      setBar('saved', `Saved "${r.name}". Do it again any time from the Echo panel.`);
      if (barTimer) window.clearTimeout(barTimer);
      barTimer = window.setTimeout(hideBar, 8000);
    })
    .catch(() => setBar('error', 'ECHO is not responding. Reload the page and try again.'));
}

function cancelFromBar() {
  chrome.runtime.sendMessage({ type: 'ECHO_WORKFLOW', action: 'cancel' }).catch(() => {});
  stopRecording();
  hideBar();
}

function showBar() {
  if (barTimer) { window.clearTimeout(barTimer); barTimer = null; }
  if (!bar) {
    const host = document.createElement('div');
    host.id = 'echo-rec-bar';
    const root = host.attachShadow({ mode: 'closed' });
    bar = { host, root };
    document.documentElement.appendChild(host);
  }
  setBar('recording');
}

function hideBar() {
  if (barTimer) { window.clearTimeout(barTimer); barTimer = null; }
  bar?.host.remove();
  bar = null;
}

export function startRecording(stepsSoFar = 0): { success: boolean; result: string } {
  if (recording) return { success: true, result: 'already recording' };
  totalSteps = stepsSoFar;
  steps = [];
  lastTypedTarget = null;
  recording = true;
  document.addEventListener('click', onClick, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onScroll, { passive: true });
  showBar();
  return { success: true, result: 'recording' };
}

export function stopRecording(): { success: boolean; result: { steps: RecordedStep[] } } {
  flushTyping();
  recording = false;
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('input', onInput, true);
  document.removeEventListener('change', onChange, true);
  document.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('scroll', onScroll);
  if (scrollTimer) { window.clearTimeout(scrollTimer); scrollTimer = null; }
  // Saving from the bar keeps it up to say so; any other stop takes it away.
  if (barState === 'recording' || barState === 'naming') hideBar();
  const captured = steps;
  steps = [];
  return { success: true, result: { steps: captured } };
}

export function isRecordingActive(): boolean { return recording; }
