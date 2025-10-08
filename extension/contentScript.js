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
      .ft-shimmer{
        display:inline-block;
        color: transparent;
        border-radius: 6px;
        background:
          radial-gradient(200px 80px at 10% -20%, rgba(255,255,255,0.35), rgba(255,255,255,0) 60%),
          linear-gradient(100deg, rgba(255,255,255,0.15) 20%, rgba(255,255,255,0.45) 40%, rgba(255,255,255,0.15) 60%),
          linear-gradient(90deg, rgba(0,0,0,0.06), rgba(0,0,0,0.12), rgba(0,0,0,0.06));
        background-size: 300% 100%, 200% 100%, 200% 100%;
        background-blend-mode: screen, overlay, normal;
        will-change: background-position;
        animation: ft-sh 1.4s ease-in-out infinite;
      }
      @keyframes ft-sh{
        0%{ background-position: 30% 0, -180% 0, 0 0; }
        50%{ background-position: 70% 0, -90% 0, -100% 0; }
        100%{ background-position: 30% 0, 0 0, -180% 0; }
      }
      @media (prefers-reduced-motion: reduce){ .ft-shimmer{ animation: none; } }
      /* Once-like floating panel */
      .ft-progress{
        position:fixed; right:20px; bottom:20px; z-index:2147483646;
        display:flex; align-items:flex-start; gap:10px;
        color:#0a0a0a;
        --ft-accent: #7c3aed;
      }
      .ft-panel{ position:relative; display:flex; flex-direction:column; gap:8px; align-items:stretch; }
      .ft-shell{
        position:absolute; right:0; bottom:52px; /* above FAB */
        display:flex; flex-direction:column; gap:6px; padding:10px; border-radius:16px;
        background: rgba(255,255,255,0.95);
        backdrop-filter: blur(10px) saturate(160%);
        border: 1px solid rgba(0,0,0,0.12);
        box-shadow: 0 12px 30px rgba(0,0,0,0.16);
        transform-origin: 100% 100%;
        transform: scaleY(0);
        opacity: 0;
        pointer-events: none;
        will-change: transform, opacity;
        transition: transform .18s cubic-bezier(.2,.8,.2,1), opacity .18s ease, box-shadow .18s ease;
      }
      .ft-bar{ height:6px; width:120px; background: rgba(0,0,0,0.08); border-radius:6px; overflow:hidden; }
      .ft-bar>span{ display:block; height:100%; width:0; background: var(--ft-accent); transition: width .2s ease; }
      .ft-btn{ cursor:pointer; font-size:12px; padding:6px 10px; border-radius:10px; border: 1px solid rgba(0,0,0,0.08); background: rgba(255,255,255,0.9); }
      .ft-fab{ position:relative; width: 42px; height: 42px; min-width:42px; min-height:42px; border-radius: 999px; border: none; background-color: transparent; background-size: contain; background-repeat: no-repeat; background-position: center; cursor: pointer; box-shadow: 0 10px 22px rgba(0,0,0,0.18); background-image: radial-gradient(ellipse at center, rgba(255,255,255,0.7), rgba(255,255,255,0)); }
      .ft-fab::before{ content:""; position:absolute; inset:-6px; border-radius:999px; background:
        conic-gradient(var(--ft-accent) calc(var(--ftp, 0%)), rgba(0,0,0,0.12) 0);
        -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 6px), #000 0);
                mask: radial-gradient(farthest-side, transparent calc(100% - 6px), #000 0);
        transition: opacity .18s ease, background .1s linear;
        opacity: 0;
      }
      .ft-progress[data-busy="1"] .ft-fab::before{ opacity:1; }
      .ft-fab:focus-visible{ outline: 2px solid rgba(124,58,237,.6); outline-offset: 2px; }
      .ft-shell[data-hidden="1"]{ opacity: 0; pointer-events: none; transform: scaleY(0); }
      /* Open state */
      .ft-progress[data-open="1"] .ft-shell{ transform: scaleY(1); opacity: 1; pointer-events: auto; }
      .ft-menu{ display:flex; flex-direction:column; gap:4px; }
      .ft-item{ display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:12px; border: 1px solid rgba(0,0,0,0.08); background: rgba(255,255,255,0.9); cursor:pointer; font-size:12px; transition: background .16s ease, box-shadow .16s ease, transform .06s ease; }
      .ft-item:hover{ background: rgba(255,255,255,0.98); box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
      .ft-item:active{ transform: translateY(1px); }
      .ft-item:focus-visible{ outline: 2px solid rgba(124,58,237,.55); outline-offset: 2px; }
      .ft-ico{ width:18px; height:18px; display:inline-flex; align-items:center; justify-content:center; }
      .ft-ico svg{ width:18px; height:18px; stroke:#111; }
      .ft-sep{ height:1px; border: none; background: rgba(0,0,0,0.08); margin:4px 0; }
      .ft-highlight{ position:fixed; z-index:2147483646; pointer-events:none; border-radius:12px; outline:2px solid rgba(124,58,237,.85); box-shadow: 0 10px 30px rgba(124,58,237,.25); background: rgba(124,58,237,.06); transition: top .08s ease, left .08s ease, width .08s ease, height .08s ease, opacity .08s ease; opacity:0; }
      .ft-highlight.show{ opacity:1; }
      html.ft-mod-cursor, html.ft-mod-cursor *{ cursor: zoom-in !important; }
      /* collapsed class kept for compatibility but no display:none to allow animation */
      @media (prefers-color-scheme: dark){
        .ft-shell{ background: rgba(22,24,29,0.95); border-color: rgba(255,255,255,0.10); box-shadow: 0 12px 30px rgba(0,0,0,0.6); }
        .ft-item{ background: rgba(26,28,34,0.96); border-color: rgba(255,255,255,0.08); }
        .ft-item:hover{ background: rgba(26,28,34,1); box-shadow: 0 2px 10px rgba(0,0,0,0.45); }
        .ft-ico svg{ stroke:#eaeaf0; }
      }
      .ft-toast{ position:fixed; right:20px; bottom:80px; max-width:360px; background: rgba(17,17,17,0.92); color:#fff; border-radius:12px; padding:10px 12px; z-index:2147483647; box-shadow: 0 10px 30px rgba(0,0,0,0.35); display:flex; gap:8px; align-items:center; }
      .ft-toast button{ background: #fff; color:#111; border: none; padding:6px 10px; border-radius:8px; cursor:pointer; }
      .ft-bubble{ position:fixed; z-index:2147483647; background:#111; color:#fff; padding:6px 8px; border-radius:10px; box-shadow: 0 10px 20px rgba(0,0,0,0.25); font-size:12px; pointer-events:auto; user-select:none; cursor:pointer; }
    `;
    document.documentElement.appendChild(style);
  };

  const ensureProgress = () => {
    let isTop = true; try { isTop = (window.top === window); } catch (_) { isTop = true; }
    if (!isTop) return null;
    const existing = document.getElementById(PANEL_ID); if (existing) { progressEl = existing; return existing; }
    const el = document.createElement('div'); el.id = PANEL_ID; el.className = 'ft-progress'; el.setAttribute('data-ft-ui','1');
    el.innerHTML = `
      <button class=\"ft-fab\" data-action=\"toggle\" title=\"FluxTranslate\"></button>
      <div class=\"ft-panel\">
        <div class=\"ft-shell\">
          <div class=\"ft-menu\">
          <button class="ft-item" data-action="translate"><span class="ft-ico" data-icon="sparkles"></span><span class="ft-label">Translate page</span></button>
          <button class="ft-item" data-action="restore"><span class="ft-ico" data-icon="undo"></span><span class="ft-label">Restore</span></button>
          <hr class="ft-sep"/>
          <button class="ft-item" data-action="options"><span class="ft-ico" data-icon="settings"></span><span class="ft-label">Options</span></button>
          </div>
          <div class=\"ft-bar\"><span></span></div>
        </div>
      </div>
    `;
    el.addEventListener('click', (e) => { const t = e.target; if (!(t instanceof HTMLElement)) return; const btn = t.closest && t.closest('button[data-action]'); const a = btn && btn.getAttribute('data-action'); if (a === 'hide'){ e.preventDefault(); e.stopPropagation(); try{ setSiteHidden(true); setPanelHidden(true); } catch(_){ } return; } if (a === 'toggle'){ e.preventDefault(); e.stopPropagation(); toggleCollapsed(); return; } e.stopPropagation(); });
    document.body.appendChild(el);
    // Wire action handlers
    try {
      el.addEventListener('click', (e) => {
        const t2 = e.target; if (!(t2 instanceof HTMLElement)) return;
        const btn2 = t2.closest && t2.closest('button[data-action]');
        const a2 = btn2 && btn2.getAttribute('data-action');
        if (a2 === 'translate'){
          e.preventDefault(); e.stopPropagation();
          try{ if (translateInProgress && typeof currentCancel === 'function') currentCancel(); else if (typeof translatePage === 'function') translatePage(); } catch(_){ }
          return;
        }
        if (a2 === 'selection'){
          e.preventDefault(); e.stopPropagation();
          try{ if (typeof translateSelection === 'function') translateSelection(); } catch(_){ }
          return;
        }
        if (a2 === 'restore'){
          e.preventDefault(); e.stopPropagation();
          try{ if (typeof restorePage === 'function') restorePage(); } catch(_){ }
          return;
        }
        if (a2 === 'options'){
          e.preventDefault(); e.stopPropagation();
          let opened = false; try{ chrome.runtime.openOptionsPage(); opened = true; } catch(_){ }
          if (!opened){ try{ chrome.runtime.sendMessage({ type: 'open_options' }); } catch(_){ } }
          return;
        }
      });
    } catch(_){ }
    try{ const url = chrome.runtime.getURL('assets/icon_togle.png'); const fab = el.querySelector('.ft-fab'); if (fab) fab.style.backgroundImage = `url('${url}')`; } catch{}

    // Inject Lucide icons inline
    try{
      function svg(path){ const s = document.createElementNS('http://www.w3.org/2000/svg','svg'); s.setAttribute('viewBox','0 0 24 24'); s.setAttribute('fill','none'); s.setAttribute('stroke','currentColor'); s.setAttribute('stroke-width','2'); s.setAttribute('stroke-linecap','round'); s.setAttribute('stroke-linejoin','round'); const p = document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d', path); s.appendChild(p); return s; }
      const ICONS = {
        'sparkles': 'M12 3v2m0 14v2m9-9h-2M5 12H3m14.95 4.95-1.414-1.414M7.464 7.464 6.05 6.05m10.607-1.414L15.243 6.05M8.757 17.95l-1.414 1.414',
        'selection': 'M3 5a2 2 0 0 1 2-2h2M3 13v6a2 2 0 0 0 2 2h6M19 3h2v2M19 11h2M11 3h2M3 11h2',
        'undo': 'M3 7v6h6M21 17a8 8 0 1 0-8-8',
        'pin': 'M12 17v4M8 3h8l-1 8 3 3H6l3-3-1-8Z',
        'chevron-down': 'm6 9 6 6 6-6',
        'eye-off': 'm3 3 18 18M10.58 10.58A2 2 0 0 0 13.42 13.42M9.88 4.24A9.77 9.77 0 0 1 12 4c5.25 0 9.27 3.11 10.94 7.5a11.94 11.94 0 0 1-1.64 2.88M6.1 6.1A11.94 11.94 0 0 0 1.06 11.5a12.05 12.05 0 0 0 7.88 6.88',
        'settings': 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.94 4a7.94 7.94 0 0 0-.16-1.66l2.12-1.65-2-3.46-2.52 1a7.94 7.94 0 0 0-2.88-1.66l-.38-2.69h-4l-.38 2.69a7.94 7.94 0 0 0-2.88 1.66l-2.52-1-2 3.46 2.12 1.65A7.94 7.94 0 0 0 3.06 12c0 .56.06 1.11.16 1.66L1.1 15.31l2 3.46 2.52-1c.86.68 1.83 1.23 2.88 1.66l.38 2.69h4l.38-2.69c1.05-.43 2.02-.98 2.88-1.66l2.52 1 2-3.46-2.12-1.65c.1-.55.16-1.1.16-1.66Z'
      };
      el.querySelectorAll('.ft-ico').forEach((holder) => {
        const key = holder.getAttribute('data-icon') || '';
        const path = ICONS[key];
        if (path){ holder.innerHTML=''; holder.appendChild(svg(path)); }
      });
    } catch(_){ }
    // Apply saved position/state
    try{
      const p = (settings && settings.panel) || {};
      if (p && p.pos){ el.style.right = (p.pos.right||20) + 'px'; el.style.bottom = (p.pos.bottom||20) + 'px'; }
      const shouldCollapse = (typeof p.collapsed === 'boolean') ? p.collapsed : true;
      if (shouldCollapse) el.classList.add('collapsed'); else el.classList.remove('collapsed');
    } catch(_){ }
    // Drag to move
    try{
      let dragging = false; let sx=0, sy=0; let sr=0, sb=0; let dragMoved=false; let dragEndAt=0;
      const onDown = (ev) => {
        if (!(ev instanceof MouseEvent)) return;
        const target = ev.target; if (!(target instanceof HTMLElement)) return;
        // Allow drag from panel background or fab
        if (!target.closest('#'+PANEL_ID)) return;
        dragging = true; sx = ev.clientX; sy = ev.clientY; dragMoved=false;
        const cr = parseInt(el.style.right||'20',10)||20; const cb = parseInt(el.style.bottom||'20',10)||20;
        sr = cr; sb = cb; ev.preventDefault();
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('mouseup', onUp, true);
      };
      const onMove = (ev) => {
        if (!dragging) return;
        const dx = ev.clientX - sx; const dy = ev.clientY - sy;
        const nr = Math.max(0, sr - dx); const nb = Math.max(0, sb - dy);
        el.style.right = nr + 'px'; el.style.bottom = nb + 'px';
        if (!dragMoved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) dragMoved = true;
      };
      const onUp = async (_ev) => {
        if (!dragging) return; dragging = false;
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
        try{
          const r = parseInt(el.style.right||'20',10)||20; const b = parseInt(el.style.bottom||'20',10)||20;
      const p = Object.assign({}, settings.panel||{}, { pos: { right: r, bottom: b } });
          await updateSettings({ panel: p });
        } catch(_){ }
        dragEndAt = Date.now();
      };
      el.addEventListener('mousedown', onDown, true);
      // Swallow click that immediately follows a drag
      el.addEventListener('click', (ev) => {
        try{
          if (dragMoved && Date.now() - dragEndAt < 220){ ev.preventDefault(); ev.stopPropagation(); }
        } catch(_){ }
      }, true);
    } catch(_){ }
    progressEl = el; return el;
  };

  const updateProgress = (done, total) => { const el = ensureProgress(); if (!el) return; const pct = total > 0 ? Math.round((done/total)*100) : 0; const bar = el.querySelector('.ft-bar>span'); if (bar) bar.style.width = `${pct}%`; try{ el.style.setProperty('--ftp', pct + '%'); el.setAttribute('data-busy', pct>0 && pct<100 ? '1' : '0'); } catch(_){ } };
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
      port.onMessage.addListener((msg) => { if (!msg || !msg.type) return; if (cancel?.cancelled) return; if (msg.type === 'item'){ const span = idToSpan.get(String(msg.id)); if (span){ applyTranslation(span, msg.t); done++; updateProgress(done, total); } } else if (msg.type === 'error'){ console.warn('FluxTranslate stream error:', msg.error); showToast(String(msg.error || 'Translation error'), { label:'Options', onClick: ()=> chrome.runtime.openOptionsPage() }); } else if (msg.type === 'done'){ resolve(); } });
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
    try {
      await translateViaStream(idToSpan, items, currentCancel);
    } catch(err){
      showToast(String(err?.message || err), { label:'Options', onClick: ()=> chrome.runtime.openOptionsPage() });
    } finally {
      translateInProgress = false; currentCancel = null;
      try{
      const auto = (settings && settings.panel && settings.panel.autoHideMs) || 0;
        const pinnedSite = isPinnedForHost();
        if (!pinnedSite && auto > 0){ setTimeout(()=>{ try{ setCollapsed(true); } catch{} }, auto); }
      } catch(_){ }
    }
  };

  const translatePage = async () => {
    const all = getTextNodes(document.body).slice(0, 800);
    const CHUNK = 120; // process in smaller chunks for faster first paint
    for (let i = 0; i < all.length; i += CHUNK){
      const part = all.slice(i, i+CHUNK);
      await translateNodes(part);
      // Yield to UI between chunks
      await new Promise(r => setTimeout(r, 0));
    }
    startObserver();
  };
  const translateSelection = async () => { const sel = window.getSelection && window.getSelection(); const targets = new Set(); if (sel && sel.rangeCount){ for (let i = 0; i < sel.rangeCount; i++){ const r = sel.getRangeAt(i); if (r){ const c = nearestContainer(r.commonAncestorContainer instanceof Element ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement); if (c) targets.add(c); } } } const arr = Array.from(targets); if (!arr.length) return; const nodes = arr.flatMap(el => getTextNodes(el)).slice(0, 800); await translateNodes(nodes); };
  const translateElement = async (container) => { const nodes = getTextNodes(container).slice(0, 400); await translateNodes(nodes); };
  const stopTranslating = () => { if (!translateInProgress && !currentPort) return; if (currentCancel) currentCancel.cancelled = true; try{ if (currentPort) currentPort.disconnect(); } catch{} currentPort = null; translateInProgress = false; const spans = document.querySelectorAll(`span[${ATTR.processed}]`); for (const s of spans){ const el = s; if (!el.hasAttribute(ATTR.translated)) restoreSpan(el); } pendingNodes.clear(); clearTimeout(debounceTimer); };
  const restorePage = () => { stopTranslating(); const spans = document.querySelectorAll(`span[${ATTR.processed}]`); for (const s of spans) restoreSpan(s); setProgressVisible(true); };

  const collectTextNodes = (node) => { if (!node) return; if (node.nodeType === Node.TEXT_NODE){ const p = node.parentElement; if (!p || p.hasAttribute(ATTR.processed) || AVOID_TAGS.has(p.tagName)) return; if (p.closest('#' + PANEL_ID + ', [data-ft-ui="1"]')) return; if ((node.nodeValue||'').trim().length < 2) return; pendingNodes.add(node); } else if (node.nodeType === Node.ELEMENT_NODE){ if (node instanceof Element && (node.id === PANEL_ID || node.hasAttribute('data-ft-ui'))) return; const list = getTextNodes(node); for (const tn of list) pendingNodes.add(tn); } };
  const processPendingNodes = async () => { if (!observeActive || !pendingNodes.size) return; const nodes = Array.from(pendingNodes).slice(0, 200); pendingNodes.clear(); await translateNodes(nodes); };
  const startObserver = () => { if (observer) return; observeActive = true; observer = new MutationObserver(muts => { for (const m of muts){ m.addedNodes && m.addedNodes.forEach(n => collectTextNodes(n)); if (m.type === 'characterData') collectTextNodes(m.target); } if (pendingNodes.size){ clearTimeout(debounceTimer); debounceTimer = setTimeout(processPendingNodes, 500); } }); observer.observe(document.body, { childList: true, subtree: true, characterData: true }); };

  function setPanelHidden(v){ const el = ensureProgress(); if (!el) return; try{ const shell = el.querySelector('.ft-shell'); if (shell) shell.setAttribute('data-hidden', v ? '1' : '0'); } catch{} }
  async function setCollapsed(v){ const el = ensureProgress(); if (!el) return; try{ el.setAttribute('data-open', v ? '0' : '1'); } catch{}; try { const p = Object.assign({}, settings.panel||{}, { collapsed: !!v }); await updateSettings({ panel: p }); } catch(_){ } }
  function currentHostName(){ return hostnameOf(); }
  function isPinnedForHost(){ const sp = (settings && settings.sitesPanel) || {}; const host = currentHostName(); return !!(host && Array.isArray(sp.pinned) && sp.pinned.includes(host)); }
  function isHiddenForHost(){ const sp = (settings && settings.sitesPanel) || {}; const host = currentHostName(); return !!(host && Array.isArray(sp.hidden) && sp.hidden.includes(host)); }
  async function setSitePinned(v){ try{ const host = currentHostName(); if (!host) return; const sp = (settings && settings.sitesPanel) || { pinned: [], hidden: [] }; const p = new Set(sp.pinned || []); const h = new Set(sp.hidden || []); if (v){ p.add(host); h.delete(host); } else { p.delete(host); } await updateSettings({ sitesPanel: { pinned: Array.from(p), hidden: Array.from(h) } }); } catch(_){ } }
  async function setSiteHidden(v){ try{ const host = currentHostName(); if (!host) return; const sp = (settings && settings.sitesPanel) || { pinned: [], hidden: [] }; const p = new Set(sp.pinned || []); const h = new Set(sp.hidden || []); if (v){ h.add(host); p.delete(host); } else { h.delete(host); } await updateSettings({ sitesPanel: { pinned: Array.from(p), hidden: Array.from(h) } }); } catch(_){ } }
  function toggleCollapsed(){ const el = ensureProgress(); if (!el) return; const open = el.getAttribute('data-open') === '1'; setCollapsed(open); }
  function togglePinned(){ const next = !isPinnedForHost(); setSitePinned(next); }
  const updatePanelState = () => { const panel = ensureProgress(); if (!panel) return; const btn = panel.querySelector('button[data-action="translate"] .ft-label'); if (btn) btn.textContent = translateInProgress ? 'Stop translating' : 'Translate page'; const p = (settings && settings.panel)||{}; try{ panel.setAttribute('data-open', p.collapsed ? '0' : '1'); } catch{} };

  // Toast utility
  function showToast(message, action){
    try{
      const old = document.getElementById('ft-toast'); if (old) old.remove();
      const el = document.createElement('div'); el.id = 'ft-toast'; el.className = 'ft-toast'; el.setAttribute('data-ft-ui','1');
      const span = document.createElement('span'); span.textContent = message || '';
      el.appendChild(span);
      if (action && action.label && action.onClick){
        const btn = document.createElement('button'); btn.textContent = action.label; btn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); try{ action.onClick(); } catch{} el.remove(); }); el.appendChild(btn);
      }
      document.body.appendChild(el);
      setTimeout(()=>{ try{ el.remove(); } catch{} }, 4000);
    } catch(_){}
  }

  // Selection bubble
  let bubbleEl = null;
  function ensureBubble(){ if (bubbleEl && document.body.contains(bubbleEl)) return bubbleEl; const el = document.createElement('div'); el.id='ft-bubble'; el.className='ft-bubble'; el.setAttribute('data-ft-ui','1'); el.style.display='none'; el.textContent='Translate';
    el.addEventListener('mousedown', (e)=>{ e.preventDefault(); e.stopPropagation(); });
    el.addEventListener('click', async (e)=>{ e.preventDefault(); e.stopPropagation(); await translateCurrentSelection(); });
    document.body.appendChild(el); bubbleEl = el; return el; }
  function hideBubble(){ const el = ensureBubble(); el.style.display='none'; }
  function showBubbleAt(x,y){ const el = ensureBubble(); el.style.left = Math.max(6, x+6) + 'px'; el.style.top = Math.max(6, y+6) + 'px'; el.style.display='block'; }
  async function translateCurrentSelection(){ try{ const sel = window.getSelection(); if (!sel || sel.isCollapsed) return; const text = String(sel.toString()||'').trim(); if (!text) return; const id = 'sel-1'; const res = await chrome.runtime.sendMessage({ type: 'translate_batch', items: [{ id, text }] }); if (!res?.ok){ showToast(res?.error || 'Translation failed', { label: 'Options', onClick: ()=> chrome.runtime.openOptionsPage() }); return; } const item = (res.items||[]).find(x=>String(x.id)===String(id)); if (!item){ showToast('No translation returned'); return; } // show tooltip
      const rect = sel.getRangeAt(0).getBoundingClientRect(); const el = ensureBubble(); el.textContent = item.t || ''; el.style.maxWidth = '420px'; el.style.whiteSpace='pre-wrap'; el.style.lineHeight='1.35'; showBubbleAt(rect.right, rect.bottom); setTimeout(()=>{ try{ el.textContent='Translate'; el.style.display='none'; } catch{} }, 6000);
    } catch(err){ showToast(String(err?.message||err)); } }

  document.addEventListener('selectionchange', () => {
    try{
      const sel = window.getSelection(); if (!sel || sel.isCollapsed) { hideBubble(); return; }
      const r = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null; if (!r || r.width<1 || r.height<1){ hideBubble(); return; }
      showBubbleAt(r.right, r.bottom);
    } catch{ hideBubble(); }
  });
  // Keep bubble visible on pointer over to avoid disappearing before click
  document.addEventListener('pointerdown', (e) => {
    try{
      const t = e.target; if (!(t instanceof Element)) return;
      if (t.id === 'ft-bubble') return;
      // If clicking outside, allow default hide behavior via selectionchange
    } catch{}
  }, true);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => { if (msg?.type === '__ft_ping__') { sendResponse({ ok: true }); return; } if (!enabled) { return; } if (msg?.type === 'translate_page') translatePage(); if (msg?.type === 'translate_selection') translateSelection(); if (msg?.type === 'restore_page') restorePage(); if (msg?.type === 'toggle_panel'){ const el = ensureProgress(); if (!el) return; const shell = el.querySelector('.ft-shell'); const hidden = shell && shell.getAttribute('data-hidden') === '1'; if (hidden) setPanelHidden(false); else toggleCollapsed(); }});

  function hostnameOf(loc){ try{ return String((loc || window.location).hostname || '').toLowerCase().replace(/^www\./,''); } catch { return ''; } }
  function matchIn(list, host){ if (!Array.isArray(list)) return false; host = host || ''; return list.some(x => host === String(x||'').toLowerCase().replace(/^www\./,'')); }
  function shouldAutoTranslate(){
    const s = settings || {};
    const host = hostnameOf();
    const never = (s.sites && s.sites.never) || [];
    const always = (s.sites && s.sites.always) || [];
    if (matchIn(never, host)) return false;
    if (matchIn(always, host)) return true;
    return !!s.translateOnLoad;
  }
  (async () => {
    await ensureSettings();
    injectStylesOnce();
    ensureProgress();
    // Apply panel site prefs
    try{
      const host = hostnameOf();
      const sp = (settings && settings.sitesPanel) || {};
      if (Array.isArray(sp.hidden) && sp.hidden.includes(host)) setPanelHidden(true);
      // Pinned is stored per-site; no global flag to set here
    } catch(_){ }
    updatePanelState();
    // Always show panel initially
    try{ setPanelHidden(false); } catch(_){ }
    if (shouldAutoTranslate()) try{ translatePage(); } catch(_){}
  })();

  document.addEventListener('click', (e) => { try{ if (!enabled) return; if (!(e instanceof MouseEvent)) return; if (!e.altKey) return; if (e.button !== 0) return; const t = e.target; if (!(t instanceof Element)) return; if (t.closest('#' + PANEL_ID + ', [data-ft-ui="1"]')) return; if (t.closest('a,button,input,textarea,select,label')) return; const container = findTranslatableContainer(t); if (!container) return; e.preventDefault(); e.stopPropagation(); translateElement(container); } catch{} }, true);

  document.addEventListener('mousemove', (e) => { try{ if (!enabled) return; const keyHeld = !!(e.altKey); if (keyHeld !== ctrlActive){ ctrlActive = keyHeld; document.documentElement.classList.toggle('ft-mod-cursor', ctrlActive); if (!ctrlActive) hideHighlight(); } if (!ctrlActive) return; const t = e.target; if (!(t instanceof Element)) { hideHighlight(); return; } if (t.closest('#' + PANEL_ID + ', [data-ft-ui="1"]')) { hideHighlight(); return; } if (t.closest('a,button,input,textarea,select,label,[role="button"],[role="link"]')) { hideHighlight(); return; } const container = findTranslatableContainer(t); if (!container) { hideHighlight(); return; } showHighlightFor(container); } catch{} }, true);
  window.addEventListener('keydown', (e) => { if (!enabled) return; if (e.altKey){ ctrlActive = true; document.documentElement.classList.add('ft-mod-cursor'); } });
  window.addEventListener('keyup', (e) => { if (!enabled) return; if (!e.altKey){ ctrlActive = false; document.documentElement.classList.remove('ft-mod-cursor'); hideHighlight(); } });
  window.addEventListener('blur', () => { if (!enabled) return; ctrlActive = false; document.documentElement.classList.remove('ft-mod-cursor'); hideHighlight(); });
  window.addEventListener('scroll', () => { if (ctrlActive && lastHoverContainer) showHighlightFor(lastHoverContainer); }, true);
  window.addEventListener('resize', () => { if (!enabled) return; if (ctrlActive && lastHoverContainer) showHighlightFor(lastHoverContainer); });

  try { chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes || !changes.settings) return;
    const next = changes.settings.newValue; if (!next) return;
    settings = next; updatePanelState();
    try{
      const host = hostnameOf(); const sp = (settings && settings.sitesPanel) || {};
      if (Array.isArray(sp.hidden) && sp.hidden.includes(host)) setPanelHidden(true); else if (progressEl && progressEl.style.display === 'none') setPanelHidden(false);
      if (Array.isArray(sp.pinned)) setPinned(sp.pinned.includes(host));
    } catch(_){ }
  }); } catch{}
})();

