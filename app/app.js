/* app.js — app shell: connection, routing, scanning, the product record, and the stock forms. */
(function () {
  'use strict';
  const I = window.Inv;
  const { num, money, fmtN, fmtDate, fmtDT, rel, dkey, today, addDays, totalStock, Store } = I;

  // ---------- state ----------
  const S = {
    db: null, user: null, dl: null, uid: null, isOwner: false, ro: false,
    cfg: null, cfgLoaded: false, products: new Map(), pub: new Map(), priv: new Map(), prodLoaded: false, sheetOld: null,
    dayDocs: new Map(), moves: [], idx: new Map(), alerts: [],
    names: new Map(), imgCache: new Map(), view: 'scan', sheetPid: null, sheetHist: null, recentScans: [],
    windowFrom: addDays(today(), -120),
  };
  window.S = S;

  // ---------- tiny DOM helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  let toastTimer;
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), bad ? 6000 : 3000);
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      if ($$('script').some((s) => s.getAttribute('src') === src && s.dataset.ok)) return res();
      const s = document.createElement('script'); s.src = src; s.onload = () => { s.dataset.ok = '1'; res(); }; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s);
    });
  }

  // ---------- lookups ----------
  const locs = () => S.cfg?.locations || [];
  const locName = (id) => locs().find((l) => l.id === id)?.name || id || '—';
  const supName = (id) => (S.cfg?.suppliers || []).find((s) => s.id === id)?.name || '';
  const activeProducts = () => [...S.products.values()].filter((p) => !p.archived);
  function findByCode(code) {
    const c = I.codeNorm(code); if (!c) return null;
    const alt = c.replace(/^0+/, '');
    for (const p of S.products.values()) {
      const b = I.codeNorm(p.barcode), k = I.codeNorm(p.sku);
      if (b && (b === c || b.replace(/^0+/, '') === alt)) return p;
      if (k && k.toLowerCase() === c.toLowerCase()) return p;
    }
    return null;
  }
  function stats(p) { return I.productStats(p, S.idx.get(p.id), S.cfg); }
  function nameOf(id) { if (!id) return '—'; if (id === S.uid) return 'You'; return S.names.get(id) || 'Staff member'; }
  let namePending = false;
  async function resolveNames(ids) {
    if (!S.user) return;
    const need = [...new Set(ids.filter((x) => x && !S.names.has(x) && x !== S.uid))];
    if (!need.length || namePending) return;
    namePending = true;
    try { const ps = await S.user.profiles(need); for (const id of need) S.names.set(id, ps[id]?.name || 'Staff member'); } catch (e) { /* names are optional */ }
    namePending = false; refresh();
  }

  // ---------- connection ----------
  function setSync(text, bad) { const el = $('#syncState'); el.textContent = text; el.className = 'sync' + (bad ? ' bad' : ''); }
  const TABS = {
    owner: [['scan', 'Scan', 'M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M16 8v8'], ['stock', 'Stock', 'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10'], ['count', 'Count', 'M9 4h6v3H9zM6 6h12v15H6zM9 12l2 2 4-4'], ['office', 'Back office', 'M4 20V10M10 20V4M16 20v-7M22 20H2']],
    staff: [['scan', 'Scan', 'M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M16 8v8'], ['stock', 'Stock', 'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10'], ['count', 'Count', 'M9 4h6v3H9zM6 6h12v15H6zM9 12l2 2 4-4'], ['help', 'Help', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.5']],
  };
  function drawTabs() {
    const list = TABS[S.isOwner ? 'owner' : 'staff'];
    const nav = $('.tabbar'); nav.style.gridTemplateColumns = `repeat(${list.length}, 1fr)`;
    nav.innerHTML = list.map(([k, l, d]) => `<a href="#${k}" data-tab="${k}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg><span>${l}</span>${k === 'office' ? '<b id="alertBadge" class="badge" hidden></b>' : ''}</a>`).join('');
  }
  async function boot() {
    drawTabs();
    route();
    window.addEventListener('hashchange', route);
    installScannerListener();
    if (window.PLATFORM_WAIT) await window.PLATFORM_WAIT; // Android app: wait for sign-in
    if (!window.claude || !window.claude.use) { setSync('Offline', true); renderFatal('This app needs to be opened from its claude.ai link so it can reach your shop\'s database.'); return; }
    [S.db, S.user, S.dl] = await Promise.all([claude.use('db'), claude.use('user'), claude.use('downloads')]);
    if (!S.db) { setSync('No database', true); renderFatal('The shop database isn\'t available here. Make sure you\'re signed in to claude.ai, then open the app from its link.'); return; }
    if (S.user) {
      S.uid = await S.user.id(); S.isOwner = await S.user.isOwner();
      const can = await S.user.can('data.write'); S.ro = can === false;
    }
    drawTabs(); route();
    Store.init(S.db, S.uid, S.isOwner);
    const timer = setTimeout(() => { if (!S.cfgLoaded) setSync('Can\'t reach the database yet…', true); }, 10000);
    const lost = (e) => { setSync('Connection lost — reload the page', true); console.error(e); };
    S.db.doc('config/shop').onSnapshot((snap) => {
      if (snap.metadata.fromCache && !snap.exists) return;
      clearTimeout(timer);
      const had = !!S.cfg && S.cfgLoaded;
      S.cfg = snap.exists && snap.data().locations ? I.clone(snap.data()) : null;
      S.cfgLoaded = true;
      $('#shopName').textContent = S.cfg?.name || 'Shop Stock';
      setSync(S.ro ? 'View only' : S.isOwner ? 'Owner' : 'Staff');
      recompute();
      if (had && S.cfg) refresh(); else render();
      maybeMigrate();
    }, lost);
    S.db.collection('products').onSnapshot((snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') S.pub.delete(ch.doc.id); else S.pub.set(ch.doc.id, ch.doc.data());
      }
      if (!snap.metadata.fromCache) S.prodLoaded = true;
      scheduleRecompute(); maybeMigrate();
    }, lost);
    if (S.isOwner) {
      S.privLoaded = false;
      S.db.collection('priv').onSnapshot((snap) => {
        for (const ch of snap.docChanges()) { if (ch.type === 'removed') S.priv.delete(ch.doc.id); else S.priv.set(ch.doc.id, ch.doc.data()); }
        if (!snap.metadata.fromCache) S.privLoaded = true;
        scheduleRecompute(); maybeMigrate();
      }, lost);
      const watching = new Set();
      S.db.collection('led').onSnapshot((snap) => { for (const d of snap.docs) if (!watching.has(d.id)) { watching.add(d.id); watchLedger(d.id); } }, lost);
    } else if (S.uid) watchLedger(S.uid);
  }
  function watchLedger(u) {
    S.db.collection('led/' + u + '/d').where('date', '>=', S.windowFrom).onSnapshot((snap) => {
      for (const ch of snap.docChanges()) {
        const key = u + '/' + ch.doc.id;
        if (ch.type === 'removed') S.dayDocs.delete(key); else S.dayDocs.set(key, ch.doc.data()?.moves || []);
      }
      const seen = new Set(); const all = [];
      for (const list of S.dayDocs.values()) for (const m of list) if (!seen.has(m.id)) { seen.add(m.id); all.push(m); }
      for (const m of S.moves) if (m._local && !seen.has(m.id)) all.push(m);
      S.moves = all.sort((a, b) => a.t - b.t);
      scheduleRecompute();
    }, (e) => console.error(e));
  }
  // One-off tidy-up for data saved by the first version: move cost/supplier into the owner-only area
  // and copy the old shared ledger into the owner's own ledger.
  let migrating = false;
  async function maybeMigrate() {
    if (!S.isOwner || S.ro || migrating || S.migrated || !S.cfg || !S.prodLoaded || !S.privLoaded) return;
    migrating = true;
    try {
      for (const [id, pub] of S.pub) {
        if (!I.PRIV.some((k) => k in pub)) continue;
        const { pub: p2, priv } = I.splitProduct(pub);
        await Store.retry(() => S.db.doc('priv/' + id).set({ ...priv, ...(S.priv.get(id) || {}) }));
        await Store.retry(() => S.db.doc('products/' + id).set(p2));
      }
      const old = await Store.retry(() => S.db.collection('days').get());
      if (old.size) {
        const moves = []; for (const d of old.docs) moves.push(...(d.data()?.moves || []));
        if (moves.length) await Store.appendDays(moves.sort((x, y) => x.t - y.t));
        for (const d of old.docs) await Store.retry(() => S.db.doc('days/' + d.id).delete());
      }
      const oh = await Store.retry(() => S.db.collection('hist').get());
      for (const d of oh.docs) await Store.retry(() => S.db.doc('hist/' + d.id).delete());
      S.migrated = true;
    } catch (e) { console.error('migration', e); }
    migrating = false;
  }
  function renderFatal(msg) { $('#view').innerHTML = `<div class="wrap"><div class="card"><h2>Can't open the shop</h2><p>${esc(msg)}</p></div></div>`; }

  let rcTimer;
  function scheduleRecompute() { clearTimeout(rcTimer); rcTimer = setTimeout(() => { recompute(); refresh(); }, 120); }
  function merge() {
    const lastSale = new Map();
    for (const m of S.moves) if (m.ty === 'sale' && (lastSale.get(m.p) || 0) < m.t) lastSale.set(m.p, m.t);
    const out = new Map();
    for (const [id, pub] of S.pub) {
      const p = S.isOwner ? { ...pub, ...(S.priv.get(id) || {}), id } : { ...pub, id };
      if (S.isOwner) { const ls = lastSale.get(id); if (ls && ls > (p.lastSale || 0)) p.lastSale = ls; }
      out.set(id, p);
    }
    S.products = out;
  }
  function recompute() {
    merge();
    S.idx = I.salesIndex(S.moves);
    S.alerts = S.cfg ? I.buildAlerts(activeProducts(), S.idx, S.cfg) : [];
    const n = S.alerts.filter((a) => a.sev !== 'info' && a.type !== 'reorder').length;
    const b = $('#alertBadge'); if (b) { b.hidden = !n || !S.isOwner; b.textContent = n > 99 ? '99+' : n; }
  }
  // Apply our own writes immediately so the screen never waits for the database echo.
  function applyLocal(res) {
    for (const u of res.updated || []) { S.pub.set(u.pid, u.pub); if (u.priv) S.priv.set(u.pid, u.priv); }
    if (res.recs?.length) { const have = new Set(S.moves.map((m) => m.id)); S.moves = S.moves.concat(res.recs.filter((r) => !have.has(r.id)).map((r) => ({ ...r, _local: 1 }))).sort((a, b) => a.t - b.t); }
    recompute(); refresh();
  }

  // ---------- routing ----------
  const V = {}; // views registered by views.js: V.name = { render(el), refresh?(el) }
  function route() {
    const h = (location.hash || '#scan').slice(1) || 'scan';
    S.view = V[h] && (!V[h].owner || S.isOwner) ? h : 'scan';
    $$('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === S.view || (a.dataset.tab === 'office' && V[S.view]?.owner)));
    render();
  }
  function render() {
    const el = $('#view');
    if (!S.db || !S.cfgLoaded) { el.innerHTML = '<div class="wrap"><div class="card"><p class="muted">Loading your shop…</p></div></div>'; return; }
    if (S.db && !S.cfg) { V.setup.render(el); return; }
    if (!S.db) return;
    (V[S.view] || V.scan).render(el);
    el.scrollTop = 0;
  }
  function refresh() {
    if (!S.cfg) return;
    const v = V[S.view];
    if (v && v.refresh) v.refresh($('#view')); else if (v && v.live) v.render($('#view'));
    if (S.sheetPid) renderSheet();
  }

  // ---------- scanning ----------
  // A USB/Bluetooth barcode scanner "types" the code very quickly and presses Enter.
  function installScannerListener() {
    let buf = '', last = 0;
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const now = Date.now();
      if (now - last > 80) buf = '';
      last = now;
      if (e.key === 'Enter') { if (buf.length >= 4) { e.preventDefault(); handleCode(buf); } buf = ''; return; }
      if (e.key.length === 1) buf += e.key;
    });
  }
  // Phone camera: the page can't stream video, so the phone takes a photo and we read the barcode from it.
  async function decodePhoto(file) {
    const bmp = await createImageBitmap(file);
    if ('BarcodeDetector' in window) {
      try { const det = new window.BarcodeDetector(); const r = await det.detect(bmp); if (r && r[0]) return r[0].rawValue; } catch (e) { /* fall back */ }
    }
    await loadScript('lib/zxing.min.js');
    const Z = window.ZXing;
    const hints = new Map();
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.ITF]);
    const reader = new Z.MultiFormatReader(); reader.setHints(hints);
    for (const size of [1400, 1000, 700, 2000]) {
      const sc = Math.min(1, size / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, c.width, c.height);
      for (const rot of [0, 90]) {
        let canvas = c;
        if (rot) { const r = document.createElement('canvas'); r.width = c.height; r.height = c.width; const rg = r.getContext('2d'); rg.translate(r.width / 2, r.height / 2); rg.rotate(Math.PI / 2); rg.drawImage(c, -c.width / 2, -c.height / 2); canvas = r; }
        try {
          const lum = new Z.HTMLCanvasElementLuminanceSource(canvas);
          const bin = new Z.BinaryBitmap(new Z.HybridBinarizer(lum));
          const res = reader.decode(bin); if (res) return res.getText();
        } catch (e) { /* try next size */ }
      }
    }
    return null;
  }
  async function scanFromFile(file, cb) {
    if (!file) return;
    toast('Reading barcode…');
    try {
      const code = await decodePhoto(file);
      if (!code) { toast('No barcode found. Hold the phone closer, keep the barcode flat and well lit, then try again — or type the number.', true); return; }
      (cb || handleCode)(code);
    } catch (e) { toast('Couldn\'t read that photo: ' + e.message, true); }
  }
  // Wires a camera button: on Android it opens the live scanner, in the browser it reads a photo.
  function bindCamera(id, cb) {
    const el = document.getElementById(id); if (!el) return;
    if (window.Native?.scan) {
      el.onclick = async (e) => { e.preventDefault(); try { const code = await window.Native.scan(); if (code) (cb || handleCode)(code); } catch (err) { toast(err.message || 'Scanner not available', true); } };
    } else el.onchange = (e) => scanFromFile(e.target.files[0], cb);
  }
  function cameraButton(id, label, cls = '') {
    if (window.Native?.scan) return `<button type="button" class="btn camera-btn ${cls}" id="${id}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 12h10"/></svg>${esc(label)}</button>`;
    return `<label class="btn camera-btn ${cls}" for="${id}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>${esc(label)}<input id="${id}" type="file" accept="image/*" capture="environment"></label>`;
  }
  function handleCode(code) {
    code = I.codeNorm(code);
    if (!code) return;
    if (S.modalScan) { S.modalScan(code); return; }
    if (S.view === 'count' && V.count?.onScan && $('#modal').hidden && !S.sheetPid) { V.count.onScan(code); return; }
    const p = findByCode(code);
    S.recentScans = [{ code, pid: p?.id, t: Date.now() }, ...S.recentScans.filter((r) => r.code !== code)].slice(0, 8);
    if (p) openSheet(p.id);
    else askRegister(code);
  }
  function askRegister(code) {
    modal(`<div class="modal-h"><h2>New barcode</h2><button class="ghost" data-close>Close</button></div>
      <p><span class="mono">${esc(code)}</span> isn't in your shop yet.</p><p class="small muted">Next, take a photo of the front of the pack and the app fills in the details.</p>
      <div class="actions"><button class="primary" id="regBtn">Register this product</button><button data-close>Cancel</button></div>`);
    $('#regBtn').onclick = () => { closeModal(); productForm(null, { barcode: code }); };
  }

  // ---------- modal + sheet ----------
  function modal(html, onClose) {
    const m = $('#modal'); m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false;
    m.onclick = (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); };
    S.onModalClose = onClose;
    setTimeout(() => { const f = m.querySelector('[autofocus]') || m.querySelector('input,select,button'); f && f.focus(); }, 30);
    return m.firstElementChild;
  }
  function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; S.modalScan = null; const f = S.onModalClose; S.onModalClose = null; f && f(); }
  function confirmBox(title, text, okLabel = 'Yes', danger) {
    return new Promise((res) => {
      let answered = false;
      modal(`<div class="modal-h"><h2>${esc(title)}</h2></div><p>${text}</p><div class="actions"><button class="${danger ? 'danger' : 'primary'}" id="cOk">${esc(okLabel)}</button><button id="cNo">Cancel</button></div>`, () => { if (!answered) res(false); });
      $('#cOk').onclick = () => { answered = true; closeModal(); res(true); };
      $('#cNo').onclick = () => { answered = true; closeModal(); res(false); };
    });
  }
  async function openSheet(pid) {
    S.sheetPid = pid; S.sheetOld = null; S.sheetFilter = 'all';
    const sh = $('#sheet'); sh.hidden = false; sh.scrollTop = 0;
    renderSheet();
    if (!S.imgCache.has(pid) && S.products.get(pid)?.hasImg) {
      try { S.imgCache.set(pid, await Store.getImage(pid)); if (S.sheetPid === pid) renderSheet(); } catch (e) { /* image optional */ }
    }
  }
  function closeSheet() { S.sheetPid = null; const sh = $('#sheet'); sh.hidden = true; sh.innerHTML = ''; }
  function initials(name) { return esc((name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()); }
  function thumb(p) { return p.th ? `<img class="thumb" src="${esc(p.th)}" alt="">` : `<span class="thumb" aria-hidden="true">${initials(p.name)}</span>`; }

  function stockStatus(p, st) {
    if (p.archived) return '<span class="pill">Archived</span>';
    if (st.avail <= 0) return '<span class="pill bad">Out of stock</span>';
    if (num(p.min) > 0 && st.avail <= num(p.min)) return '<span class="pill warn">Low stock</span>';
    return '<span class="pill ok">In stock</span>';
  }
  function speedPill(st) {
    return { fast: '<span class="pill ok">Fast seller</span>', steady: '<span class="pill info">Steady seller</span>', slow: '<span class="pill warn">Slow seller</span>', none: '<span class="pill">No recent sales</span>' }[st.speed];
  }

  function renderSheet() {
    const p = S.products.get(S.sheetPid);
    const sh = $('#sheet');
    if (!p) { sh.innerHTML = `<div class="sheet-top"><button class="ghost" id="shClose">← Back</button><h2>Product removed</h2></div>`; $('#shClose').onclick = closeSheet; return; }
    const own = S.isOwner;
    const keepScroll = sh.scrollTop;
    const st = stats(p);
    const kinds = I.stockByKind(p, S.cfg);
    const big = S.imgCache.get(p.id) || p.th;
    const whereRows = Object.entries(p.stock || {}).filter(([, q]) => num(q) !== 0)
      .sort((a, b) => num(b[1]) - num(a[1]))
      .map(([l, q]) => { const L = locs().find((x) => x.id === l); return `<div class="where-row${L?.kind === 'hold' ? ' hold' : ''}"><div><div><strong>${esc(locName(l))}</strong></div><div class="kind">${esc({ shop: 'Shop', storage: 'Storage', hold: 'Unavailable', other: 'Other' }[L?.kind || 'other'])}${p.locSince?.[l] ? ' · here since ' + fmtDate(p.locSince[l]) : ''}</div></div><b>${fmtN(num(q))}</b></div>`; }).join('');
    const nextExp = p.expiry ? `<span class="pill ${I.daysBetween(today(), p.expiry) < 0 ? 'bad' : I.daysBetween(today(), p.expiry) <= num(S.cfg.settings?.expiryDays, 30) ? 'warn' : ''}">Expiry ${fmtDate(p.expiry)}</span>` : '';
    let ownerHtml = '';
    if (own) {
      const allTime = p.totals || { sold: 0, rev: 0 };
      const ageDays = Math.max(1, I.daysBetween(dkey(p.created || Date.now()), today()) + 1);
      const src = S.sheetOld || S.moves;
      const hm = src.filter((m) => m.p === p.id).slice().reverse();
      const filt = S.sheetFilter || 'all';
      const groups = { all: () => true, in: (m) => m.ty === 'in' || m.ty === 'ret', sale: (m) => m.ty === 'sale', adj: (m) => ['out', 'adj', 'count'].includes(m.ty), xfer: (m) => m.ty === 'xfer', info: (m) => ['new', 'edit', 'archive', 'restore'].includes(m.ty) };
      const shown = hm.filter(groups[filt]).slice(0, 300);
      resolveNames(shown.map((m) => m.by));
      const lastIn = hm.find((m) => m.ty === 'in')?.t || p.lastIn;
      ownerHtml = `
        <div class="card owner-card">
          <div class="card-h"><h2>Sales performance</h2><span class="pill info">Owner only</span></div>
          <div class="small muted">Cost ${money(p.cost)} · Sell ${money(p.price)} · Margin ${fmtN(I.marginPct(p, S.cfg), 1)}%${supName(p.supplierId) ? ' · Supplier ' + esc(supName(p.supplierId)) : ''} · ${speedPill(st)}</div>
          <div class="tiles">
            <div class="tile"><span>Sold today</span><b>${fmtN(st.today.u)}</b></div>
            <div class="tile"><span>This week</span><b>${fmtN(st.week.u)}</b></div>
            <div class="tile"><span>This month</span><b>${fmtN(st.month.u)}</b></div>
            <div class="tile"><span>Total sold</span><b>${fmtN(allTime.sold)}</b></div>
            <div class="tile"><span>Avg per day (28 days)</span><b>${fmtN(st.v, 1)}</b></div>
            <div class="tile"><span>Avg per day (since added)</span><b>${fmtN(num(allTime.sold) / ageDays, 1)}</b></div>
            <div class="tile"><span>Last sale</span><b class="small">${p.lastSale ? fmtDate(p.lastSale) : 'Never'}</b></div>
            <div class="tile"><span>Last delivery</span><b class="small">${lastIn ? fmtDate(lastIn) : 'Never'}</b></div>
            <div class="tile"><span>Stock lasts about</span><b>${Number.isFinite(st.cover) ? fmtN(st.cover) + ' days' : '—'}</b></div>
            <div class="tile"><span>Revenue (all time)</span><b>${money(allTime.rev)}</b></div>
          </div>
        </div>
        <div class="card owner-card">
          <div class="card-h"><h2>Stock history</h2><span class="muted small">${S.sheetOld ? 'Full history' : 'Last 120 days'}</span></div>
          <div class="chips" role="group" aria-label="Filter history">
            ${[['all', 'All'], ['in', 'Received'], ['sale', 'Sales'], ['adj', 'Adjustments'], ['xfer', 'Moves'], ['info', 'Edits']].map(([k, l]) => `<button class="chip${filt === k ? ' on' : ''}" data-hf="${k}">${l}</button>`).join('')}
          </div>
          ${shown.length ? `<div class="tablebox"><table><thead><tr><th>When</th><th>What</th><th class="n">Qty</th><th>Where</th><th class="n">Balance</th><th>Details</th><th>By</th></tr></thead><tbody>
            ${shown.map((m) => histRow(m, p)).join('')}</tbody></table></div>` : '<div class="empty">Nothing here yet.</div>'}
          ${S.sheetOld ? '' : '<div><button id="shOld">Load full history</button></div>'}
        </div>
        <div class="row">
          ${p.archived ? `<button data-act="restore"${S.ro ? ' disabled' : ''}>Restore product</button>` : `<button data-act="archive"${S.ro ? ' disabled' : ''}>Archive product</button>`}
          <button class="danger" data-act="delete">Delete permanently</button>
        </div>
        <p class="small muted">Added ${fmtDate(p.created)}${p.updatedAt ? ' · last changed ' + fmtDT(p.updatedAt) + ' by ' + esc(nameOf(p.updatedBy)) : ''}</p>`;
    }
    sh.innerHTML = `
      <div class="sheet-top"><button class="ghost" id="shClose" aria-label="Back">← Back</button><h2>${esc(p.name)}</h2><button class="ghost" id="shEdit"${S.ro ? ' disabled' : ''}>Edit</button></div>
      <div class="sheet-body"><div class="wrap">
        <div class="card">
          <div class="prod-head">
            ${big ? `<img class="prod-img" src="${esc(big)}" alt="Photo of ${esc(p.name)}">` : `<span class="prod-img" aria-hidden="true">${initials(p.name)}</span>`}
            <div class="stack">
              <h1>${esc(p.name)}</h1>
              <div class="row">${stockStatus(p, st)} ${nextExp} ${p.category ? `<span class="pill info">${esc(p.category)}</span>` : ''}</div>
              <div class="price-tag">${num(p.price) ? money(p.price) : '<span class="muted small">No price set</span>'}</div>
              <div class="small muted">${p.barcode ? `Barcode <span class="mono">${esc(p.barcode)}</span>` : 'No barcode'}${p.sku ? ` · SKU <span class="mono">${esc(p.sku)}</span>` : ''}${p.brand ? ' · ' + esc(p.brand) : ''}${p.packSize ? ' · ' + esc(p.packSize) : ''}</div>
              ${p.desc ? `<p class="small">${esc(p.desc)}</p>` : ''}
            </div>
          </div>
        </div>
        <div class="grid2">
          <div class="card">
            <div class="card-h"><h2>In stock</h2><span class="muted small">${num(p.min) ? 'minimum ' + fmtN(num(p.min)) : ''}</span></div>
            <div><span class="bigstock">${fmtN(st.total)}</span> <span class="muted">${esc(I.unitName(p, st.total))}</span></div>
            ${I.breakdown(p, st.total) ? `<div class="muted">= ${esc(I.breakdown(p, st.total))}</div>` : ''}
            <div class="tiles">
              <div class="tile"><span>On shop floor</span><b>${fmtN(kinds.shop)}</b></div>
              <div class="tile"><span>In storage</span><b>${fmtN(kinds.storage)}</b></div>
              ${kinds.other ? `<div class="tile"><span>Other places</span><b>${fmtN(kinds.other)}</b></div>` : ''}
              ${kinds.hold ? `<div class="tile warn"><span>Unavailable</span><b>${fmtN(kinds.hold)}</b></div>` : ''}
            </div>
          </div>
          <div class="card">
            <div class="card-h"><h2>Where to find it</h2></div>
            <div class="where">${whereRows || '<div class="empty">No stock recorded in any location.</div>'}</div>
            ${p.loc ? `<div class="small muted">Usual place: ${esc(locName(p.loc))}</div>` : ''}
          </div>
        </div>
        <div class="actions">
          <button class="primary" data-act="in"${S.ro ? ' disabled' : ''}>Receive stock</button>
          <button data-act="out"${S.ro ? ' disabled' : ''}>${own ? 'Sell / remove' : 'Remove stock'}</button>
          <button data-act="xfer"${S.ro ? ' disabled' : ''}>Move stock</button>
          <button data-act="count"${S.ro ? ' disabled' : ''}>Count stock</button>
        </div>
        ${ownerHtml}
      </div></div>`;
    sh.scrollTop = keepScroll;
    $('#shClose').onclick = closeSheet;
    $('#shEdit').onclick = () => productForm(p);
    $$('[data-hf]', sh).forEach((b) => (b.onclick = () => { S.sheetFilter = b.dataset.hf; renderSheet(); }));
    $$('[data-act]', sh).forEach((b) => (b.onclick = () => sheetAction(b.dataset.act, p)));
    const old = $('#shOld');
    if (old) old.onclick = async () => { old.disabled = true; old.textContent = 'Loading…'; try { const all = await Store.loadDays('2000-01-01', today()); S.sheetOld = all; } catch (e) { toast(e.message, true); } renderSheet(); };
  }
  function histRow(m, p) {
    const K = I.KINDS[m.ty] || { label: m.ty };
    const sign = m.ty === 'xfer' ? '' : (m.d > 0 ? '+' : '');
    const qty = m.ty === 'xfer' ? fmtN(m.q) : (['new', 'edit', 'archive', 'restore'].includes(m.ty) ? '' : sign + fmtN(m.d));
    const cls = m.d > 0 ? 'tag-in' : m.d < 0 ? 'tag-out' : '';
    const where = m.ty === 'xfer' ? esc(locName(m.l)) + ' → ' + esc(locName(m.to)) : esc(m.l ? locName(m.l) : '');
    const det = [m.r, m.u, m.pr != null && m.ty === 'sale' ? money(m.pr) + ' each' : '', m.ch, m.sup ? supName(m.sup) : '', m.ref ? 'Ref ' + m.ref : '', m.no, m.src].filter(Boolean).map(esc).join(' · ');
    return `<tr><td>${fmtDT(m.t)}</td><td>${esc(K.label)}</td><td class="n ${cls}">${qty}</td><td>${where}</td><td class="n">${['edit', 'archive', 'restore'].includes(m.ty) ? '' : fmtN(m.b)}</td><td class="small">${det}</td><td class="small">${esc(nameOf(m.by))}</td></tr>`;
  }
  async function sheetAction(act, p) {
    if (act === 'in') return stockInForm(p);
    if (act === 'out') return stockOutForm(p);
    if (act === 'xfer') return transferForm(p);
    if (act === 'count') return countForm(p);
    if (!S.isOwner) return;
    if (act === 'archive' || act === 'restore') {
      if (act === 'archive' && !(await confirmBox('Archive product?', 'It disappears from lists and alerts but keeps its history. You can restore it any time.', 'Archive'))) return;
      try { const r = await Store.saveProduct({ ...p, archived: act === 'archive' }); applyLocal({ updated: [r] }); await Store.logEvent(act, p); toast(act === 'archive' ? 'Archived' : 'Restored'); } catch (e) { toast(e.message, true); }
    }
    if (act === 'delete') {
      if (!(await confirmBox('Delete permanently?', `This removes <strong>${esc(p.name)}</strong>. Past reports keep their lines. Archiving is usually better.`, 'Delete', true))) return;
      try { await Store.logEvent('delete', p); await Store.deleteProduct(p.id); S.pub.delete(p.id); S.priv.delete(p.id); closeSheet(); recompute(); refresh(); toast('Deleted'); } catch (e) { toast(e.message, true); }
    }
  }

  // ---------- shared form bits ----------
  function nowLocal() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
  function parseLocal(v) { const t = v ? new Date(v).getTime() : Date.now(); return Number.isFinite(t) ? t : Date.now(); }
  function locSelect(id, sel, opts = {}) {
    const list = locs().filter((l) => !opts.only || opts.only(l));
    return `<select id="${id}">${opts.auto ? opt('', opts.auto, !sel) : ''}${list.map((l) => opt(l.id, l.name + (opts.qty ? ' (' + fmtN(num(opts.qty[l.id])) + ')' : ''), sel === l.id)).join('')}</select>`;
  }
  function qtyFields(p, prefix, label = 'Quantity') {
    const types = I.unitTypesFor(p);
    return `<label for="${prefix}Q">${esc(label)}<input id="${prefix}Q" type="number" inputmode="decimal" min="0" step="any" required autofocus></label>
      <label for="${prefix}U">Counted in<select id="${prefix}U">${types.map((t) => opt(t.k, t.k === 'unit' ? I.unitName(p, 2).replace(/^./, (c) => c.toUpperCase()) : t.label + ' of ' + I.perUnit(p, t.k), false)).join('')}</select></label>
      <div class="full notice" id="${prefix}T">Enter a quantity.</div>`;
  }
  function wireQty(p, prefix, after) {
    const q = $('#' + prefix + 'Q'), u = $('#' + prefix + 'U'), t = $('#' + prefix + 'T');
    const calc = () => {
      const n = num(q.value), per = I.perUnit(p, u.value), tot = Math.round(n * per * 1000) / 1000;
      t.textContent = n ? (per > 1 ? `${fmtN(n, 2)} × ${per} = ${fmtN(tot, 2)} ${I.unitName(p, tot)}` : `${fmtN(tot, 2)} ${I.unitName(p, tot)}`) + (after ? ' · ' + after(tot) : '') : 'Enter a quantity.';
      return tot;
    };
    q.oninput = calc; u.onchange = calc;
    return () => ({ total: calc(), n: num(q.value), unit: u.value, per: I.perUnit(p, u.value) });
  }
  function unitLabel(p, r) { return r.per > 1 ? `${fmtN(r.n, 2)} ${r.unit}${r.n === 1 ? '' : (r.unit === 'box' ? 'es' : 's')} × ${r.per}` : ''; }
  async function submitMoves(items, btn, okMsg) {
    if (S.ro) { toast('You have view-only access.', true); return false; }
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Saving…';
    try {
      const res = await Store.record(items, S.cfg, (d, n) => { if (n > 3) btn.textContent = `Saving ${d}/${n}…`; });
      applyLocal(res);
      if (res.failed.length) { toast(`${res.failed.length} item(s) could not be saved: ${res.failed[0].error}`, true); btn.disabled = false; btn.textContent = label; return false; }
      closeModal(); toast(okMsg || 'Saved'); return true;
    } catch (e) { toast(e.message || 'Could not save', true); btn.disabled = false; btn.textContent = label; return false; }
  }

  // ---------- stock in ----------
  function stockInForm(p) {
    const sups = S.cfg.suppliers || [];
    modal(`<div class="modal-h"><h2>Receive stock</h2><button class="ghost" data-close>Close</button></div>
      <p class="muted">${esc(p.name)} · now ${fmtN(totalStock(p))} ${esc(I.unitName(p, 2))}</p>
      <form id="fIn" class="form">
        ${qtyFields(p, 'in', 'Quantity received')}
        <label for="inKind">Type<select id="inKind">${I.IN_REASONS.map((r) => opt(r, r)).join('')}${opt('ret', 'Customer return')}</select></label>
        <label for="inLoc">Put it in${locSelect('inLoc', p.loc || I.firstShopLoc(S.cfg))}</label>
        ${S.isOwner ? `<label for="inSup">Supplier<select id="inSup">${opt('', '—')}${sups.map((s) => opt(s.id, s.name, s.id === p.supplierId)).join('')}</select></label>
        <label for="inCost">Cost per ${esc(I.unitName(p, 1))} (ex VAT)<input id="inCost" type="number" inputmode="decimal" step="0.01" min="0" value="${num(p.cost) || ''}"></label>` : ''}
        <label for="inWhen">Date &amp; time arrived<input id="inWhen" type="datetime-local" value="${nowLocal()}"></label>
        <label for="inRef">Delivery / invoice ref<input id="inRef" autocomplete="off"></label>
        <label for="inExp">Expiry date (if any)<input id="inExp" type="date"></label>
        <label class="full" for="inNote">Notes<input id="inNote" autocomplete="off"></label>
        <div class="full actions"><button class="primary" id="inSave" type="submit">Add to stock</button></div>
      </form>`);
    const get = wireQty(p, 'in', (tot) => 'stock becomes ' + fmtN(totalStock(p) + tot));
    $('#fIn').onsubmit = (e) => {
      e.preventDefault();
      const r = get(); if (!(r.total > 0)) return toast('Enter how many arrived.', true);
      const kind = $('#inKind').value;
      submitMoves([{ pid: p.id, name: p.name, ty: kind === 'ret' ? 'ret' : 'in', q: r.total, l: $('#inLoc').value, sup: S.isOwner ? $('#inSup').value || undefined : undefined, c: S.isOwner && $('#inCost').value !== '' ? num($('#inCost').value) : undefined, t: parseLocal($('#inWhen').value), ref: $('#inRef').value.trim(), exp: $('#inExp').value || undefined, no: $('#inNote').value.trim(), r: kind === 'ret' ? 'Customer return' : kind, u: unitLabel(p, r) }], $('#inSave'), `Added ${fmtN(r.total)} ${I.unitName(p, r.total)}`);
    };
  }

  // ---------- stock out ----------
  function stockOutForm(p) {
    const ch = S.cfg.channels || ['Till'];
    modal(`<div class="modal-h"><h2>Sell or remove</h2><button class="ghost" data-close>Close</button></div>
      <p class="muted">${esc(p.name)} · ${fmtN(I.available(p, S.cfg))} available</p>
      <form id="fOut" class="form">
        ${qtyFields(p, 'out')}
        <label for="outWhy">Reason<select id="outWhy">${S.isOwner ? opt('sale', 'Sale') : ''}${I.OUT_REASONS.map((r) => opt(r, r)).join('')}</select></label>
        <label for="outLoc">Take from${locSelect('outLoc', '', { auto: 'Shop floor first, then storage', qty: p.stock })}</label>
        <label for="outPrice" id="outPriceL">Selling price each<input id="outPrice" type="number" inputmode="decimal" step="0.01" min="0" value="${num(p.price) || ''}"></label>
        <label for="outCh" id="outChL">Sold via<select id="outCh">${ch.map((c) => opt(c, c)).join('')}</select></label>
        <label for="outWhen">Date &amp; time<input id="outWhen" type="datetime-local" value="${nowLocal()}"></label>
        <label class="full" for="outNote">Notes<input id="outNote" autocomplete="off"></label>
        <div class="full notice warn" id="outWarn" hidden></div>
        <div class="full actions"><button class="primary" id="outSave" type="submit">Record</button></div>
      </form>`);
    const why = $('#outWhy');
    const sync = () => { const sale = why.value === 'sale'; $('#outPriceL').hidden = !sale; $('#outChL').hidden = !sale; };
    why.onchange = sync; sync();
    const get = wireQty(p, 'out', (tot) => {
      const l = $('#outLoc').value; const have = l ? num(p.stock?.[l]) : I.available(p, S.cfg);
      const w = $('#outWarn'); w.hidden = tot <= have; w.textContent = `Only ${fmtN(have)} recorded ${l ? 'in ' + locName(l) : 'available'}. You can still save — the stock will go below zero, which usually means a delivery or count wasn't recorded.`;
      return (S.isOwner && why.value === 'sale' && num($('#outPrice').value) ? money(tot * num($('#outPrice').value)) + ' · ' : '') + fmtN(totalStock(p) - tot) + ' left';
    });
    $('#outLoc').onchange = get; $('#outPrice').oninput = get;
    $('#fOut').onsubmit = (e) => {
      e.preventDefault();
      const r = get(); if (!(r.total > 0)) return toast('Enter a quantity.', true);
      const sale = why.value === 'sale';
      submitMoves([{ pid: p.id, name: p.name, ty: sale ? 'sale' : 'out', q: r.total, l: $('#outLoc').value || undefined, pr: sale ? num($('#outPrice').value) : undefined, ch: sale ? $('#outCh').value : undefined, r: sale ? undefined : why.value, t: parseLocal($('#outWhen').value), no: $('#outNote').value.trim(), u: unitLabel(p, r) }], $('#outSave'), sale ? `Sold ${fmtN(r.total)} · ${fmtN(totalStock(p) - r.total)} left` : 'Removed from stock');
    };
  }

  // ---------- transfer ----------
  function transferForm(p) {
    const have = Object.entries(p.stock || {}).filter(([, q]) => num(q) > 0);
    if (!have.length) { toast('There is no stock to move. Receive or count stock first.', true); return; }
    modal(`<div class="modal-h"><h2>Move stock</h2><button class="ghost" data-close>Close</button></div>
      <p class="muted">${esc(p.name)}</p>
      <form id="fX" class="form">
        <label for="xFrom">From${locSelect('xFrom', have[0][0], { only: (l) => num(p.stock?.[l.id]) > 0, qty: p.stock })}</label>
        <label for="xTo">To${locSelect('xTo', (locs().find((l) => l.kind === 'shop' && l.id !== have[0][0]) || locs()[0]).id)}</label>
        ${qtyFields(p, 'x', 'Quantity to move')}
        <div class="full row"><button type="button" id="xAll">Move all of it</button></div>
        <label class="full" for="xNote">Notes<input id="xNote" autocomplete="off"></label>
        <div class="full actions"><button class="primary" id="xSave" type="submit">Move</button></div>
      </form>`);
    const get = wireQty(p, 'x', (tot) => `${fmtN(num(p.stock?.[$('#xFrom').value]) - tot)} left in ${locName($('#xFrom').value)}`);
    $('#xAll').onclick = () => { $('#xU').value = 'unit'; $('#xQ').value = num(p.stock?.[$('#xFrom').value]); get(); };
    $('#xFrom').onchange = get;
    $('#fX').onsubmit = (e) => {
      e.preventDefault(); const r = get();
      const from = $('#xFrom').value, to = $('#xTo').value;
      if (from === to) return toast('Pick two different places.', true);
      if (!(r.total > 0)) return toast('Enter a quantity.', true);
      if (r.total > num(p.stock?.[from])) return toast(`Only ${fmtN(num(p.stock?.[from]))} in ${locName(from)}.`, true);
      submitMoves([{ pid: p.id, name: p.name, ty: 'xfer', q: r.total, l: from, to, no: $('#xNote').value.trim(), u: unitLabel(p, r) }], $('#xSave'), `Moved ${fmtN(r.total)} to ${locName(to)}`);
    };
  }

  // ---------- count ----------
  function countForm(p) {
    modal(`<div class="modal-h"><h2>Count stock</h2><button class="ghost" data-close>Close</button></div>
      <p class="muted">Count what's physically there. The app records the difference as an adjustment.</p>
      <form id="fC" class="form">
        <label for="cLoc">Location${locSelect('cLoc', Object.keys(p.stock || {})[0] || p.loc || I.firstShopLoc(S.cfg), { qty: p.stock })}</label>
        ${qtyFields(p, 'c', 'Counted quantity')}
        <label class="full" for="cNote">Notes<input id="cNote" autocomplete="off"></label>
        <div class="full actions"><button class="primary" id="cSave" type="submit">Save count</button></div>
      </form>`);
    const get = wireQty(p, 'c', (tot) => { const was = num(p.stock?.[$('#cLoc').value]); const d = tot - was; return `system says ${fmtN(was)} → ${d === 0 ? 'matches' : (d > 0 ? '+' : '') + fmtN(d, 2)}`; });
    $('#cLoc').onchange = get;
    $('#cQ').required = false;
    $('#fC').onsubmit = (e) => {
      e.preventDefault(); const r = get();
      if ($('#cQ').value === '') return toast('Enter what you counted (0 if none).', true);
      submitMoves([{ pid: p.id, name: p.name, ty: 'count', counted: r.total, l: $('#cLoc').value, r: 'Stock count', no: $('#cNote').value.trim() }], $('#cSave'), 'Count saved');
    };
  }

  // ---------- product form ----------
  async function resizeImage(file, max, q) {
    const bmp = await createImageBitmap(file);
    const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  }
  async function squareThumb(dataUrl) {
    const img = new Image(); img.src = dataUrl; await img.decode();
    const s = Math.min(img.width, img.height); const c = document.createElement('canvas'); c.width = c.height = 64;
    c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 64, 64);
    return c.toDataURL('image/jpeg', 0.6);
  }
  // Ask Claude to read the packaging in the photo and suggest the product details.
  async function readPack(file, code) {
    const sample = await claude.use('sample');
    if (!sample) throw { code: 'not_granted' };
    const lim = await sample.limits().catch(() => null);
    if (!lim || !lim.images) throw { code: 'images_unavailable' };
    const cats = (S.cfg.categories || []).join(', ');
    const prompt = `A UK convenience shop is registering a product. The photo shows the product's packaging${code ? ' (its barcode number is ' + code + ')' : ''}.
Read ONLY what you can actually see on the pack. Do not guess prices. Leave a field empty if you can't read it.
Reply with only this JSON:
{"name": "short shelf name as a shop would write it, e.g. 'Coca-Cola Original 330ml Can' or 'Walkers Ready Salted 6 Pack'",
 "brand": "", "size": "e.g. 330ml, 32.5g, 70cl, 4 x 440ml", "category": "the best match from this list, or empty: ${cats}",
 "description": "one plain sentence describing the product, max 20 words",
 "unitName": "one word for a single unit: can, bottle, bag, bar, pack, jar, box, tin, pouch or unit",
 "packQty": "number of items in this pack if it's a multipack, else empty", "barcode": "barcode digits only if clearly printed and readable, else empty"}`;
    return sample.json(prompt, { images: [file], modelTier: 'quick' });
  }
  function aiError(e) {
    return { not_granted: 'Auto-fill needs your permission to use Claude. Type the details instead, or try again and press Allow.', images_unavailable: 'Auto-fill from photos isn\'t available here.', rate_limited: 'Auto-fill is busy. Wait a minute and try again.', refused: 'Couldn\'t read that photo.', invalid_json: 'Couldn\'t read the pack clearly. Try a sharper photo of the front.' }[e?.code] || 'Auto-fill didn\'t work this time. Type the details, or try another photo.';
  }
  function productForm(p, preset) {
    const isNew = !p;
    const own = S.isOwner;
    const d = p ? I.clone(p) : { barcode: '', vat: 20, unitName: 'unit', min: 0, loc: I.firstShopLoc(S.cfg), ...preset };
    const cats = S.cfg.categories || [], sups = S.cfg.suppliers || [];
    const priceLocked = !own && !isNew;
    let newImg = null;
    modal(`<div class="modal-h"><h2>${isNew ? 'Register product' : 'Edit product'}</h2><button class="ghost" data-close>Close</button></div>
      <form id="fP" class="stack">
        <div class="photo-box">
          <span id="pImgPrev">${d.th ? `<img class="prod-img sm" src="${esc(S.imgCache.get(d.id) || d.th)}" alt="">` : '<span class="prod-img sm" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span>'}</span>
          <div class="stack">
            <label class="btn primary camera-btn" for="pImg">${d.th ? 'Retake photo' : 'Take product photo'}<input id="pImg" type="file" accept="image/*" capture="environment"></label>
            <span class="hint" id="pAiMsg">${window.Native ? 'Scan the barcode and the app fills in what it can find. Add a photo if there isn\'t one.' : 'Photograph the front of the pack — the app fills in the name, brand, size and description for you.'}</span>
          </div>
        </div>
        <fieldset><legend>Product</legend>
          <label class="full" for="pName">Product name *<input id="pName" required value="${esc(d.name)}" autocomplete="off"></label>
          <label for="pCode">Barcode / EAN<div class="scan-input"><input id="pCode" class="mono" value="${esc(d.barcode)}" inputmode="numeric" autocomplete="off">${cameraButton('pCodeCam', 'Scan')}</div></label>
          <label for="pSku">SKU / your own code<input id="pSku" value="${esc(d.sku)}" autocomplete="off"></label>
          <label for="pCat">Category<input id="pCat" list="catList" value="${esc(d.category)}" autocomplete="off"><datalist id="catList">${cats.map((c) => opt(c, c)).join('')}</datalist></label>
          <label for="pBrand">Brand<input id="pBrand" value="${esc(d.brand)}" autocomplete="off"></label>
          <label for="pSize">Size<input id="pSize" value="${esc(d.packSize)}" placeholder="330ml, 70g" autocomplete="off"></label>
          <label class="full" for="pDesc">Description<textarea id="pDesc">${esc(d.desc)}</textarea></label>
          <label for="pPrice">Selling price${priceLocked ? ' (only the owner can change it)' : ''}<input id="pPrice" type="number" inputmode="decimal" step="0.01" min="0" value="${d.price ?? ''}"${priceLocked ? ' disabled' : ''}></label>
        </fieldset>
        ${own ? `<fieldset class="owner-card"><legend>Cost &amp; profit · owner only</legend>
          <label for="pCost">Cost price per unit (ex VAT)<input id="pCost" type="number" inputmode="decimal" step="0.01" min="0" value="${d.cost ?? ''}"></label>
          <label for="pVat">VAT rate<select id="pVat">${[20, 5, 0].map((v) => opt(v, v + '%', num(d.vat, 20) === v)).join('')}</select></label>
          <label for="pSup">Supplier<select id="pSup">${opt('', '—')}${sups.map((s) => opt(s.id, s.name, s.id === d.supplierId)).join('')}</select></label>
          <div class="full notice" id="pMargin"></div>
        </fieldset>` : ''}
        <details${isNew ? '' : ' open'}><summary>Packs, location &amp; stock rules</summary><div class="stack" style="margin-top:12px">
        <fieldset><legend>Packs &amp; units</legend>
          <label for="pUnit">One unit is a…<input id="pUnit" value="${esc(d.unitName || 'unit')}" placeholder="can, bottle, bag" autocomplete="off"></label>
          <label for="pPack">Units per pack<input id="pPack" type="number" inputmode="numeric" min="0" value="${d.packQty || ''}" placeholder="e.g. 4"></label>
          <label for="pBox">Units per box<input id="pBox" type="number" inputmode="numeric" min="0" value="${d.boxQty || ''}"></label>
          <label for="pCase">Units per case<input id="pCase" type="number" inputmode="numeric" min="0" value="${d.caseQty || ''}" placeholder="e.g. 24"></label>
        </fieldset>
        <fieldset><legend>Stock rules</legend>
          <label for="pLoc">Usual location${locSelect('pLoc', d.loc)}</label>
          <label for="pMin">Minimum stock<input id="pMin" type="number" inputmode="numeric" min="0" value="${d.min ?? ''}"><span class="hint">Warn when stock gets this low</span></label>
          <label for="pMax">Maximum stock (optional)<input id="pMax" type="number" inputmode="numeric" min="0" value="${d.max || ''}"></label>
          <label for="pExp">Expiry date (if any)<input id="pExp" type="date" value="${esc(d.expiry || '')}"></label>
        </fieldset></div></details>
        ${isNew ? `<fieldset><legend>How many do you have now? (optional)</legend>
          <label for="pOpen">Quantity<input id="pOpen" type="number" inputmode="decimal" min="0" step="any"></label>
          <label for="pOpenU">Counted in<select id="pOpenU">${I.UNIT_TYPES.map((t) => opt(t.k, t.k === 'unit' ? 'Units' : t.label)).join('')}</select></label>
          <label for="pOpenL">Where${locSelect('pOpenL', d.loc)}</label>
        </fieldset>` : ''}
        <div class="notice bad" id="pErr" hidden></div>
        <div class="actions"><button class="primary" id="pSave" type="submit">${isNew ? 'Save product' : 'Save changes'}</button></div>
      </form>`);
    const mg = () => {
      if (!own) return;
      const t = { cost: num($('#pCost').value), price: num($('#pPrice').value), vat: num($('#pVat').value) };
      const net = I.netPrice(t, S.cfg);
      $('#pMargin').innerHTML = t.price ? `Profit per unit <strong>${money(net - t.cost)}</strong> · margin <strong>${fmtN(I.marginPct(t, S.cfg), 1)}%</strong>${S.cfg.settings?.pricesIncVat !== false && t.vat ? ` <span class="muted">(the price includes ${t.vat}% VAT, so ${money(net)} is yours before costs)</span>` : ''}` : 'Enter prices to see the profit margin.';
    };
    if (own) { ['#pCost', '#pPrice'].forEach((s) => ($(s).oninput = mg)); $('#pVat').onchange = mg; mg(); }
    const gotCode = (code) => { $('#pCode').value = code; const other = findByCode(code); if (other && other.id !== d.id) toast(`That barcode belongs to ${other.name}`, true); else if (isNew) lookupCode(code); };
    bindCamera('pCodeCam', gotCode);
    S.modalScan = gotCode;
    // Android app: look the barcode up in the free Open Food Facts database and fill in what it knows.
    let looked = '';
    const lookupCode = async (code) => {
      if (!window.Native?.lookup || !code || code === looked || code.length < 8) return;
      looked = code; const msg = $('#pAiMsg'); msg.textContent = 'Looking up this barcode…'; msg.className = 'hint busy';
      try {
        const r = await window.Native.lookup(code);
        if (!r) { msg.textContent = 'Not found in the product database. Take a photo and type the details.'; msg.className = 'hint'; return; }
        const fill = (sel, v) => { const el = $(sel); if (el && v && String(v).trim() && !el.value.trim()) el.value = String(v).trim(); };
        fill('#pName', r.name); fill('#pBrand', r.brand); fill('#pSize', r.size); fill('#pDesc', r.description);
        if (r.category && !$('#pCat').value) fill('#pCat', r.category);
        if (r.image && !newImg) { const big = await resizeImage(await (await fetch(r.image)).blob(), 640, 0.72); const th = await squareThumb(big); newImg = { big, th }; $('#pImgPrev').innerHTML = `<img class="prod-img sm" src="${big}" alt="">`; }
        msg.textContent = 'Details filled in from the product database — check them before saving.'; msg.className = 'hint ok';
      } catch (err) { msg.textContent = 'Couldn\'t look it up right now. Type the details or take a photo.'; msg.className = 'hint'; }
    };
    $('#pCode').addEventListener('change', () => isNew && lookupCode(I.codeNorm($('#pCode').value)));
    if (isNew && d.barcode) setTimeout(() => lookupCode(d.barcode), 50);
    $('#pImg').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const msg = $('#pAiMsg');
      try { const big = await resizeImage(f, 640, 0.72); const th = await squareThumb(big); newImg = { big, th }; $('#pImgPrev').innerHTML = `<img class="prod-img sm" src="${big}" alt="">`; } catch (err) { toast('Could not use that photo', true); return; }
      if (window.Native) { msg.textContent = 'Photo added.'; msg.className = 'hint ok'; return; }
      msg.textContent = 'Reading the packaging…'; msg.className = 'hint busy';
      try {
        const r = await readPack(f, $('#pCode').value.trim());
        const fill = (sel, v) => { const el = $(sel); if (el && v != null && String(v).trim() && !el.value.trim()) el.value = String(v).trim(); };
        fill('#pName', r.name); fill('#pBrand', r.brand); fill('#pSize', r.size); fill('#pDesc', r.description); fill('#pCat', r.category);
        if (r.unitName && ($('#pUnit').value === 'unit' || !$('#pUnit').value)) $('#pUnit').value = String(r.unitName).toLowerCase();
        if (num(r.packQty) > 1) fill('#pPack', num(r.packQty));
        if (r.barcode && /^\d{8,14}$/.test(String(r.barcode)) && !$('#pCode').value) $('#pCode').value = r.barcode;
        msg.textContent = 'Details filled in from the photo — check them before saving.'; msg.className = 'hint ok';
      } catch (err) { msg.textContent = aiError(err); msg.className = 'hint'; }
    };
    $('#fP').onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#pErr'); err.hidden = true;
      const code = I.codeNorm($('#pCode').value), sku = $('#pSku').value.trim();
      const dup = code && [...S.products.values()].find((x) => x.id !== d.id && I.codeNorm(x.barcode) === code);
      if (dup) { err.hidden = false; err.textContent = `This barcode is already used by "${dup.name}".`; return; }
      const dupS = sku && [...S.products.values()].find((x) => x.id !== d.id && norm(x.sku) === norm(sku));
      if (dupS) { err.hidden = false; err.textContent = `This SKU is already used by "${dupS.name}".`; return; }
      const cat = $('#pCat').value.trim();
      const np = {
        ...d, name: $('#pName').value.trim(), barcode: code, sku, category: cat, brand: $('#pBrand').value.trim(), desc: $('#pDesc').value.trim(),
        price: priceLocked ? d.price : num($('#pPrice').value),
        unitName: $('#pUnit').value.trim() || 'unit', packSize: $('#pSize').value.trim(), packQty: num($('#pPack').value) || 0, boxQty: num($('#pBox').value) || 0, caseQty: num($('#pCase').value) || 0,
        loc: $('#pLoc').value, min: num($('#pMin').value), max: num($('#pMax').value) || 0, expiry: $('#pExp').value || '',
      };
      if (own) Object.assign(np, { cost: num($('#pCost').value), vat: num($('#pVat').value), supplierId: $('#pSup').value || '' });
      if (!np.name) { err.hidden = false; err.textContent = 'Give the product a name.'; return; }
      if (isNew) { np.created = Date.now(); np.stock = {}; np.id = I.uid(); if (own) np.totals = { sold: 0, rev: 0, cost: 0, in: 0, out: 0 }; }
      if (newImg) { np.th = newImg.th; np.hasImg = true; }
      const btn = $('#pSave'); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        if (newImg) { await Store.saveImage(np.id, newImg.big); S.imgCache.set(np.id, newImg.big); }
        const saved = await Store.saveProduct(np, isNew);
        applyLocal({ updated: [saved] });
        await Store.logEvent(isNew ? 'new' : 'edit', np).catch(() => {});
        if (own && cat && !cats.includes(cat)) { S.cfg.categories = [...cats, cat]; Store.saveConfig(S.cfg).catch(() => {}); }
        const open = isNew ? num($('#pOpen').value) : 0;
        if (open > 0) {
          const per = I.perUnit(np, $('#pOpenU').value);
          const res = await Store.record([{ pid: saved.pid, ty: 'in', q: open * per, l: $('#pOpenL').value, r: 'Opening stock', u: per > 1 ? `${open} × ${per}` : undefined }], S.cfg);
          applyLocal(res);
        }
        closeModal(); toast(isNew ? 'Product registered' : 'Saved');
        openSheet(saved.pid);
      } catch (ex) { btn.disabled = false; btn.textContent = 'Try again'; err.hidden = false; err.textContent = ex.message || 'Could not save.'; }
    };
  }
  const norm = I.norm;

  // ---------- basket: several products at once (a sale, or a delivery) ----------
  function basket(mode) {
    const lines = [];
    const sale = mode === 'sale' && S.isOwner;
    const showV = S.isOwner;
    const sups = S.cfg.suppliers || [];
    const box = modal(`<div class="modal-h"><h2>${sale ? 'New sale' : 'Receive a delivery'}</h2><button class="ghost" data-close>Close</button></div>
      <p class="muted small">${sale ? 'Scan or search each item. Use this for sales that didn\'t go through the till.' : 'Scan or search each product on the delivery note.'}</p>
      <div class="scan-input"><input id="bCode" placeholder="Scan, type barcode or name" autocomplete="off" autofocus>${cameraButton('bCam', 'Camera')}</div>
      <div id="bHits" class="list"></div>
      <div id="bLines"></div>
      <div class="form">
        ${sale ? `<label for="bCh">Sold via<select id="bCh">${(S.cfg.channels || ['Till']).map((c) => opt(c, c)).join('')}</select></label>
          <label for="bLoc">Take from${locSelect('bLoc', '', { auto: 'Shop floor first, then storage' })}</label>`
        : `${showV ? `<label for="bSup">Supplier<select id="bSup">${opt('', '—')}${sups.map((s) => opt(s.id, s.name)).join('')}</select></label>` : ''}
          <label for="bLoc">Put it in${locSelect('bLoc', (locs().find((l) => l.kind === 'storage') || locs()[0]).id)}</label>
          <label for="bRef">Delivery / invoice ref<input id="bRef" autocomplete="off"></label>`}
        <label for="bWhen">Date &amp; time<input id="bWhen" type="datetime-local" value="${nowLocal()}"></label>
      </div>
      <div class="notice" id="bTotal">No items yet.</div>
      <div class="actions"><button class="primary" id="bSave" disabled>${sale ? 'Record sale' : 'Add to stock'}</button></div>`);
    const draw = () => {
      const cls = showV ? 'basket-line' : 'basket-line nov';
      $('#bLines', box).innerHTML = lines.length ? `<div class="${cls} small muted"><span>Item</span><span>Qty (units)</span>${showV ? `<span>${sale ? 'Price each' : 'Cost each'}</span>` : ''}<span></span></div>` + lines.map((l, i) => `<div class="${cls}"><div><div><strong>${esc(l.p.name)}</strong></div><div class="small muted">${fmtN(I.available(l.p, S.cfg))} in stock${l.p.caseQty > 1 ? ' · case of ' + l.p.caseQty : ''}</div></div>
        <input type="number" inputmode="decimal" min="0" step="any" value="${l.q}" data-q="${i}" aria-label="Quantity of ${esc(l.p.name)}">${showV ? `<input type="number" inputmode="decimal" min="0" step="0.01" value="${l.v}" data-v="${i}" aria-label="Price of ${esc(l.p.name)}">` : ''}<button class="ghost" data-rm="${i}" aria-label="Remove ${esc(l.p.name)}">✕</button></div>`).join('') : '';
      $$('[data-q]', box).forEach((inp) => (inp.oninput = () => { lines[inp.dataset.q].q = num(inp.value); tot(); }));
      $$('[data-v]', box).forEach((inp) => (inp.oninput = () => { lines[inp.dataset.v].v = num(inp.value); tot(); }));
      $$('[data-rm]', box).forEach((b) => (b.onclick = () => { lines.splice(+b.dataset.rm, 1); draw(); }));
      tot();
    };
    const tot = () => {
      const u = lines.reduce((s, l) => s + num(l.q), 0), v = lines.reduce((s, l) => s + num(l.q) * num(l.v), 0);
      $('#bTotal', box).textContent = lines.length ? `${lines.length} product(s) · ${fmtN(u)} units` + (showV ? ` · ${sale ? 'total' : 'cost'} ${money(v)}` : '') : 'No items yet.';
      $('#bSave', box).disabled = !lines.length;
    };
    const add = (p) => {
      const ex = lines.find((l) => l.p.id === p.id);
      if (ex) ex.q = num(ex.q) + (sale ? 1 : (num(p.caseQty) > 1 ? num(p.caseQty) : 1));
      else lines.push({ p, q: sale ? 1 : (num(p.caseQty) > 1 ? num(p.caseQty) : 1), v: sale ? num(p.price) : num(p.cost) });
      $('#bCode', box).value = ''; $('#bHits', box).innerHTML = ''; draw(); toast('Added ' + p.name);
    };
    S.modalScan = (code) => { const p = findByCode(code); if (p) add(p); else toast(`${code} isn't registered yet. Register it first.`, true); };
    const inp = $('#bCode', box);
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = inp.value.trim(); const p = findByCode(v); if (p) add(p); else { const hits = search(v); if (hits.length === 1) add(hits[0]); } } };
    inp.oninput = () => {
      const v = inp.value.trim(); const hits = v.length >= 2 ? search(v).slice(0, 6) : [];
      $('#bHits', box).innerHTML = hits.map((p) => `<button class="item" data-pid="${p.id}">${thumb(p)}<div><div class="t">${esc(p.name)}</div><div class="s">${esc(p.barcode || p.sku || '')}</div></div><div class="q">${fmtN(I.available(p, S.cfg))}</div></button>`).join('');
      $$('[data-pid]', box).forEach((b) => (b.onclick = () => add(S.products.get(b.dataset.pid))));
    };
    bindCamera('bCam', S.modalScan);
    $('#bSave', box).onclick = () => {
      const t = parseLocal($('#bWhen').value);
      const loc = $('#bLoc').value || undefined;
      const items = lines.filter((l) => num(l.q) > 0).map((l) => sale
        ? { pid: l.p.id, name: l.p.name, ty: 'sale', q: num(l.q), pr: num(l.v), l: loc, ch: $('#bCh').value, t }
        : { pid: l.p.id, name: l.p.name, ty: 'in', q: num(l.q), c: showV && num(l.v) ? num(l.v) : undefined, l: loc, sup: showV ? $('#bSup').value || undefined : undefined, ref: $('#bRef').value.trim(), r: 'Delivery', t });
      if (!items.length) return toast('Add at least one item with a quantity.', true);
      submitMoves(items, $('#bSave'), sale ? `Sale recorded · ${items.length} product(s)` : `Delivery added · ${items.length} product(s)`);
    };
  }

  function search(q) {
    const n = norm(q); if (!n) return activeProducts();
    const words = n.split(/\s+/);
    return activeProducts().filter((p) => {
      const hay = norm([p.name, p.barcode, p.sku, p.category, p.brand, S.isOwner ? supName(p.supplierId) : '', p.desc].join(' '));
      return words.every((w) => hay.includes(w));
    });
  }

  // ---------- downloads ----------
  async function saveFile(filename, data) {
    if (!S.dl) { toast('Downloads are not available in this view. Open the app on claude.ai.', true); return false; }
    try { await S.dl.save({ filename, data }); return true; } catch (e) { if (e.code !== 'declined') toast('Download failed: ' + (e.message || e.code), true); return false; }
  }

  window.App = {
    S, V, I, $, $$, esc, opt, toast, loadScript, locs, locName, supName, activeProducts, findByCode, stats, nameOf, resolveNames,
    boot, render, refresh, recompute, applyLocal, modal, closeModal, confirmBox, openSheet, closeSheet, thumb, stockStatus, speedPill,
    handleCode, scanFromFile, cameraButton, bindCamera, productForm, stockInForm, stockOutForm, transferForm, countForm, basket, search, saveFile,
    locSelect, nowLocal, parseLocal, submitMoves, histRow,
  };
})();
