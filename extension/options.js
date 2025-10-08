async function getSettings(){
  const res = await chrome.runtime.sendMessage({ type: 'get_settings' });
  return res?.settings || {};
}
async function setSettings(update){
  const res = await chrome.runtime.sendMessage({ type: 'set_settings', update });
  return res?.settings || {};
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

function parseGlossary(text){
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines){
    const s = line.trim();
    if (!s) continue;
    const m = s.split('->');
    if (m.length >= 2){
      out.push({ from: m[0].trim(), to: m.slice(1).join('->').trim() });
    }
  }
  return out;
}
function serializeGlossary(gloss){
  return (gloss || []).map(g => `${g.from} -> ${g.to}`).join('\n');
}

document.addEventListener('DOMContentLoaded', async () => {
  const s = await getSettings();
  const lang = document.getElementById('opt-lang');
  const autoload = document.getElementById('opt-autoload');
  const tone = document.getElementById('opt-tone');
  const conc = document.getElementById('opt-conc');
  const budget = document.getElementById('opt-budget');
  const provider = document.getElementById('opt-provider');
  const model = document.getElementById('opt-model');
  const modelList = document.getElementById('opt-model-suggestions');
  const apikey = document.getElementById('opt-apikey');
  const apiKeyRow = document.getElementById('row-apikey');
  const glossary = document.getElementById('opt-glossary');
  const panelCollapsed = document.getElementById('opt-panel-collapsed');
  const panelAutoHide = document.getElementById('opt-panel-autohide');
  const panelRemember = document.getElementById('opt-panel-remember');
  const sitesAlways = document.getElementById('opt-sites-always');
  const sitesNever = document.getElementById('opt-sites-never');
  const cacheMax = document.getElementById('opt-cache-max');
  const cacheStats = document.getElementById('opt-cache-stats');
  const btnClearCache = document.getElementById('btn-clear-cache');
  const btnExport = document.getElementById('btn-export');
  const btnImport = document.getElementById('btn-import');
  const fileImport = document.getElementById('file-import');
  const saveBtn = document.getElementById('btn-save');
  const saveState = document.getElementById('save-state');
  // Auth/billing removed

  lang.value = s.targetLang || 'ko';
  autoload.checked = !!s.translateOnLoad;
  tone.value = s.tone || '';
  conc.value = s.maxConcurrentBatches || 4;
  budget.value = (typeof s.batchCharBudget === 'number') ? s.batchCharBudget : 1200;
  provider.value = s.provider || 'openai';
  model.value = s.model || 'gpt-4.1-mini';
  apikey.value = await getApiKey(provider.value);
  glossary.value = serializeGlossary(s.glossary);
  // Panel defaults
  const p = s.panel || {};
  if (panelCollapsed) panelCollapsed.checked = !!p.collapsed;
  if (panelAutoHide) panelAutoHide.value = (typeof p.autoHideMs==='number' ? p.autoHideMs : 8000);
  if (panelRemember) panelRemember.checked = (p.rememberPos !== false);
  // Sites
  function serializeHosts(list){ return (Array.isArray(list) ? list : []).join('\n'); }
  function parseHosts(text){ return (text||'').split(/\r?\n/).map(x=>x.trim().toLowerCase().replace(/^www\./,'')).filter(Boolean); }
  if (sitesAlways) sitesAlways.value = serializeHosts((s.sites && s.sites.always) || []);
  if (sitesNever) sitesNever.value = serializeHosts((s.sites && s.sites.never) || []);
  // Cache
  if (cacheMax) cacheMax.value = (typeof s.cacheMaxItems === 'number' ? s.cacheMaxItems : 2000);
  async function refreshCacheStats(){ try{ const r = await chrome.runtime.sendMessage({ type:'get_cache_stats' }); if (r?.ok && cacheStats){ const dt = r.lastUpdated ? new Date(r.lastUpdated) : null; cacheStats.value = `items: ${r.count||0}, updated: ${dt?dt.toLocaleString(): '-'}`; if (cacheMax && typeof r.limit === 'number') cacheMax.value = r.limit; } } catch(_){} }
  refreshCacheStats();

  // Always BYOK mode: show API key input
  function renderBillingUI(){ if (apiKeyRow) apiKeyRow.style.display = ''; if (apikey) apikey.disabled = false; }

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
    if (def && (!model.value || !opts.includes(model.value))) {
      model.value = def;
    }
  }

  refreshModelSuggestions();
  renderBillingUI();

  provider.addEventListener('change', async () => {
    await setSettings({ provider: provider.value });
    apikey.value = await getApiKey(provider.value);
    await refreshModelSuggestions();
  });

  saveBtn.addEventListener('click', async () => {
    const updated = await setSettings({
      targetLang: lang.value.trim() || 'ko',
      translateOnLoad: autoload.checked,
      tone: tone.value.trim(),
      maxConcurrentBatches: Math.max(1, Math.min(10, parseInt(conc.value)||4)),
      batchCharBudget: Math.max(500, Math.min(12000, parseInt(budget.value)||3500)),
      provider: provider.value,
      model: model.value.trim() || 'gpt-4.1-mini',
      glossary: parseGlossary(glossary.value),
      sites: { always: parseHosts(sitesAlways && sitesAlways.value), never: parseHosts(sitesNever && sitesNever.value) },
      cacheMaxItems: Math.max(50, Math.min(20000, parseInt(cacheMax && cacheMax.value)||2000)),
      panel: {
        pinned: !!(p.pinned),
        collapsed: !!(panelCollapsed && panelCollapsed.checked),
        autoHideMs: Math.max(0, Math.min(60000, parseInt(panelAutoHide && panelAutoHide.value)||8000)),
        rememberPos: !!(panelRemember && panelRemember.checked),
        pos: (p.pos || { right: 20, bottom: 20 })
      }
    });
    await setApiKey(provider.value, apikey.value.trim());
    saveState.textContent = 'Saved';
    setTimeout(() => saveState.textContent = '', 1500);
    refreshCacheStats();
  });
  // No auth flows

  if (btnClearCache) btnClearCache.addEventListener('click', async () => { try{ await chrome.runtime.sendMessage({ type:'clear_cache' }); } catch(_){} refreshCacheStats(); });

  if (btnExport) btnExport.addEventListener('click', async () => {
    try{
      const full = await chrome.storage.local.get(null);
      const blob = new Blob([JSON.stringify(full, null, 2)], { type:'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'fluxtranslate-settings.json'; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    } catch(_){ }
  });
  if (btnImport) btnImport.addEventListener('click', () => { if (fileImport) fileImport.click(); });
  if (fileImport) fileImport.addEventListener('change', async () => {
    try{
      const f = fileImport.files && fileImport.files[0]; if (!f) return;
      const text = await f.text();
      const data = JSON.parse(text);
      // Overwrite everything we know
      await chrome.storage.local.clear();
      await chrome.storage.local.set(data || {});
      saveState.textContent = 'Imported'; setTimeout(() => saveState.textContent = '', 1500);
      location.reload();
    } catch(_){ }
  });
});
