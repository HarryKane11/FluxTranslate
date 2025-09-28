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
  const saveBtn = document.getElementById('btn-save');
  const saveState = document.getElementById('save-state');
  // Auth/billing removed

  lang.value = s.targetLang || 'ko';
  autoload.checked = !!s.translateOnLoad;
  tone.value = s.tone || '';
  conc.value = s.maxConcurrentBatches || 4;
  budget.value = s.batchCharBudget || 3500;
  provider.value = s.provider || 'openai';
  model.value = s.model || 'gpt-4.1-mini';
  apikey.value = await getApiKey(provider.value);
  glossary.value = serializeGlossary(s.glossary);

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
    });
    await setApiKey(provider.value, apikey.value.trim());
    saveState.textContent = 'Saved';
    setTimeout(() => saveState.textContent = '', 1500);
  });
  // No auth flows
});
