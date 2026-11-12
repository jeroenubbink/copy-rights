'use strict';

// Copy Rights content script.
//
// Runs at document_start in every frame, so our window-level *capture*
// listeners are registered before any page script exists. A window capture
// listener is the very first thing on every event's propagation path, so
// calling stopImmediatePropagation() there means no page handler (addEventListener,
// on* properties, inline on*="return false" attributes) ever sees the event,
// and the browser's default behaviour (select, copy, paste, native menu) wins.
//
// The guard is optimistic: active until the background says this site is
// allowlisted, so nothing slips through while that message is in flight.

let active = true;

const INTERACTIVE = [
  'a[href]', 'button', 'select', 'input', 'textarea', 'label', 'summary', 'video', 'audio',
  '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="tab"]',
  '[role="checkbox"]', '[role="option"]', '[role="slider"]', '[draggable="true"]',
].join(',');

function elementOf(node) {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function realTarget(e) {
  // Look through shadow DOM retargeting.
  return elementOf(e.composedPath()[0] || e.target);
}

function isPlainField(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || (tag === 'INPUT' && !/^(button|submit|reset|checkbox|radio|file|image|range|color|hidden)$/i.test(el.type));
}

function isRichEditor(el) {
  return !!el && el.isContentEditable;
}

function isEditable(el) {
  return isPlainField(el) || isRichEditor(el);
}

function focused() {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

function selectionAnchor() {
  const sel = window.getSelection();
  return sel && sel.rangeCount ? elementOf(sel.anchorNode) : null;
}

function hasPageTextSelection() {
  const sel = window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().trim() !== '';
}

// True when the user is working inside a rich (contenteditable) editor, e.g.
// Google Docs, Notion, Slack. Those apps legitimately implement copy/paste
// themselves, so we leave them alone there. Plain <input>/<textarea> fields are
// where "no pasting your email twice!" nonsense lives, so those get the guard.
function inRichEditor() {
  return isRichEditor(selectionAnchor()) || isRichEditor(focused());
}

function guard(type, shouldStop) {
  window.addEventListener(type, (e) => {
    if (active && shouldStop(e)) e.stopImmediatePropagation();
  }, true);
}

// --- Right click: native context menu, always. ---
guard('contextmenu', () => true);

// --- Selecting text. ---
guard('selectstart', (e) => !isRichEditor(realTarget(e)));

// Native text/image dragging; leave real drag-and-drop UIs (draggable="true") alone.
guard('dragstart', (e) => !realTarget(e)?.closest('[draggable="true"]'));

// --- Clipboard. ---
// Outside editors: browser default copy of exactly what's selected. No
// blocking, no "Read more at https://..." attribution spam, no "copying is
// not allowed" alerts.
guard('copy', () => !inRichEditor());
guard('cut', () => !inRichEditor());
guard('paste', (e) => !isRichEditor(realTarget(e)));
guard('beforeinput', (e) =>
  /^(insertFromPaste|insertFromPasteAsQuotation|insertFromDrop|deleteByCut)$/.test(e.inputType) &&
  !isRichEditor(realTarget(e)));

// --- "Share this quote" / "Tweet this" / "Ask AI" popups on selection. ---
// These fire when you finish selecting. Swallow the release/selection events
// while there's a text selection on the page, unless you're clicking a control
// or typing in a field.
const selectionPopupGuard = (e) => {
  if (!hasPageTextSelection()) return false;
  const el = realTarget(e);
  if (isEditable(el) || isEditable(focused()) || isRichEditor(selectionAnchor())) return false;
  return !el?.closest(INTERACTIVE);
};
for (const type of ['mouseup', 'pointerup', 'touchend']) guard(type, selectionPopupGuard);
guard('selectionchange', () =>
  !isEditable(focused()) && !isRichEditor(selectionAnchor()));

// --- Keyboard shortcuts sites like to hijack. ---
function hijackableShortcut(e) {
  const key = (e.key || '').toLowerCase();
  if (e.key === 'F12') return true;
  if (!(e.ctrlKey || e.metaKey)) return false;
  // DevTools: Ctrl/Cmd+Shift+I/J/C/K, Cmd+Opt+I/J/C on macOS.
  if ((e.shiftKey || e.altKey) && ['i', 'j', 'c', 'k'].includes(key)) return true;
  if (e.shiftKey || e.altKey) return false;
  if (key === 'u') return true; // View source.
  if (['c', 'x', 'a'].includes(key)) return !inRichEditor() && !isPlainField(focused());
  if (key === 'v') return !inRichEditor();
  return false;
}
guard('keydown', hijackableShortcut);
guard('keyup', hijackableShortcut);
guard('keypress', hijackableShortcut);

// --- State from the background (allowlist / global switch). ---
browser.runtime.onMessage.addListener((message) => {
  if (message?.type === 'state') {
    active = Boolean(message.active);
    browser.runtime.sendMessage({ type: 'css', active }).catch(() => {});
  }
});

browser.runtime.sendMessage({ type: 'hello' })
  .then((guarded) => {
    if (typeof guarded === 'boolean') active = guarded;
  })
  .catch(() => {});
