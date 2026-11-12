// End-to-end test: loads the extension into headless Firefox and checks every
// trick on test/torture.html is defeated, then allowlists the site and checks
// the page gets its way again.
//
//   npm test            (HEADFUL=1 npm test to watch it)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder, By, Key } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADDON_ID = 'copy-rights@jeroenubbink.github.io';
const ADDON_UUID = '7c0e3c5e-0b5a-4a43-9a43-c0b7c0ffee00';
const MOD = process.platform === 'darwin' ? Key.COMMAND : Key.CONTROL;

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(fs.readFileSync(path.join(root, 'test/torture.html')));
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/`;

// Needed to switch Marionette into chrome context (see allowlist step).
process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS = '1';

const options = new firefox.Options()
  .setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: ADDON_UUID }))
  .setPreference('xpinstall.signatures.required', false);
if (!process.env.HEADFUL) options.addArguments('-headless');

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures++;
};
const pageLog = () => driver.executeScript('return window.__log || []');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function selectElementText(id) {
  const el = await driver.findElement(By.id(id));
  await driver.executeScript("arguments[0].scrollIntoView({block: 'center'})", el);
  const rect = await el.getRect();
  // Real mouse drag across the element, so selectstart/mouseup are trusted events.
  await driver.actions()
    .move({ origin: el, x: -Math.floor(rect.width / 2) + 2, y: 0 })
    .press()
    .move({ origin: el, x: Math.floor(rect.width / 2) - 2, y: 0, duration: 200 })
    .release()
    .perform();
  return driver.executeScript('return window.getSelection().toString()');
}

async function find(id) {
  const el = await driver.findElement(By.id(id));
  await driver.executeScript("arguments[0].scrollIntoView({block: 'center'})", el);
  return el;
}

async function clearInput(id) {
  await driver.executeScript(`document.getElementById('${id}').value = ''`);
}

try {
  await driver.installAddon(root, true);
  await driver.get(url);
  await sleep(500);

  // --- Guarded (default) ---
  const userSelect = await driver.executeScript(`
    return ['noselect-text', 'inline-text'].map(id => getComputedStyle(document.getElementById(id)).userSelect)`);
  check('user-select: none overridden (stylesheet + inline !important)', userSelect.every((v) => v === 'text'), userSelect);

  const selBg = await driver.executeScript(`
    return getComputedStyle(document.getElementById('invisible-text'), '::selection').backgroundColor`);
  check('transparent ::selection overridden', selBg !== 'rgba(0, 0, 0, 0)', selBg);

  const selected = await selectElementText('noselect-text');
  check('mouse selection works despite selectstart blocker', selected.includes('select this sentence'), JSON.stringify(selected));

  await selectElementText('popup-text');
  const popupShown = await driver.executeScript(`return getComputedStyle(document.getElementById('popup')).display`);
  check('no selection popup', popupShown === 'none', popupShown);

  await driver.actions().contextClick(await find('copy-text')).perform();
  await driver.actions().sendKeys(Key.ESCAPE).perform();

  await selectElementText('copy-text');
  await driver.actions().keyDown(MOD).sendKeys('c').keyUp(MOD).perform();
  await clearInput('paste-input');
  await (await find('paste-input')).click();
  await driver.actions().keyDown(MOD).sendKeys('v').keyUp(MOD).perform();
  const pasted = await driver.findElement(By.id('paste-input')).getAttribute('value');
  check('copy is clean and paste into blocked input works',
    pasted.startsWith('Copy this.') && !pasted.includes('example.com'), JSON.stringify(pasted));

  // No pasting twice: every paste route into a hostile "confirm" field.
  const pasteInto = async (id, keys) => {
    // Clear like a user would (trusted input event), not via script.
    await (await find(id)).click();
    await driver.actions().keyDown(MOD).sendKeys('a').keyUp(MOD).sendKeys(Key.BACK_SPACE).perform();
    await keys();
  };
  await pasteInto('confirm-email', () => driver.actions().keyDown(MOD).sendKeys('v').keyUp(MOD).perform());
  const viaCtrlV = await (await find('confirm-email')).getAttribute('value');
  await pasteInto('confirm-email', () => driver.actions().keyDown(Key.SHIFT).sendKeys(Key.INSERT).keyUp(Key.SHIFT).perform());
  const viaShiftInsert = await (await find('confirm-email')).getAttribute('value');
  await pasteInto('confirm-email', () => driver.actions().keyDown(MOD).keyDown(Key.SHIFT).sendKeys('v').keyUp(Key.SHIFT).keyUp(MOD).perform());
  const viaPlainPaste = await (await find('confirm-email')).getAttribute('value');
  await pasteInto('delayed-clear', () => driver.actions().keyDown(MOD).sendKeys('v').keyUp(MOD).perform());
  await pasteInto('formatter', () => driver.actions().keyDown(MOD).sendKeys('v').keyUp(MOD).perform());
  await sleep(1500);
  const delayedValue = await (await find('delayed-clear')).getAttribute('value');
  const formatterValue = await (await find('formatter')).getAttribute('value');
  check('confirm field: Ctrl+V sticks', viaCtrlV.startsWith('Copy this.'), JSON.stringify(viaCtrlV));
  check('confirm field: Shift+Insert sticks', viaShiftInsert.startsWith('Copy this.'), JSON.stringify(viaShiftInsert));
  check('confirm field: Ctrl+Shift+V sticks', viaPlainPaste.startsWith('Copy this.'), JSON.stringify(viaPlainPaste));
  check('paste wiped later by a timer is put back', delayedValue.startsWith('Copy this.'), JSON.stringify(delayedValue));
  check('legit reformatting of a paste is left alone', formatterValue.startsWith('COPY THIS.'), JSON.stringify(formatterValue));

  await (await find('editor')).click();
  await driver.actions().keyDown(MOD).sendKeys('v').keyUp(MOD).perform();
  const editorText = await driver.findElement(By.id('editor')).getText();
  check('rich editor still handles its own paste', editorText.includes('COPY THIS.'), JSON.stringify(editorText));

  await driver.executeScript('window.scrollTo(0, 0)');
  await driver.findElement(By.tagName('h1')).click();
  await driver.actions().keyDown(Key.SHIFT).keyDown(MOD).sendKeys('i').keyUp(MOD).keyUp(Key.SHIFT).perform();

  const log = await pageLog();
  // Wiping happens in the page (we can't stop it), we put the value back afterwards.
  const blocked = log.filter((l) => l.startsWith('page') && l !== 'page showed selection popup' && !l.startsWith('page wiped'));
  check('page scripts never got to block anything', blocked.length === 0, JSON.stringify(blocked));
  check('page selection popup never fired', !log.includes('page showed selection popup'));
  check('editor handler ran', log.includes('editor handled paste'), JSON.stringify(log));

  // --- Allowlist this site: page gets its way again, live, no reload ---
  const original = await driver.getWindowHandle();
  // Marionette won't navigate content to moz-extension://, so open the tab from chrome.
  const before = await driver.getAllWindowHandles();
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript(`
    gBrowser.selectedTab = gBrowser.addTab(arguments[0], {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });`, `moz-extension://${ADDON_UUID}/popup.html`);
  await driver.setContext(firefox.Context.CONTENT);
  await sleep(1000);
  const extTab = (await driver.getAllWindowHandles()).find((h) => !before.includes(h));
  await driver.switchTo().window(extTab);
  await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    browser.storage.local.set({ allowlist: ['127.0.0.1'] }).then(() => done());`);
  await driver.close();
  await driver.switchTo().window(original);
  await sleep(500);

  await driver.executeScript('window.__log = []');
  await driver.actions().contextClick(await find('copy-text')).perform();
  const userSelectAfter = await driver.executeScript(
    `return getComputedStyle(document.getElementById('s-noselect')).userSelect`);
  const logAfter = await pageLog();
  check('allowlisted: page sees contextmenu again', logAfter.some((l) => l.includes('contextmenu')), JSON.stringify(logAfter));
  check('allowlisted: page CSS applies again', userSelectAfter === 'none', userSelectAfter);
} catch (error) {
  console.error(error);
  failures++;
} finally {
  await driver.quit();
  server.close();
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll good.');
process.exit(failures ? 1 : 0);
