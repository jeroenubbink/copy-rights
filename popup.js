'use strict';

const $ = (id) => document.getElementById(id);

async function currentTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function setAllowlist(fn) {
  const { allowlist = [] } = await browser.storage.local.get('allowlist');
  await browser.storage.local.set({ allowlist: fn(allowlist) });
}

async function render() {
  const tab = await currentTab();
  const status = await browser.runtime.sendMessage({ type: 'status', url: tab?.url || '' });

  $('enabled').checked = status.enabled;

  const supported = /^(https?|file):/.test(tab?.url || '');
  const guarded = status.enabled && !status.allowlisted && supported;
  $('status').innerHTML = '';
  const strong = document.createElement('strong');
  strong.className = guarded ? 'on' : 'off';
  strong.textContent = guarded ? 'Guarding' : 'Not guarding';
  $('status').append(strong, ` ${status.host || 'this page'}`);

  const toggle = $('toggle-site');
  toggle.disabled = !supported || !status.host;
  toggle.textContent = status.allowlisted
    ? `Guard ${status.host} again`
    : `Let ${status.host || 'this site'} do its thing`;
  toggle.onclick = async () => {
    await setAllowlist((list) => status.allowlisted
      ? list.filter((h) => h !== status.host)
      : [...new Set([...list, status.host])]);
    render();
  };

  const ul = $('allowlist');
  ul.replaceChildren();
  for (const host of status.allowlist) {
    const li = document.createElement('li');
    const remove = document.createElement('button');
    remove.textContent = 'Guard';
    remove.title = `Guard ${host} again`;
    remove.onclick = async () => {
      await setAllowlist((list) => list.filter((h) => h !== host));
      render();
    };
    li.append(host, remove);
    ul.append(li);
  }
  $('empty').hidden = status.allowlist.length > 0;

  const granted = await browser.permissions.contains({ origins: ['<all_urls>'] });
  $('permission').hidden = granted;
}

$('enabled').addEventListener('change', async (e) => {
  await browser.storage.local.set({ enabled: e.target.checked });
  render();
});

$('grant').addEventListener('click', async () => {
  await browser.permissions.request({ origins: ['<all_urls>'] });
  render();
});

render();
