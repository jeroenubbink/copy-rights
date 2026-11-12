'use strict';

// Settings: the guard is ON everywhere unless the user turns it off globally
// or lets a specific site "do its thing" (allowlist).
const DEFAULTS = { enabled: true, allowlist: [] };

// Injected with the USER origin so `!important` here beats the page's own
// `!important` rules (and inline styles) for user-select and ::selection.
const CSS = `
html, html *, html *::before, html *::after {
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  user-select: text !important;
  -webkit-touch-callout: default !important;
}
html ::selection {
  background-color: Highlight !important;
  color: HighlightText !important;
}
`;

async function getSettings() {
  return { ...DEFAULTS, ...(await browser.storage.local.get(DEFAULTS)) };
}

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return 'file';
    return u.hostname;
  } catch {
    return '';
  }
}

function isAllowlisted(host, allowlist) {
  return allowlist.some((h) => host === h || host.endsWith('.' + h));
}

function shouldGuard(url, settings) {
  return settings.enabled && !isAllowlisted(hostOf(url), settings.allowlist);
}

function setIcon(tabId, guarded) {
  browser.action.setIcon({ tabId, path: guarded ? 'icons/on.svg' : 'icons/off.svg' }).catch(() => {});
  browser.action.setTitle({
    tabId,
    title: guarded ? 'Copy Rights: guarding this page' : 'Copy Rights: off for this page',
  }).catch(() => {});
}

// Always per frame: Firefox only removes a sheet whose target matches the one
// it was inserted with, so each frame's content script asks for its own CSS.
async function applyCSS(tabId, frameId, guarded) {
  const target = { tabId, frameIds: [frameId] };
  // Remove first so re-applying never stacks duplicate sheets.
  await browser.scripting.removeCSS({ target, css: CSS, origin: 'USER' }).catch(() => {});
  if (guarded) {
    await browser.scripting.insertCSS({ target, css: CSS, origin: 'USER' }).catch(() => {});
  }
}

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (message?.type === 'hello' && sender.tab) {
    const guarded = shouldGuard(sender.tab.url, await getSettings());
    if (guarded) await applyCSS(sender.tab.id, sender.frameId, true);
    if (sender.frameId === 0) setIcon(sender.tab.id, guarded);
    return guarded;
  }

  if (message?.type === 'css' && sender.tab) {
    await applyCSS(sender.tab.id, sender.frameId, Boolean(message.active));
  }

  if (message?.type === 'status') {
    const settings = await getSettings();
    return {
      host: hostOf(message.url),
      enabled: settings.enabled,
      allowlisted: isAllowlisted(hostOf(message.url), settings.allowlist),
      allowlist: settings.allowlist,
    };
  }
});

// Any settings change re-evaluates every open tab live — no reload needed.
browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const settings = await getSettings();
  for (const tab of await browser.tabs.query({})) {
    const guarded = shouldGuard(tab.url, settings);
    browser.tabs.sendMessage(tab.id, { type: 'state', active: guarded }).catch(() => {});
    setIcon(tab.id, guarded);
  }
});
