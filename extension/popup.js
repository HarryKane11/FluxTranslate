async function getSettings(){
  try{
    const res = await chrome.runtime.sendMessage({ type: 'get_settings' });
    return res?.settings || {};
  } catch(e){
    console.warn('getSettings failed:', e);
    return {};
  }
}
async function setSettings(update){
  try{
    const res = await chrome.runtime.sendMessage({ type: 'set_settings', update });
    return res?.settings || {};
  } catch(e){
    console.warn('setSettings failed:', e);
    return {};
  }
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function isRestrictedUrl(url){
  if (!url) return true;
  const blocked = [
    'chrome://',
    'edge://',
    'about:',
    'view-source:',
    'devtools://',
    'chrome-extension://',
    'chrome-search://',
    'chrome-untrusted://',
    'chrome-error://',
    'moz-extension://',
    'opera://',
    'vivaldi://',
    'brave://',
    'file://',
    'https://chrome.google.com/webstore',
    'https://chromewebstore.google.com',
  ];
  return blocked.some(p => url.startsWith(p));
}

function isFatalMessagingError(msg){
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    m.includes('cannot access contents of the page') ||
    m.includes('cannot access contents of url') ||
    m.includes('extension manifest must request permission') ||
    m.includes('no tab with id') ||
    m.includes('the tab was closed') ||
    m.includes('url scheme') && m.includes('is not supported')
  );
}

async function hasContentScript(tabId){
  return new Promise((resolve) => {
    try{
      chrome.tabs.sendMessage(tabId, { type: '__ft_ping__' }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) return resolve(false);
        resolve(!!(res && res.ok));
      });
    } catch(_){ resolve(false); }
  });
}

async function injectContentScript(tabId){
  try{
    if (await hasContentScript(tabId)) return true;
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['contentScript.js'] });
    return true;
  } catch(e){
    console.warn('Content script injection failed:', e);
    return false;
  }
}

async function sendToTabWithRetry(tab, message, retries = 3){
  if (!tab?.id) return null;
  if (isRestrictedUrl(tab.url || '')) return null;

  function sendOnce(){
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, message, (res) => {
        const err = chrome.runtime.lastError;
        if (err){
          resolve({ ok:false, err });
        } else {
          resolve({ ok:true, res });
        }
      });
    });
  }

  for (let i = 0; i <= retries; i++){
    const r = await sendOnce();
    if (r.ok) return r.res;
    if (isFatalMessagingError(r.err && r.err.message || '')){
      console.warn('tabs.sendMessage aborted:', r.err && r.err.message);
      return null;
    }
    // On failure, attempt injection, then wait and retry with backoff
    await injectContentScript(tab.id);
    await sleep(120 + i*150);
  }
  console.warn('tabs.sendMessage failed after retries');
  return null;
}

async function getApiKey(provider){
  const keyName = {
    openai: 'providers.openai.apiKey',
    anthropic: 'providers.anthropic.apiKey',
    gemini: 'providers.gemini.apiKey',
    groq: 'providers.groq.apiKey',
  }[provider];
  const obj = await chrome.storage.local.get(keyName);
  return obj[keyName] || '';
}
async function setApiKey(provider, value){
  const keyName = {
    openai: 'providers.openai.apiKey',
    anthropic: 'providers.anthropic.apiKey',
    gemini: 'providers.gemini.apiKey',
    groq: 'providers.groq.apiKey',
  }[provider];
  await chrome.storage.local.set({ [keyName]: value });
}

document.addEventListener('DOMContentLoaded', async () => {
  const s = await getSettings();
  // Main UI (always visible; no auth)
  const lang = document.getElementById('inp-lang');
  const tone = document.getElementById('inp-tone');
  const provider = document.getElementById('sel-provider');
  const model = document.getElementById('inp-model');
  const modelList = document.getElementById('model-suggestions');
  const apikey = document.getElementById('inp-apikey');
  const apiKeyRow = document.getElementById('row-apikey');
  const autoload = document.getElementById('chk-autoload');
  const siteAlways = document.getElementById('chk-site-always');
  const siteNever = document.getElementById('chk-site-never');
  const btnTranslate = document.getElementById('btn-translate');
  const btnRestore = document.getElementById('btn-restore');
  const panelPinned = null;
  const panelHidden = null;

  function applyMainState(){
    if (lang) lang.value = s.targetLang || '';
    if (tone) tone.value = s.tone || '';
    if (provider) provider.value = s.provider || 'openai';
    if (model) model.value = s.model || '';
    if (autoload) autoload.checked = !!s.translateOnLoad;
  }
  applyMainState();
  if (apikey) apikey.value = await getApiKey(provider.value);

  // Current site host
  let currentHost = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url){
      try { const u = new URL(tab.url); currentHost = (u.hostname || '').toLowerCase().replace(/^www\./,''); } catch {}
    }
  } catch {}

  function syncSiteToggles(){
    const sAlways = (s.sites && s.sites.always) || [];
    const sNever = (s.sites && s.sites.never) || [];
    if (siteAlways) siteAlways.checked = !!(currentHost && sAlways.includes(currentHost));
    if (siteNever) siteNever.checked = !!(currentHost && sNever.includes(currentHost));
    // mutually exclusive UI
    if (siteAlways && siteNever){
      if (siteAlways.checked) siteNever.checked = false;
      if (siteNever.checked) siteAlways.checked = false;
    }
    // panel toggles removed from popup UI
  }
  syncSiteToggles();

  async function refreshModelSuggestions() {
    if (!modelList) return;
    while (modelList.firstChild) modelList.removeChild(modelList.firstChild);
    let opts = [];
    let def = '';
    try{
      const res = await chrome.runtime.sendMessage({ type: 'get_model_options', provider: provider.value });
      if (res?.ok){ opts = res.options || []; def = res.default || ''; }
    } catch(_){ }
    for (const id of opts) {
      const opt = document.createElement('option');
      opt.value = id;
      modelList.appendChild(opt);
    }
    if (def && !opts.includes(model.value)) {
      model.value = def;
      try{ await setSettings({ model: model.value }); } catch(_){ }
    }
  }

  refreshModelSuggestions();
  render();

  function render(){ if (apiKeyRow) apiKeyRow.style.display = ''; }

  // Disable actions on restricted pages to avoid futile retries
  try{
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || isRestrictedUrl(tab.url || '')){
      btnTranslate.setAttribute('disabled', 'true');
      btnRestore.setAttribute('disabled', 'true');
      btnTranslate.title = 'Translation is unavailable on this page.';
      btnRestore.title = 'Translation is unavailable on this page.';
    }
  } catch {}

  provider.addEventListener('change', async () => {
    await setSettings({ provider: provider.value });
    apikey.value = await getApiKey(provider.value);
    await refreshModelSuggestions();
  });
  model.addEventListener('change', () => setSettings({ model: model.value }));
  lang.addEventListener('change', () => setSettings({ targetLang: lang.value }));
  tone.addEventListener('change', () => setSettings({ tone: tone.value }));
  document.getElementById('btn-tone-save').addEventListener('click', async (e) => {
    e.preventDefault();
    const val = (tone.value || '').trim();
    await setSettings({ customTone: val });
    const btn = e.currentTarget;
    if (btn && btn instanceof HTMLElement){
      const old = btn.textContent;
      btn.textContent = 'Saved';
      setTimeout(() => { btn.textContent = old || 'Save as Custom'; }, 900);
    }
  });
  autoload.addEventListener('change', () => setSettings({ translateOnLoad: autoload.checked }));
  if (siteAlways) siteAlways.addEventListener('change', async () => {
    try{
      const cur = (await getSettings()).sites || { always: [], never: [] };
      const host = currentHost; if (!host) return;
      const a = new Set(cur.always || []); const n = new Set(cur.never || []);
      if (siteAlways.checked){ a.add(host); n.delete(host); } else { a.delete(host); }
      await setSettings({ sites: { always: Array.from(a), never: Array.from(n) } });
    } catch {}
    syncSiteToggles();
  });
  if (siteNever) siteNever.addEventListener('change', async () => {
    try{
      const cur = (await getSettings()).sites || { always: [], never: [] };
      const host = currentHost; if (!host) return;
      const a = new Set(cur.always || []); const n = new Set(cur.never || []);
      if (siteNever.checked){ n.add(host); a.delete(host); } else { n.delete(host); }
      await setSettings({ sites: { always: Array.from(a), never: Array.from(n) } });
    } catch {}
    syncSiteToggles();
  });

  // panel toggles removed from popup UI
  if (apikey) apikey.addEventListener('change', () => setApiKey(provider.value, apikey.value));

  document.getElementById('btn-translate').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id){ window.close(); return; }
    if (isRestrictedUrl(tab.url || '')){ window.close(); return; }
    await sendToTabWithRetry(tab, { type: 'translate_page' });
    window.close();
  });
  document.getElementById('btn-restore').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id){ window.close(); return; }
    if (isRestrictedUrl(tab.url || '')){ window.close(); return; }
    await sendToTabWithRetry(tab, { type: 'restore_page' });
    window.close();
  });
  document.getElementById('btn-clear-cache').addEventListener('click', async () => {
    try{ await chrome.runtime.sendMessage({ type: 'clear_cache' }); } catch(e){ console.warn('clear_cache failed:', e); }
    window.close();
  });
  document.getElementById('btn-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  // Billing removed

  // No auth flows
});
