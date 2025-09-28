(() => {
  const ATTR = { processed: 'data-ft-processed', original: 'data-ft-original', id: 'data-ft-id', translated: 'data-ft-translated' };
  const PANEL_ID = 'ft-panel';
  const AVOID_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','OBJECT','CANVAS','SVG','MATH','CODE','PRE','TEXTAREA','INPUT','SELECT','OPTION']);
  const PARA_TAGS = new Set(['P','DIV','ARTICLE','SECTION','ASIDE','MAIN','LI','BLOCKQUOTE']);

  let settings = null;
  let enabled = true;
  let progressEl = null;
  let observer = null;
  let observeActive = false;
  let pendingNodes = new Set();
  let debounceTimer = null;
  let translateInProgress = false;
  let currentPort = null;
  let currentCancel = null;
  let highlightEl = null;
  let lastHoverContainer = null;
  let ctrlActive = false;

  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  const ensureSettings = async () => {
    if (settings) return settings;
    try{ const r = await chrome.runtime.sendMessage({ type: 'get_settings' }); settings = r?.settings || {}; return settings; } catch { settings = {}; return settings; }
  };
  const updateSettings = async (patch) => { try{ const r = await chrome.runtime.sendMessage({ type: 'set_settings', update: patch }); if (r?.ok) settings = r.settings; } catch{} };

  const injectStylesOnce = () => {
    if (document.getElementById('ft-styles')) return;
    const style = document.createElement('style');
    style.id = 'ft-styles';
    style.textContent = `
      .ft-shimmer{ display:inline-block; background: linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.12), rgba(0,0,0,0.06)); background-size: 200% 100%; animation: ft-sh 1.2s ease-in-out infinite; color: transparent; border-radius: 4px; }
      @keyframes ft-sh{ 0%{ background-position: 0 0; } 100%{ background-position: -200% 0; } }
      .ft-progress{ position:fixed; right:20px; bottom:20px; z-index:2147483646; display:flex; gap:8px; align-items:center; background: rgba(255,255,255,0.66); backdrop-filter: blur(10px); border: 1px solid rgba(0,0,0,0.08); border-radius: 16px; padding: 10px 12px; box-shadow: 0 12px 30px rgba(0,0,0,0.18); color:#0a0a0a; }
      .ft-bar{ height:6px; width:120px; background: rgba(0,0,0,0.1); border-radius:6px; overflow:hidden; }
      .ft-bar>span{ display:block; height:100%; width:0; background: linear-gradient(90deg,#22c55e,#a3e635); transition: width .2s ease; }
      .ft-btn{ cursor:pointer; font-size:12px; padding:6px 10px; border-radius:10px; border: 1px solid rgba(0,0,0,0.08); background: rgba(255,255,255,0.9); }
      .ft-fab{ width: 40px; height: 40px; min-width:40px; min-height:40px; border-radius: 999px; border: none; background-color: transparent; background-size: contain; background-repeat: no-repeat; background-position: center; cursor: pointer; }
      .ft-highlight{ position:fixed; z-index:2147483646; pointer-events:none; border-radius:12px; outline:2px solid rgba(124,58,237,.85); box-shadow: 0 10px 30px rgba(124,58,237,.28), inset 0 0 0 1px rgba(255,255,255,.45); background: rgba(124,58,237,.08); transition: top .08s ease, left .08s ease, width .08s ease, height .08s ease, opacity .08s ease; opacity:0; }
      .ft-highlight.show{ opacity:1; }
      html.ft-ctrl-cursor, html.ft-ctrl-cursor *{ cursor: zoom-in !important; }
    `;
    document.documentElement.appendChild(style);
  };

  const ensureProgress = () => {
    let isTop = true; try { isTop = (window.top === window); } catch (_) { isTop = true; }
    if (!isTop) return null;
    const existing = document.getElementById(PANEL_ID); if (existing) { progressEl = existing; return existing; }
    const el = document.createElement('div'); el.id = PANEL_ID; el.className = 'ft-progress'; el.setAttribute('data-ft-ui','1');
    el.innerHTML = `
      <button class="ft-fab" data-action="toggle" title="FluxTranslate"></button>
      <div class="ft-bar"><span></span></div>
      <button class="ft-btn" data-action="close" title="Close">×</button>
    `;
    el.addEventListener('click', (e) => { const t = e.target; if (!(t instanceof HTMLElement)) return; const a = t.getAttribute('data-action'); if (a === 'close'){ e.preventDefault(); e.stopPropagation(); el.style.display='none'; return; } if (a === 'toggle'){ e.preventDefault(); e.stopPropagation(); return; } e.stopPropagation(); });
    document.body.appendChild(el);
    try{ const url = chrome.runtime.getURL('assets/icon_togle.png'); const fab = el.querySelector('.ft-fab'); if (fab) fab.style.backgroundImage = `url('${url}')`; } catch{}
    progressEl = el; return el;
  };

  const updateProgress = (done, total) => { const el = ensureProgress(); if (!el) return; const bar = el.querySelector('.ft-bar>span'); if (bar) bar.style.width = total > 0 ? `${Math.round((done/total)*100)}%` : '0%'; };
  const setProgressVisible = (v) => { if (!progressEl) { if (v) ensureProgress(); else return; } if (progressEl) progressEl.style.display = v ? 'flex' : 'none'; };

  const ensureHighlight = () => { let isTop = true; try { isTop = (window.top === window); } catch (_) { isTop = true; } if (!isTop) return null; if (highlightEl && document.body.contains(highlightEl)) return highlightEl; const el = document.createElement('div'); el.id = 'ft-highlight'; el.className = 'ft-highlight'; el.setAttribute('data-ft-ui', '1'); el.style.display = 'none'; document.body.appendChild(el); highlightEl = el; return el; };
  const hideHighlight = () => { const el = ensureHighlight(); if (!el) return; el.classList.remove('show'); el.style.display = 'none'; lastHoverContainer = null; };
  const showHighlightFor = (container) => { if (!container) { hideHighlight(); return; } const el = ensureHighlight(); if (!el) return; const r = container.getBoundingClientRect(); if (r.width < 4 || r.height < 4) { hideHighlight(); return; } el.style.left = `${Math.max(0, r.left)}px`; el.style.top = `${Math.max(0, r.top)}px`; el.style.width = `${Math.max(0, r.width)}px`; el.style.height = `${Math.max(0, r.height)}px`; el.style.display = 'block'; requestAnimationFrame(() => el.classList.add('show')); lastHoverContainer = container; };

  const getTextNodes = (root) => {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const p = node.parentElement; if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest('#' + PANEL_ID + ', [data-ft-ui="1"]')) return NodeFilter.FILTER_REJECT;
        if (AVOID_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        const val = (node.nodeValue||'').trim(); if (val.length < 2) return NodeFilter.FILTER_REJECT;
        if (p.closest('[contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let cur; while ((cur = walker.nextNode())) nodes.push(cur); return nodes;
  };
  const nearestContainer = (el) => { let cur = el; while (cur && cur !== document.body){ if (cur instanceof Element && PARA_TAGS.has(cur.tagName)) return cur; cur = cur.parentElement; } return null; };
  const findTranslatableContainer = (el) => { const c = nearestContainer(el); if (!c) return null; if (!getTextNodes(c).length) return null; return c; };

  const wrapShimmer = (textNode, id) => { const span = document.createElement('span'); span.setAttribute(ATTR.processed, '1'); span.setAttribute(ATTR.id, id); const orig = textNode.nodeValue || ''; span.setAttribute(ATTR.original, orig); span.className = 'ft-shimmer'; span.textContent = orig; const p = textNode.parentNode; if (p) p.replaceChild(span, textNode); return span; };
  const restoreSpan = (span) => { const orig = span.getAttribute(ATTR.original) || ''; const p = span.parentNode; if (!p) return; const tn = document.createTextNode(orig); p.replaceChild(tn, span); };
  const applyTranslation = (span, text) => { span.textContent = String(text||''); span.classList.remove('ft-shimmer'); span.setAttribute(ATTR.translated, '1'); };

  const chunkItems = (items, budget) => { const batches = []; let cur = []; let len = 0; for (const it of items){ const L = (it.text?.length || 0) + 8; if (cur.length && len + L > budget) { batches.push(cur); cur = []; len = 0; } cur.push(it); len += L; } if (cur.length) batches.push(cur); return batches; };

  const translateViaPort = (idToSpan, items, cancel) => new Promise((resolve) => {
    const total = items.length; let done = 0; updateProgress(0, total);
    try{ const port = chrome.runtime.connect({ name: 'ft-stream' }); currentPort = port; try { port.onDisconnect.addListener(() => { try{ if (cancel) cancel.cancelled = true; } catch{} resolve(); }); } catch{}
      port.onMessage.addListener((msg) => { if (!msg || !msg.type) return; if (cancel?.cancelled) return; if (msg.type === 'item'){ const span = idToSpan.get(String(msg.id)); if (span){ applyTranslation(span, msg.t); done++; updateProgress(done, total); } } else if (msg.type === 'error'){ console.warn('FluxTranslate stream error:', msg.error); } else if (msg.type === 'done'){ resolve(); } });
      port.postMessage({ type: 'translate_stream', items });
    } catch { legacyBatches(idToSpan, items, cancel).finally(resolve); }
  });

  const legacyBatches = async (idToSpan, items, cancel) => {
    const maxConcurrent = (settings && settings.maxConcurrentBatches) || 4;
    const budget = (settings && settings.batchCharBudget) || 1200;
    const batches = chunkItems(items, budget);
    let done = 0; const total = items.length; updateProgress(done, total);
    async function runOne(batch){ if (cancel?.cancelled) return; const res = await chrome.runtime.sendMessage({ type: 'translate_batch', items: batch }); if (!res?.ok) throw new Error(res?.error || 'Translation failed'); for (const r of res.items){ if (cancel?.cancelled) return; const span = idToSpan.get(String(r.id)); if (!span) continue; applyTranslation(span, r.t); done++; updateProgress(done, total); } }
    const queue = batches.slice(); const workers = new Array(Math.min(maxConcurrent, queue.length)).fill(0).map(async () => { while (queue.length){ if (cancel?.cancelled) break; const b = queue.shift(); await runOne(b); } });
    await Promise.allSettled(workers);
  };

  const translateViaStream = async (idToSpan, items, cancel) => translateViaPort(idToSpan, items, cancel);

  const translateNodes = async (nodes) => {
    if (!nodes.length) return;
    const idToSpan = new Map(); const items = []; let idx = 0;
    for (const n of nodes){ if (n.parentElement && n.parentElement.hasAttribute(ATTR.processed)) continue; const id = `n${Date.now().toString(36)}_${idx++}`; const span = wrapShimmer(n, id); idToSpan.set(id, span); items.push({ id, text: span.getAttribute(ATTR.original) || '' }); }
    setProgressVisible(true); translateInProgress = true; currentCancel = { cancelled:false };
    try { await translateViaStream(idToSpan, items, currentCancel); } finally { translateInProgress = false; currentCancel = null; }
  };

  const translatePage = async () => { const nodes = getTextNodes(document.body).slice(0, 800); await translateNodes(nodes); startObserver(); };
  const translateSelection = async () => { const sel = window.getSelection && window.getSelection(); const targets = new Set(); if (sel && sel.rangeCount){ for (let i = 0; i < sel.rangeCount; i++){ const r = sel.getRangeAt(i); if (r){ const c = nearestContainer(r.commonAncestorContainer instanceof Element ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement); if (c) targets.add(c); } } } const arr = Array.from(targets); if (!arr.length) return; const nodes = arr.flatMap(el => getTextNodes(el)).slice(0, 800); await translateNodes(nodes); };
  const translateElement = async (container) => { const nodes = getTextNodes(container).slice(0, 400); await translateNodes(nodes); };
  const stopTranslating = () => { if (!translateInProgress && !currentPort) return; if (currentCancel) currentCancel.cancelled = true; try{ if (currentPort) currentPort.disconnect(); } catch{} currentPort = null; translateInProgress = false; const spans = document.querySelectorAll(`span[${ATTR.processed}]`); for (const s of spans){ const el = s; if (!el.hasAttribute(ATTR.translated)) restoreSpan(el); } pendingNodes.clear(); clearTimeout(debounceTimer); };
  const restorePage = () => { stopTranslating(); const spans = document.querySelectorAll(`span[${ATTR.processed}]`); for (const s of spans) restoreSpan(s); setProgressVisible(true); };

  const collectTextNodes = (node) => { if (!node) return; if (node.nodeType === Node.TEXT_NODE){ const p = node.parentElement; if (!p || p.hasAttribute(ATTR.processed) || AVOID_TAGS.has(p.tagName)) return; if (p.closest('#' + PANEL_ID + ', [data-ft-ui="1"]')) return; if ((node.nodeValue||'').trim().length < 2) return; pendingNodes.add(node); } else if (node.nodeType === Node.ELEMENT_NODE){ if (node instanceof Element && (node.id === PANEL_ID || node.hasAttribute('data-ft-ui'))) return; const list = getTextNodes(node); for (const tn of list) pendingNodes.add(tn); } };
  const processPendingNodes = async () => { if (!observeActive || !pendingNodes.size) return; const nodes = Array.from(pendingNodes).slice(0, 200); pendingNodes.clear(); await translateNodes(nodes); };
  const startObserver = () => { if (observer) return; observeActive = true; observer = new MutationObserver(muts => { for (const m of muts){ m.addedNodes && m.addedNodes.forEach(n => collectTextNodes(n)); if (m.type === 'characterData') collectTextNodes(m.target); } if (pendingNodes.size){ clearTimeout(debounceTimer); debounceTimer = setTimeout(processPendingNodes, 500); } }); observer.observe(document.body, { childList: true, subtree: true, characterData: true }); };

  const updatePanelState = () => { const panel = ensureProgress(); if (!panel) return; const btn = panel.querySelector('button[data-action="translate"]'); if (btn) btn.textContent = translateInProgress ? 'Stop translating' : 'Translate page'; };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => { if (msg?.type === '__ft_ping__') { sendResponse({ ok: true }); return; } if (!enabled) { return; } if (msg?.type === 'translate_page') translatePage(); if (msg?.type === 'translate_selection') translateSelection(); if (msg?.type === 'restore_page') restorePage(); });

  (async () => { await ensureSettings(); injectStylesOnce(); ensureProgress(); updatePanelState(); if (settings.translateOnLoad) translatePage(); })();

  document.addEventListener('click', (e) => { try{ if (!enabled) return; if (!(e instanceof MouseEvent)) return; if (!e.ctrlKey && !e.metaKey) return; if (e.button !== 0) return; const t = e.target; if (!(t instanceof Element)) return; if (t.closest('#' + PANEL_ID + ', [data-ft-ui="1"]')) return; if (t.closest('a,button,input,textarea,select,label')) return; const container = findTranslatableContainer(t); if (!container) return; e.preventDefault(); e.stopPropagation(); translateElement(container); } catch{} }, true);

  document.addEventListener('mousemove', (e) => { try{ if (!enabled) return; const keyHeld = !!(e.ctrlKey || e.metaKey); if (keyHeld !== ctrlActive){ ctrlActive = keyHeld; document.documentElement.classList.toggle('ft-ctrl-cursor', ctrlActive); if (!ctrlActive) hideHighlight(); } if (!ctrlActive) return; const t = e.target; if (!(t instanceof Element)) { hideHighlight(); return; } if (t.closest('#' + PANEL_ID + ', [data-ft-ui="1"]')) { hideHighlight(); return; } if (t.closest('a,button,input,textarea,select,label,[role="button"],[role="link"]')) { hideHighlight(); return; } const container = findTranslatableContainer(t); if (!container) { hideHighlight(); return; } showHighlightFor(container); } catch{} }, true);
  window.addEventListener('keydown', (e) => { if (!enabled) return; if (e.key === 'Control' || e.metaKey){ ctrlActive = true; document.documentElement.classList.add('ft-ctrl-cursor'); } });
  window.addEventListener('keyup', (e) => { if (!enabled) return; if (!e.ctrlKey && !e.metaKey){ ctrlActive = false; document.documentElement.classList.remove('ft-ctrl-cursor'); hideHighlight(); } });
  window.addEventListener('blur', () => { if (!enabled) return; ctrlActive = false; document.documentElement.classList.remove('ft-ctrl-cursor'); hideHighlight(); });
  window.addEventListener('scroll', () => { if (ctrlActive && lastHoverContainer) showHighlightFor(lastHoverContainer); }, true);
  window.addEventListener('resize', () => { if (!enabled) return; if (ctrlActive && lastHoverContainer) showHighlightFor(lastHoverContainer); });

  try { chrome.storage.onChanged.addListener(async (changes, area) => { if (area !== 'local' || !changes || !changes.settings) return; const next = changes.settings.newValue; if (!next) return; settings = next; updatePanelState(); }); } catch{}
})();

