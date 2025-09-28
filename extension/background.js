// FluxTranslate background service worker (MV3)
// - Handles LLM provider calls
// - Manages context menus, omnibox, messages
// - Stores settings, simple cache, and glossary

const DEFAULT_SETTINGS = {
  targetLang: 'ko',
  tone: '간결하고 자연스러운 번역, 어투는 전문적이되 친근하게',
  customTone: '',
  provider: 'openai', // 'openai' | 'anthropic' | 'gemini' | 'groq'
  model: 'gpt-4.1-mini',
  translateOnLoad: false,
  maxConcurrentBatches: 6,
  batchCharBudget: 1200,
  glossary: [], // [{from:'term', to:'번역어'}]
};

const PROVIDER_KEYS = {
  openai: 'providers.openai.apiKey',
  anthropic: 'providers.anthropic.apiKey',
  gemini: 'providers.gemini.apiKey',
  groq: 'providers.groq.apiKey',
};

const PROVIDERS = ['openai', 'anthropic', 'gemini', 'groq'];
const MODEL_OPTIONS = {
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-1-20250805'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  groq: [
    'llama-3.1-8b-instant',
    'llama-3.3-70b-versatile',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
  ],
};
const DEFAULT_MODEL = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.5-flash-lite',
  groq: 'llama-3.3-70b-versatile',
};

const STORAGE_KEYS = {
  settings: 'settings',
  cache: 'cache',
};

const LRU_MAX_ITEMS = 2000;

// Utilities
function stableHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  // return as hex
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function parseRetryAfterMs(res, bodyText){
  try{
    // Prefer standard header if present
    const h = res && (res.headers.get('retry-after') || res.headers.get('Retry-After'));
    if (h){
      const v = String(h).trim();
      const n = Number(v);
      if (!Number.isNaN(n)) return (n < 50 ? n*1000 : n); // seconds or ms heuristic
      // HTTP-date not handled; fall through
    }
  } catch(_){ }
  try{
    // Parse common pattern in error messages: "try again in X.s"
    const m = /try again in\s+([0-9]+(?:\.[0-9]+)?)s/i.exec(String(bodyText||''));
    if (m){
      const secs = parseFloat(m[1]);
      if (!Number.isNaN(secs)) return Math.max(200, Math.round(secs*1000));
    }
  } catch(_){ }
  return 0;
}

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

async function getSettings() {
  const { settings } = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function setSettings(update) {
  const current = await getSettings();
  let merged = { ...current, ...update };
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: merged });
  return merged;
}

async function getCache() {
  const { cache } = await chrome.storage.local.get(STORAGE_KEYS.cache);
  return cache || { order: [], map: {} };
}

async function putCache(key, value) {
  const cache = await getCache();
  if (!cache.map) cache.map = {};
  if (!cache.order) cache.order = [];
  if (!(key in cache.map)) cache.order.push(key);
  cache.map[key] = { value, t: Date.now() };
  while (cache.order.length > LRU_MAX_ITEMS) {
    const k = cache.order.shift();
    delete cache.map[k];
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.cache]: cache });
}

async function getFromCache(key) {
  const cache = await getCache();
  if (cache.map && cache.map[key]) {
    cache.map[key].t = Date.now();
    await chrome.storage.local.set({ [STORAGE_KEYS.cache]: cache });
    return cache.map[key].value;
  }
  return undefined;
}

function applyGlossaryLocal(text, glossary) {
  if (!glossary || !glossary.length) return text;
  // simple whole-word replace, case-sensitive; can be enhanced
  for (const { from, to } of glossary) {
    if (!from || !to) continue;
    const safe = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\b${safe}\\b`, 'g'), to);
  }
  return text;
}

function buildSystemPrompt(targetLang, tone, glossary) {
  const glossaryGuide = (glossary && glossary.length)
    ? `\nGlossary mapping (apply consistently):\n${glossary.map(g => `- "${g.from}" -> "${g.to}"`).join('\n')}`
    : '';
  return [
    `You are a world-class translator specialized in highly accurate, natural translations.`,
    `Output ONLY strict JSON per instructions.`,
    `Target language: ${targetLang}.`,
    `Tone/style: ${tone}.`,
    `Preserve meaning, nuance, proper nouns, numbers, and inline conventions.`,
    `Do not add explanations. Keep formatting suitable for UI text.`,
    `Return a JSON object: {"items": [{"id":"<id>", "t":"<translation>"}, ...]}.`,
    `Ensure the number and order of items matches the input.`,
    glossaryGuide,
  ].join('\n');
}

function buildUserJSONPayload(items) {
  // items: [{id, text}]
  return {
    instruction: 'Translate each input text to the target language and tone. Return strict JSON.',
    items: items.map(x => ({ id: String(x.id), text: String(x.text) })),
  };
}

// Provider adapters
async function callOpenAI(apiKey, model, sys, payload) {
  const body = {
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '{}';
  return safeJson(text);
}

async function callAnthropic(apiKey, model, sys, payload) {
  const body = {
    model,
    max_tokens: 4096,
    temperature: 0.2,
    system: sys,
    messages: [
      { role: 'user', content: [{ type: 'text', text: JSON.stringify(payload) }] },
    ],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data?.content?.[0]?.text || '{}';
  return safeJson(text);
}

async function callGemini(apiKey, model, sys, payload) {
  // Gemini REST API 사용 (웹 환경에서는 SDK 대신 직접 REST 호출)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      { role: 'user', parts: [{ text: `${sys}\n\n${JSON.stringify(payload)}` }] }
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  return safeJson(text);
}

async function callGroq(apiKey, model, sys, payload) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const reqBody = {
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  };
  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(reqBody),
  };

  let lastErrText = '';
  for (let attempt = 0; attempt < 4; attempt++){
    const res = await fetch(url, init);
    if (res.ok){
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '{}';
      return safeJson(text);
    }

    const status = res.status;
    const text = await res.text().catch(() => '');
    lastErrText = text || `HTTP ${status}`;
    if (status === 429){
      const serverWait = parseRetryAfterMs(res, text);
      const base = 400 * (2 ** attempt);
      const jitter = Math.floor(Math.random() * 200);
      const waitMs = Math.max(serverWait, base) + jitter;
      await sleep(waitMs);
      continue; // retry
    }
    // other errors: no retry
    throw new Error(`Groq error: ${status} ${text}`);
  }
  throw new Error(`Groq error: 429 ${lastErrText}`);
}

function safeJson(text){
  if (!text) return { items: [] };
  const trimmed = String(text).trim();
  try{ return JSON.parse(trimmed); } catch{}
  // Try to extract JSON block
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first){
    const sub = trimmed.slice(first, last+1);
    try{ return JSON.parse(sub); } catch{}
  }
  return { items: [] };
}

async function translateBatchWithProvider(provider, model, apiKey, targetLang, tone, glossary, items) {
  const sys = buildSystemPrompt(targetLang, tone, glossary);
  const payload = buildUserJSONPayload(items);
  if (provider === 'openai') return callOpenAI(apiKey, model, sys, payload);
  if (provider === 'anthropic') return callAnthropic(apiKey, model, sys, payload);
  if (provider === 'gemini') return callGemini(apiKey, model, sys, payload);
  if (provider === 'groq') return callGroq(apiKey, model, sys, payload);
  throw new Error(`Unsupported provider: ${provider}`);
}

async function getApiKey(provider) {
  const keyName = PROVIDER_KEYS[provider];
  const obj = await chrome.storage.local.get(keyName);
  return obj[keyName];
}

// Context Menus
chrome.runtime.onInstalled.addListener(() => {
  try { chrome.contextMenus.removeAll(); } catch {}
  chrome.contextMenus.create({ id: 'ft-translate-page', title: 'Translate page with FluxTranslate', contexts: ['page', 'action'] });
  chrome.contextMenus.create({ id: 'ft-translate-selection', title: 'Translate selection with FluxTranslate', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'ft-restore-page', title: 'Restore original page text', contexts: ['page', 'action'] });
  // Ensure defaults (and userId) are stored
  setSettings({});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (isRestrictedUrl(tab.url || '')) return;
  if (info.menuItemId === 'ft-translate-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'translate_page' });
  } else if (info.menuItemId === 'ft-translate-selection') {
    chrome.tabs.sendMessage(tab.id, { type: 'translate_selection' });
  } else if (info.menuItemId === 'ft-restore-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'restore_page' });
  }
});

// Omnibox: type "xl8" then Enter to translate the current page fast
chrome.omnibox.onInputEntered.addListener(async (_text, onInputEntered) => {
  // Just trigger translate for active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && !isRestrictedUrl(tab.url || '')) {
    chrome.tabs.sendMessage(tab.id, { type: 'translate_page' });
  }
});

// Commands (keyboard shortcuts) mapping in manifest can be added later if needed

// Messages bridge with content script and popup/options
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'get_providers') {
        sendResponse({ ok: true, providers: PROVIDERS.slice() });
        return;
      }

      // login flow removed (no Clerk / managed auth)

      if (msg?.type === 'get_model_options') {
        const p = (msg && msg.provider) || (await getSettings()).provider || 'openai';
        const opts = MODEL_OPTIONS[p] || [];
        const def = DEFAULT_MODEL[p] || '';
        sendResponse({ ok: true, provider: p, options: opts, default: def });
        return;
      }
      if (msg?.type === 'get_settings') {
        const s = await getSettings();
        sendResponse({ ok: true, settings: s });
        return;
      }

      if (msg?.type === 'set_settings') {
        const s = await setSettings(msg.update || {});
        // If provider changed and model is not in allowed list, coerce to default
        try {
          const p = s.provider;
          const opts = MODEL_OPTIONS[p] || [];
          if (s.model && !opts.includes(s.model)) {
            const next = DEFAULT_MODEL[p] || opts[0] || s.model;
            const coerced = await setSettings({ model: next });
            sendResponse({ ok: true, settings: coerced });
            return;
          }
        } catch(_){ }
        sendResponse({ ok: true, settings: s });
        return;
      }

      if (msg?.type === 'translate_batch') {
        const s = await getSettings();
        // Local cache check per item
        const results = [];
        const items = [];
        for (const it of msg.items || []) {
          const key = stableHash([it.text, s.targetLang, s.tone, s.provider, s.model].join('|'));
          const cached = await getFromCache(key);
          if (cached) {
            results.push({ id: it.id, t: cached, cached: true });
          } else {
            items.push({ id: it.id, text: it.text });
          }
        }

        if (items.length) {
          const apiKey = await getApiKey(s.provider);
          if (!apiKey) throw new Error('Missing API key. Open Options and set your provider API key.');
          const response = await translateBatchWithProvider(s.provider, s.model, apiKey, s.targetLang, s.tone, s.glossary, items);
          const merged = response?.items || [];
          for (const r of merged) {
            const orig = items.find(x => String(x.id) === String(r.id));
            if (!orig) continue;
            let out = String(r.t ?? '');
            out = applyGlossaryLocal(out, s.glossary);
            const key = stableHash([orig.text, s.targetLang, s.tone, s.provider, s.model].join('|'));
            await putCache(key, out);
            results.push({ id: orig.id, t: out, cached: false });
          }
        }

        sendResponse({ ok: true, items: results });
        return;
      }

      if (msg?.type === 'clear_cache') {
        await chrome.storage.local.set({ [STORAGE_KEYS.cache]: { order: [], map: {} } });
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === 'open_options') {
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: 'Unknown message' });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // async response
});

// Streaming translation via Port API
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ft-stream') return;
  let alive = true;
  try { port.onDisconnect.addListener(() => { alive = false; }); } catch(_){}
  const tryPost = (msg) => { if (!alive) return; try { port.postMessage(msg); } catch(_){ /* ignore closed port */ } };
  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== 'translate_stream') return;
    try {
      const s = await getSettings();
      const apiKey = await getApiKey(s.provider);
      if (!apiKey) { tryPost({ type: 'error', error: 'Missing API key. Open Options and set your provider API key.' }); tryPost({ type: 'done' }); return; }

      const allItems = Array.isArray(msg.items) ? msg.items : [];
      const toTranslate = [];

      // Push cached immediately
      for (const it of allItems) {
        if (!alive) return;
        const key = stableHash([it.text, s.targetLang, s.tone, s.provider, s.model].join('|'));
        const cached = await getFromCache(key);
        if (cached) {
          tryPost({ type: 'item', id: it.id, t: cached, cached: true });
        } else {
          toTranslate.push({ id: it.id, text: it.text });
        }
      }

      if (!alive) return;
      // Chunk by character budget
      const maxConcurrent = s.maxConcurrentBatches || 4;
      const budget = s.batchCharBudget || 1200;
      const batches = [];
      let cur = [];
      let len = 0;
      for (const it of toTranslate) {
        if (!alive) return;
        const L = (it.text?.length || 0) + 8;
        if (cur.length && len + L > budget) {
          batches.push(cur);
          cur = [];
          len = 0;
        }
        cur.push(it);
        len += L;
      }
      if (cur.length) batches.push(cur);

      async function runBatch(batch) {
        if (!alive) return;
        try {
          const response = await translateBatchWithProvider(s.provider, s.model, apiKey, s.targetLang, s.tone, s.glossary, batch);
          if (!alive) return;
          for (const r of (response?.items || [])) {
            const orig = batch.find(x => String(x.id) === String(r.id));
            if (!orig) continue;
            let out = String(r.t ?? '');
            out = applyGlossaryLocal(out, s.glossary);
            const key = stableHash([orig.text, s.targetLang, s.tone, s.provider, s.model].join('|'));
            await putCache(key, out);
            if (!alive) return;
            tryPost({ type: 'item', id: orig.id, t: out, cached: false });
          }
        } catch (err) {
          if (!alive) return;
          tryPost({ type: 'error', error: String(err?.message || err) });
        }
      }

      const queue = batches.slice();
      const workers = new Array(Math.min(maxConcurrent, Math.max(1, queue.length))).fill(0).map(async () => {
        while (queue.length && alive) {
          const b = queue.shift();
          await runBatch(b);
        }
      });
      await Promise.allSettled(workers);
      if (alive) tryPost({ type: 'done' });
    } catch (err) {
      tryPost({ type: 'error', error: String(err?.message || err) });
      tryPost({ type: 'done' });
    }
  });
});
