/* views.js — the screens: scan, dashboard, products, alerts, reports, stock count, import, settings, help. */
(function () {
  'use strict';
  const A = window.App, I = A.I, S = A.S, V = A.V;
  const { $, $$, esc, opt, toast } = A;
  const { num, money, fmtN, fmtDate, fmtDT, rel, dkey, today, addDays, totalStock, Store } = I;

  const ro = () => (S.ro ? ' disabled' : '');
  const prodRow = (p, right, sub) => `<button class="item" data-pid="${p.id}">${A.thumb(p)}<div><div class="t">${esc(p.name)}</div><div class="s">${sub ?? esc([p.barcode || p.sku, p.category, A.locName(p.loc)].filter(Boolean).join(' · '))}</div></div><div class="q">${right}</div></button>`;
  const wireRows = (root) => $$('[data-pid]', root).forEach((b) => (b.onclick = () => A.openSheet(b.dataset.pid)));

  // ================= first-run set-up =================
  V.setup = {
    render(el) {
      if (!S.isOwner) { el.innerHTML = `<div class="setup card"><h1>Not set up yet</h1><p>The shop owner needs to open this app first and set it up.</p></div>`; return; }
      el.innerHTML = `<div class="setup card">
        <h1>Set up your shop</h1>
        <p>This creates your shop with a starting list of locations (shop floor, shelves, storage room, back room) and categories. You can change all of them later in More → Settings.</p>
        <label for="suName">Shop name<input id="suName" placeholder="e.g. Patel's Family Shopper" autofocus></label>
        <button class="primary big" id="suGo">Set up my shop</button></div>`;
      $('#suGo').onclick = async () => {
        const b = $('#suGo'); b.disabled = true; b.textContent = 'Setting up…';
        try { await Store.saveConfig({ ...I.defaultConfig($('#suName').value.trim() || 'My Shop'), owner: S.uid || null, staff: [] }); toast('Your shop is ready'); }
        catch (e) { toast(e.message || 'Could not set up', true); b.disabled = false; b.textContent = 'Set up my shop'; }
      };
    },
  };

  // ================= scan (home) =================
  V.scan = {
    render(el) {
      const own = S.isOwner;
      el.innerHTML = `<div class="wrap">
        ${S.ro ? '<div class="notice warn">You have view-only access. Ask the owner to give you edit access to record stock.</div>' : ''}
        <section class="scan-card" aria-labelledby="scanH">
          <h1 id="scanH">Scan a product</h1>
          ${A.cameraButton('scanCam', 'Scan barcode', 'primary big')}
          <form id="scanForm" class="scan-input"><input id="scanCode" type="search" placeholder="Or type barcode / product name" autocomplete="off" aria-label="Barcode, SKU or product name"><button type="submit">Find</button></form>
          <div id="scanHits" class="list"></div>
          <p class="small muted">${window.Native ? 'Tap Scan barcode and point the camera at the barcode — it reads it by itself.' : 'Using a Bluetooth barcode scanner? Just scan — the product opens by itself.'}</p>
        </section>
        <div class="quick">
          ${own ? `<button data-go="sale"${ro()}><b>New sale</b><span>Several items, not through the till</span></button>` : ''}
          <button data-go="in"${ro()}><b>Receive a delivery</b><span>Add stock for several products</span></button>
          <button data-go="new"${ro()}><b>Add a product</b><span>For items with no barcode</span></button>
          <button data-go="count"${ro()}><b>Stock count</b><span>Count a shelf or room</span></button>
        </div>
        <div class="tiles" id="scanTiles"></div>
        <div class="card"><div class="card-h"><h2>${own ? "Today's activity" : 'Your activity today'}</h2>${own ? '<a href="#activity" class="small">All activity</a>' : ''}</div><div id="scanAct"></div></div>
      </div>`;
      A.bindCamera('scanCam');
      const inp = $('#scanCode');
      $('#scanForm').onsubmit = (e) => {
        e.preventDefault(); const val = inp.value.trim(); if (!val) return;
        const p = A.findByCode(val); if (p) { inp.value = ''; $('#scanHits').innerHTML = ''; return A.openSheet(p.id); }
        const hits = A.search(val);
        if (hits.length === 1) { inp.value = ''; $('#scanHits').innerHTML = ''; return A.openSheet(hits[0].id); }
        if (!hits.length && /^\d{6,14}$/.test(val)) return A.handleCode(val);
        if (!hits.length) toast('Nothing matches "' + val + '"', true);
      };
      inp.oninput = () => {
        const val = inp.value.trim(); const hits = val.length >= 2 ? A.search(val).slice(0, 6) : [];
        $('#scanHits').innerHTML = hits.map((p) => prodRow(p, fmtN(I.available(p, S.cfg)), esc([money(p.price), A.locName(p.loc)].join(' · ')))).join('');
        wireRows($('#scanHits'));
      };
      $$('[data-go]', el).forEach((b) => (b.onclick = () => {
        const g = b.dataset.go;
        if (g === 'sale' || g === 'in') A.basket(g); else if (g === 'count') location.hash = '#count'; else A.productForm(null, {});
      }));
      this.refresh(el);
    },
    refresh(el) {
      const t = $('#scanTiles', el); if (!t) return;
      const td = today();
      const mv = S.moves.filter((m) => dkey(m.t) === td);
      const low = A.activeProducts().filter((p) => { const a = I.available(p, S.cfg); return a <= 0 || (num(p.min) > 0 && a <= num(p.min)); }).length;
      const sales = mv.filter((m) => m.ty === 'sale').reduce((s, m) => s + num(m.q) * num(m.pr), 0);
      t.innerHTML = (S.isOwner ? `<a class="tile ok" href="#dashboard"><span>Sales today</span><b>${money(sales)}</b></a>` : '') +
        `<a class="tile" href="#stock"><span>Products</span><b>${fmtN(A.activeProducts().length)}</b></a>
        <a class="tile ${low ? 'warn' : ''}" href="#stock" data-low="1"><span>Low or out of stock</span><b>${fmtN(low)}</b></a>`;
      const lowT = $('[data-low]', t); if (lowT) lowT.onclick = () => { V.stock.f.chip = 'low'; };
      const list = mv.slice().reverse().slice(0, 10);
      A.resolveNames(list.map((m) => m.by));
      $('#scanAct', el).innerHTML = list.length ? `<div class="list">${list.map((m) => `<button class="act-row" data-open="${esc(m.p)}"><span class="small muted">${new Date(m.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span><span><b>${esc(m.n)}</b><br><span class="small muted">${esc(I.KINDS[m.ty]?.label || m.ty)}${S.isOwner ? ' · ' + esc(A.nameOf(m.by)) : ''}</span></span><span class="${m.d > 0 ? 'tag-in' : m.d < 0 ? 'tag-out' : ''}">${m.d ? (m.d > 0 ? '+' : '') + fmtN(m.d) : ''}</span></button>`).join('')}</div>` : '<div class="empty">Nothing recorded today yet. Scan a product to start.</div>';
      $$('[data-open]', el).forEach((a) => (a.onclick = () => { if (S.products.has(a.dataset.open)) A.openSheet(a.dataset.open); }));
    },
  };

  // ================= charts =================
  const charts = new Map();
  async function barChart(canvasId, labels, values, opts = {}) {
    try { await A.loadScript('lib/chart.umd.js'); } catch (e) { return; }
    const cv = document.getElementById(canvasId); if (!cv) return;
    charts.get(canvasId)?.destroy();
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--muted').trim(), line = css.getPropertyValue('--line').trim(), col = css.getPropertyValue('--chart').trim();
    const ch = new window.Chart(cv, {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: col, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28 }] },
      options: {
        indexAxis: opts.horizontal ? 'y' : 'x', responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => (opts.money ? money(c.raw) : fmtN(c.raw)) } } },
        scales: {
          x: { grid: { display: !!opts.horizontal, color: line }, ticks: { color: ink, maxRotation: 0, autoSkip: true, callback: opts.horizontal && opts.money ? (v) => '£' + fmtN(v) : undefined } },
          y: { grid: { display: !opts.horizontal, color: line }, ticks: { color: ink, callback: !opts.horizontal && opts.money ? (v) => '£' + fmtN(v) : undefined }, beginAtZero: true },
        },
      },
    });
    charts.set(canvasId, ch);
  }

  // ================= dashboard =================
  V.dashboard = {
    owner: true,
    period: 28,
    render(el) {
      const P = this.period;
      const prods = A.activeProducts();
      const td = today(), from = addDays(td, -(P - 1));
      let units = 0, costVal = 0, retailVal = 0;
      for (const p of prods) { const t = Math.max(0, totalStock(p)); units += t; costVal += t * num(p.cost); retailVal += t * num(p.price); }
      const rows = prods.map((p) => { const st = A.stats(p); const r = I.sumRange(S.idx.get(p.id), from, td); const net = S.cfg.settings?.pricesIncVat !== false ? r.rev / (1 + num(p.vat, 20) / 100) : r.rev; return { p, st, r, profit: net - r.cost }; });
      const al = S.alerts;
      const cnt = (t) => al.filter((a) => a.type === t).length;
      const totRev = rows.reduce((s, x) => s + x.r.rev, 0), totProfit = rows.reduce((s, x) => s + x.profit, 0), totUnits = rows.reduce((s, x) => s + x.r.u, 0);
      const top = (arr, f, n = 6) => arr.filter((x) => f(x) > 0).sort((a, b) => f(b) - f(a)).slice(0, n);
      const fast = top(rows, (x) => x.r.u);
      const slow = rows.filter((x) => x.st.total > 0 && x.r.u > 0).sort((a, b) => a.st.v - b.st.v).slice(0, 6);
      const idle = rows.filter((x) => x.st.total > 0 && x.st.idle >= num(S.cfg.settings?.deadDays, 30)).sort((a, b) => b.st.idle - a.st.idle).slice(0, 6);
      const byRev = top(rows, (x) => x.r.rev), byProfit = top(rows, (x) => x.profit);
      const reorder = al.filter((a) => a.type === 'reorder').slice(0, 6);
      const recentIn = S.moves.filter((m) => m.ty === 'in').slice(-6).reverse();
      const recentSales = S.moves.filter((m) => m.ty === 'sale').slice(-6).reverse();
      const list = (arr, right, sub) => arr.length ? `<div class="list">${arr.map((x) => prodRow(x.p, right(x), sub ? sub(x) : undefined)).join('')}</div>` : '<div class="empty">Nothing to show yet.</div>';
      const mvList = (arr) => arr.length ? `<div class="tablebox"><table><tbody>${arr.map((m) => `<tr><td class="small">${fmtDT(m.t)}</td><td><a href="#" data-open="${esc(m.p)}">${esc(m.n)}</a></td><td class="n">${fmtN(Math.abs(m.d))}</td><td class="small muted">${esc(A.locName(m.l))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">None in the last 120 days.</div>';
      el.innerHTML = `<div class="wrap">
        <div class="row between"><h1>Dashboard</h1><div class="chips" role="group" aria-label="Period">${[7, 28, 90].map((d) => `<button class="chip${P === d ? ' on' : ''}" data-per="${d}">${d} days</button>`).join('')}</div></div>
        <div class="tiles">
          <div class="tile"><span>Products</span><b>${fmtN(prods.length)}</b></div>
          <div class="tile"><span>Units in stock</span><b>${fmtN(units)}</b></div>
          <div class="tile"><span>Stock value (cost)</span><b>${money(costVal)}</b></div>
          <div class="tile"><span>Stock value (retail)</span><b>${money(retailVal)}</b></div>
          <a class="tile ${cnt('low') ? 'warn' : ''}" href="#alerts"><span>Running low</span><b>${fmtN(cnt('low'))}</b></a>
          <a class="tile ${cnt('out') ? 'bad' : ''}" href="#alerts"><span>Out of stock</span><b>${fmtN(cnt('out'))}</b></a>
          <a class="tile ${reorder.length ? 'warn' : ''}" href="#alerts"><span>Need reordering</span><b>${fmtN(cnt('reorder'))}</b></a>
          <a class="tile ${cnt('dead') ? 'warn' : ''}" href="#alerts"><span>Not selling (${fmtN(num(S.cfg.settings?.deadDays, 30))}+ days)</span><b>${fmtN(cnt('dead'))}</b></a>
        </div>
        <div class="tiles">
          <div class="tile ok"><span>Sales, last ${P} days</span><b>${money(totRev)}</b></div>
          <div class="tile ok"><span>Estimated gross profit</span><b>${money(totProfit)}</b></div>
          <div class="tile"><span>Units sold</span><b>${fmtN(totUnits)}</b></div>
          <div class="tile"><span>Average sales per day</span><b>${money(totRev / P)}</b></div>
        </div>
        <div class="grid2">
          <div class="card"><div class="card-h"><h2>Sales per day</h2><span class="small muted">£, last ${P} days</span></div><div class="chartbox"><canvas id="chDaily" role="img" aria-label="Sales revenue per day"></canvas></div></div>
          <div class="card"><div class="card-h"><h2>Sales by category</h2><span class="small muted">£, last ${P} days</span></div><div class="chartbox"><canvas id="chCat" role="img" aria-label="Sales revenue by category"></canvas></div></div>
        </div>
        <div class="grid2">
          <div class="card"><div class="card-h"><h2>Fastest sellers</h2><span class="small muted">units</span></div>${list(fast, (x) => fmtN(x.r.u), (x) => esc(fmtN(x.st.v, 1) + ' a day · ' + fmtN(x.st.avail) + ' left'))}</div>
          <div class="card"><div class="card-h"><h2>Needs reordering</h2><a class="small" href="#alerts">Order list</a></div>${list(reorder, (x) => fmtN(x.qty), (x) => esc(x.text))}</div>
          <div class="card"><div class="card-h"><h2>Highest revenue</h2></div>${list(byRev, (x) => money(x.r.rev))}</div>
          <div class="card"><div class="card-h"><h2>Highest profit</h2></div>${list(byProfit, (x) => money(x.profit))}</div>
          <div class="card"><div class="card-h"><h2>Slow movers</h2><span class="small muted">selling, but slowly</span></div>${list(slow, (x) => fmtN(x.st.v, 2) + '/day', (x) => esc(fmtN(x.st.total) + ' in stock · lasts ~' + (Number.isFinite(x.st.cover) ? fmtN(x.st.cover) + ' days' : '—')))}</div>
          <div class="card"><div class="card-h"><h2>Forgotten stock</h2><span class="small muted">no sale for a long time</span></div>${list(idle, (x) => fmtN(x.st.idle) + ' days', (x) => esc(fmtN(x.st.total) + ' in stock · ' + (x.p.lastSale ? 'last sold ' + fmtDate(x.p.lastSale) : 'never sold')))}</div>
          <div class="card"><div class="card-h"><h2>Recently received</h2></div>${mvList(recentIn)}</div>
          <div class="card"><div class="card-h"><h2>Recent sales</h2></div>${mvList(recentSales)}</div>
        </div>
        ${!S.moves.some((m) => m.ty === 'sale') ? '<div class="notice">Sales figures appear once sales are recorded. The easiest way is to import your till\'s sales report each day (Back office → Import).</div>' : ''}
      </div>`;
      $$('[data-per]', el).forEach((b) => (b.onclick = () => { this.period = +b.dataset.per; this.render(el); }));
      wireRows(el);
      $$('[data-open]', el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); if (S.products.has(a.dataset.open)) A.openSheet(a.dataset.open); }));
      // charts
      const days = []; for (let i = P - 1; i >= 0; i--) days.push(addDays(td, -i));
      const perDay = new Map(days.map((d) => [d, 0]));
      const perCat = new Map();
      for (const m of S.moves) {
        if (m.ty !== 'sale' && m.ty !== 'ret') continue; const d = dkey(m.t); if (d < from) continue;
        const v = (m.ty === 'sale' ? 1 : -1) * Math.abs(m.q) * num(m.pr);
        if (perDay.has(d)) perDay.set(d, perDay.get(d) + v);
        const c = S.products.get(m.p)?.category || m.cat || 'Uncategorised'; perCat.set(c, (perCat.get(c) || 0) + v);
      }
      barChart('chDaily', days.map((d) => new Date(d + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })), days.map((d) => Math.round(perDay.get(d) * 100) / 100), { money: true });
      const cats = [...perCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      barChart('chCat', cats.map((c) => c[0]), cats.map((c) => Math.round(c[1] * 100) / 100), { money: true, horizontal: true });
    },
    live: true,
  };

  // ================= products =================
  V.stock = {
    f: { q: '', chip: 'all', loc: '', cat: '', sort: 'name', archived: false },
    render(el) {
      const f = this.f;
      const cats = [...new Set([...(S.cfg.categories || []), ...A.activeProducts().map((p) => p.category).filter(Boolean)])].sort();
      el.innerHTML = `<div class="wrap">
        <div class="row between"><h1>Stock</h1><div class="row"><button id="prAdd" class="primary"${ro()}>Add product</button></div></div>
        <input id="prQ" type="search" placeholder="Search name, barcode, brand, category" value="${esc(f.q)}" aria-label="Search products">
        <div class="chips" role="group" aria-label="Filter">${[['all', 'All'], ['in', 'In stock'], ['low', 'Low stock'], ['out', 'Out of stock'], ['expiry', 'Expiring'], ...(S.isOwner ? [['fast', 'Fast selling'], ['slow', 'Slow selling'], ['idle', 'Not sold recently']] : [])].map(([k, l]) => `<button class="chip${f.chip === k ? ' on' : ''}" data-chip="${k}">${l}</button>`).join('')}</div>
        <div class="form">
          <label for="prLoc">Location<select id="prLoc">${opt('', 'All locations')}${A.locs().map((l) => opt(l.id, l.name, f.loc === l.id)).join('')}</select></label>
          <label for="prCat">Category<select id="prCat">${opt('', 'All categories')}${cats.map((c) => opt(c, c, f.cat === c)).join('')}</select></label>
          <label for="prSort">Sort by<select id="prSort">${[['name', 'Name'], ['stock', 'Stock (low first)'], ['new', 'Newest'], ...(S.isOwner ? [['sold', 'Best sellers (28 days)'], ['idle', 'Longest without a sale'], ['value', 'Stock value']] : [])].map(([k, l]) => opt(k, l, f.sort === k)).join('')}</select></label>
          ${S.isOwner ? `<label class="check" for="prArch"><input id="prArch" type="checkbox"${f.archived ? ' checked' : ''}> Show archived</label>` : ''}
        </div>
        <div class="card"><div class="small muted" id="prCount"></div><div class="list" id="prList"></div></div>
      </div>`;
      $('#prAdd').onclick = () => A.productForm(null, {});
      $('#prQ').oninput = (e) => { f.q = e.target.value; this.refresh(el); };
      $$('[data-chip]', el).forEach((b) => (b.onclick = () => { f.chip = b.dataset.chip; $$('[data-chip]', el).forEach((x) => x.classList.toggle('on', x === b)); this.refresh(el); }));
      $('#prLoc').onchange = (e) => { f.loc = e.target.value; this.refresh(el); };
      $('#prCat').onchange = (e) => { f.cat = e.target.value; this.refresh(el); };
      $('#prSort').onchange = (e) => { f.sort = e.target.value; this.refresh(el); };
      if ($('#prArch')) $('#prArch').onchange = (e) => { f.archived = e.target.checked; this.refresh(el); };
      this.refresh(el);
    },
    refresh(el) {
      const box = $('#prList', el); if (!box) return;
      const f = this.f;
      let list = f.q ? A.search(f.q) : A.activeProducts();
      if (f.archived) list = list.concat([...S.products.values()].filter((p) => p.archived && (!f.q || I.norm(p.name).includes(I.norm(f.q)))));
      const deadDays = num(S.cfg.settings?.deadDays, 30);
      const rows = list.map((p) => ({ p, st: A.stats(p) })).filter(({ p, st }) => {
        if (f.loc && !(num(p.stock?.[f.loc]) > 0)) return false;
        if (f.cat && p.category !== f.cat) return false;
        switch (f.chip) {
          case 'in': return st.avail > 0;
          case 'low': return st.avail > 0 && num(p.min) > 0 && st.avail <= num(p.min);
          case 'out': return st.avail <= 0;
          case 'fast': return st.speed === 'fast' || st.speed === 'steady';
          case 'slow': return st.total > 0 && (st.speed === 'slow' || st.speed === 'none');
          case 'idle': return st.total > 0 && st.idle >= deadDays;
          case 'expiry': return p.expiry && I.daysBetween(today(), p.expiry) <= num(S.cfg.settings?.expiryDays, 30);
          default: return true;
        }
      });
      const s = f.sort;
      rows.sort((a, b) => s === 'stock' ? a.st.avail - b.st.avail : s === 'sold' ? b.st.d28.u - a.st.d28.u : s === 'idle' ? b.st.idle - a.st.idle : s === 'value' ? b.st.total * num(b.p.cost) - a.st.total * num(a.p.cost) : s === 'new' ? (b.p.created || 0) - (a.p.created || 0) : a.p.name.localeCompare(b.p.name));
      const shown = rows.slice(0, 300);
      $('#prCount', el).textContent = `${fmtN(rows.length)} product${rows.length === 1 ? '' : 's'}${rows.length > 300 ? ' · showing first 300, search to narrow down' : ''}`;
      box.innerHTML = shown.length ? shown.map(({ p, st }) => {
        const q = f.loc ? num(p.stock?.[f.loc]) : st.total;
        const where = Object.entries(p.stock || {}).filter(([, v]) => num(v) > 0).map(([l, v]) => A.locName(l) + ' ' + fmtN(num(v))).join(', ');
        return prodRow(p, `${fmtN(q)}<div class="s">${A.stockStatus(p, st)}</div>`, esc([num(p.price) ? money(p.price) : '', where || 'No stock'].filter(Boolean).join(' · ')));
      }).join('') : `<div class="empty">${S.products.size ? 'No products match.' : 'No products yet. Scan a barcode or press Add product.'}</div>`;
      wireRows(box);
    },
  };

  // ================= alerts =================
  V.alerts = {
    owner: true,
    f: 'all',
    render(el) {
      const al = S.alerts;
      const types = [['all', 'All'], ['out', 'Out of stock'], ['low', 'Low stock'], ['reorder', 'Reorder'], ['dead', 'Not selling'], ['expiry', 'Expiry'], ['storage', 'In storage too long'], ['over', 'Overstocked'], ['hot', 'Selling fast']];
      const cnt = (t) => (t === 'all' ? al.length : al.filter((a) => a.type === t).length);
      const shown = this.f === 'all' ? al : al.filter((a) => a.type === this.f);
      const reorder = al.filter((a) => a.type === 'reorder');
      const bySup = new Map();
      for (const a of reorder) { const k = A.supName(a.p.supplierId) || 'No supplier set'; if (!bySup.has(k)) bySup.set(k, []); bySup.get(k).push(a); }
      el.innerHTML = `<div class="wrap">
        <h1>Alerts</h1>
        <div class="chips" role="group" aria-label="Filter alerts">${types.map(([k, l]) => `<button class="chip${this.f === k ? ' on' : ''}" data-af="${k}">${l} ${cnt(k) ? '· ' + cnt(k) : ''}</button>`).join('')}</div>
        <div class="card">${shown.length ? shown.slice(0, 400).map((a) => `<div class="alert-row"><span class="stripe ${a.sev}"></span><div><div><a href="#" data-open="${a.p.id}"><strong>${esc(a.p.name)}</strong></a> <span class="pill ${a.sev === 'info' ? 'info' : a.sev}">${esc(a.title)}</span></div><div class="small muted">${esc(a.text)}</div></div>
          <div>${a.type === 'storage' ? `<button data-mv="${a.p.id}" data-loc="${a.loc}"${ro()}>Move</button>` : a.type === 'out' || a.type === 'low' || a.type === 'reorder' ? `<button data-in="${a.p.id}"${ro()}>Receive</button>` : ''}</div></div>`).join('') : '<div class="empty">No problems found. 🎉</div>'}</div>
        <div class="card"><div class="card-h"><h2>Order list</h2><div class="row"><button id="ordCopy">Copy as text</button><button id="ordCsv">Download CSV</button></div></div>
          <p class="small muted">Suggested quantities cover about ${num(S.cfg.settings?.reorderDays, 21)} days of sales (or up to your maximum), rounded up to whole cases.</p>
          ${reorder.length ? [...bySup.entries()].map(([sup, list]) => `<h3>${esc(sup)}</h3><div class="tablebox"><table><thead><tr><th>Product</th><th class="n">In stock</th><th class="n">Order</th><th>Cases</th></tr></thead><tbody>${list.map((a) => `<tr><td>${esc(a.p.name)}</td><td class="n">${fmtN(I.available(a.p, S.cfg))}</td><td class="n">${fmtN(a.qty)}</td><td>${esc(I.breakdown(a.p, a.qty))}</td></tr>`).join('')}</tbody></table></div>`).join('') : '<div class="empty">Nothing needs reordering.</div>'}
        </div></div>`;
      $$('[data-af]', el).forEach((b) => (b.onclick = () => { this.f = b.dataset.af; this.render(el); }));
      $$('[data-open]', el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); A.openSheet(a.dataset.open); }));
      $$('[data-in]', el).forEach((b) => (b.onclick = () => A.stockInForm(S.products.get(b.dataset.in))));
      $$('[data-mv]', el).forEach((b) => (b.onclick = () => A.transferForm(S.products.get(b.dataset.mv))));
      const text = () => [...bySup.entries()].map(([sup, list]) => sup + '\n' + list.map((a) => `- ${a.p.name}${a.p.barcode ? ' (' + a.p.barcode + ')' : ''}: ${a.qty}${I.breakdown(a.p, a.qty) ? ' = ' + I.breakdown(a.p, a.qty) : ''}`).join('\n')).join('\n\n');
      $('#ordCopy').onclick = async () => { try { await navigator.clipboard.writeText(text() || 'Nothing to order'); toast('Copied'); } catch (e) { toast('Copy not allowed here', true); } };
      $('#ordCsv').onclick = () => A.saveFile('order-list-' + today() + '.csv', I.toCSV([['Supplier', 'Product', 'Barcode', 'In stock', 'Order qty', 'Cases'], ...reorder.map((a) => [A.supName(a.p.supplierId), a.p.name, a.p.barcode, I.available(a.p, S.cfg), a.qty, I.breakdown(a.p, a.qty)])]));
    },
    live: true,
  };

  // ================= reports =================
  const REPORTS = [
    ['Stock', [['current', 'Current stock'], ['received', 'Stock received'], ['sold', 'Stock sold'], ['adjust', 'Adjustments & removals'], ['moves', 'Location moves'], ['valuation', 'Inventory valuation'], ['low', 'Low stock'], ['dead', 'Dead stock']]],
    ['Sales', [['daily', 'Daily sales'], ['weekly', 'Weekly sales'], ['monthly', 'Monthly sales'], ['best', 'Best-selling products'], ['worst', 'Worst-selling products'], ['bycat', 'Sales by category'], ['byprod', 'Sales by product']]],
    ['Profit', [['profit', 'Profit per product'], ['profitcat', 'Profit by category']]],
  ];
  V.reports = {
    owner: true,
    f: { type: 'daily', from: addDays(today(), -27), to: today(), cat: '', sup: '', loc: '', q: '' },
    render(el) {
      const f = this.f;
      const cats = [...new Set([...(S.cfg.categories || []), ...[...S.products.values()].map((p) => p.category).filter(Boolean)])].sort();
      el.innerHTML = `<div class="wrap">
        <h1>Reports</h1>
        <div class="card"><div class="form">
          <label for="rType">Report<select id="rType">${REPORTS.map(([g, list]) => `<optgroup label="${g}">${list.map(([k, l]) => opt(k, l, f.type === k)).join('')}</optgroup>`).join('')}</select></label>
          <label for="rFrom">From<input id="rFrom" type="date" value="${f.from}"></label>
          <label for="rTo">To<input id="rTo" type="date" value="${f.to}"></label>
          <label for="rCat">Category<select id="rCat">${opt('', 'All')}${cats.map((c) => opt(c, c, f.cat === c)).join('')}</select></label>
          <label for="rSup">Supplier<select id="rSup">${opt('', 'All')}${(S.cfg.suppliers || []).map((s) => opt(s.id, s.name, f.sup === s.id)).join('')}</select></label>
          <label for="rLoc">Location<select id="rLoc">${opt('', 'All')}${A.locs().map((l) => opt(l.id, l.name, f.loc === l.id)).join('')}</select></label>
          <label for="rQ">Product<input id="rQ" value="${esc(f.q)}" placeholder="Name or barcode"></label>
        </div>
        <div class="row">${[['Today', 0, 0], ['Yesterday', -1, -1], ['Last 7 days', -6, 0], ['Last 28 days', -27, 0], ['This month', 'm', 0], ['Last 90 days', -89, 0]].map(([l, a, b], i) => `<button class="chip" data-rng="${i}">${l}</button>`).join('')}</div>
        <div class="row"><button class="primary" id="rRun">Show report</button></div></div>
        <div id="rOut"></div></div>`;
      const ranges = [[0, 0], [-1, -1], [-6, 0], [-27, 0], ['m', 0], [-89, 0]];
      $$('[data-rng]', el).forEach((b) => (b.onclick = () => { const [a, z] = ranges[+b.dataset.rng]; $('#rFrom').value = a === 'm' ? I.monthStart(today()) : addDays(today(), a); $('#rTo').value = addDays(today(), z); this.run(el); }));
      $('#rRun').onclick = () => this.run(el);
      $('#rType').onchange = () => this.run(el);
      this.run(el);
    },
    async run(el) {
      const f = this.f;
      Object.assign(f, { type: $('#rType').value, from: $('#rFrom').value || today(), to: $('#rTo').value || today(), cat: $('#rCat').value, sup: $('#rSup').value, loc: $('#rLoc').value, q: $('#rQ').value.trim() });
      if (f.from > f.to) [f.from, f.to] = [f.to, f.from];
      const out = $('#rOut'); out.innerHTML = '<div class="card"><p class="muted">Working…</p></div>';
      let moves;
      try { moves = f.from >= S.windowFrom ? S.moves.filter((m) => { const d = dkey(m.t); return d >= f.from && d <= f.to; }) : await Store.loadDays(f.from, f.to); }
      catch (e) { out.innerHTML = `<div class="card"><p class="muted">Couldn't load that period: ${esc(e.message)}</p></div>`; return; }
      const R = buildReport(f, moves);
      this.last = R;
      out.innerHTML = `<div class="card"><div class="card-h"><div><h2>${esc(R.title)}</h2><div class="small muted">${esc(R.sub)}</div></div>
        <div class="row"><button id="xCsv">CSV</button><button id="xXls">Excel</button><button id="xPdf">Printable / PDF</button></div></div>
        ${R.summary ? `<div class="tiles">${R.summary.map(([l, v]) => `<div class="tile"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
        ${R.chart ? '<div class="chartbox"><canvas id="rChart" role="img" aria-label="Report chart"></canvas></div>' : ''}
        ${R.rows.length ? `<div class="tablebox" style="max-height:60vh"><table><thead><tr>${R.cols.map((c) => `<th class="${c.n ? 'n' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>
          ${R.rows.slice(0, 1000).map((r) => `<tr>${r.map((v, i) => `<td class="${R.cols[i].n ? 'n' : ''}">${esc(fmtCell(v, R.cols[i]))}</td>`).join('')}</tr>`).join('')}</tbody>
          ${R.foot ? `<tfoot><tr>${R.foot.map((v, i) => `<td class="${R.cols[i].n ? 'n' : ''}">${esc(fmtCell(v, R.cols[i]))}</td>`).join('')}</tr></tfoot>` : ''}</table></div>${R.rows.length > 1000 ? '<p class="small muted">Showing 1,000 rows on screen; downloads include everything.</p>' : ''}` : '<div class="empty">No data for these filters.</div>'}</div>`;
      if (R.chart) barChart('rChart', R.chart.labels, R.chart.values, { money: R.chart.money });
      const name = R.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + f.from + '-to-' + f.to;
      const plain = () => [R.cols.map((c) => c.h), ...R.rows.map((r) => r.map((v, i) => R.cols[i].money || R.cols[i].pct ? I.round2(num(v)) : v)), ...(R.foot ? [R.foot.map((v, i) => R.cols[i].money ? I.round2(num(v)) : v)] : [])];
      $('#xCsv').onclick = () => A.saveFile(name + '.csv', I.toCSV(plain()));
      $('#xXls').onclick = async () => {
        try { await A.loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'); } catch (e) { return toast('Could not load the Excel tool', true); }
        const ws = window.XLSX.utils.aoa_to_sheet(plain()); const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'Report');
        const buf = window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' }); A.saveFile(name + '.xlsx', new Uint8Array(buf));
      };
      $('#xPdf').onclick = () => A.saveFile(name + '.html', printable(R));
    },
  };
  function fmtCell(v, c) { if (v == null || v === '') return ''; if (c.money) return money(v); if (c.pct) return fmtN(num(v), 1) + '%'; if (c.n) return fmtN(num(v), c.dp || 0); if (c.date) return fmtDate(v); if (c.dt) return fmtDT(v); return String(v); }
  function printable(R) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(R.title)}</title><style>body{font:12px Arial,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0}p{color:#555;margin:4px 0 14px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ccc;padding:5px 6px;text-align:left}th{background:#eee}td.n,th.n{text-align:right}tfoot td{font-weight:bold}.s{display:flex;gap:18px;margin:10px 0}.s div{border:1px solid #ccc;padding:6px 10px}@media print{button{display:none}}</style></head><body>
      <button onclick="print()">Print / Save as PDF</button><h1>${esc(S.cfg.name)} — ${esc(R.title)}</h1><p>${esc(R.sub)} · produced ${fmtDT(Date.now())}</p>
      ${R.summary ? `<div class="s">${R.summary.map(([l, v]) => `<div>${esc(l)}<br><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
      <table><thead><tr>${R.cols.map((c) => `<th class="${c.n ? 'n' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${R.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${R.cols[i].n ? 'n' : ''}">${esc(fmtCell(v, R.cols[i]))}</td>`).join('')}</tr>`).join('')}</tbody>
      ${R.foot ? `<tfoot><tr>${R.foot.map((v, i) => `<td class="${R.cols[i].n ? 'n' : ''}">${esc(fmtCell(v, R.cols[i]))}</td>`).join('')}</tr></tfoot>` : ''}</table></body></html>`;
  }
  function buildReport(f, movesAll) {
    const pmatch = (pid, m) => {
      const p = S.products.get(pid);
      if (f.cat && (p?.category || m?.cat) !== f.cat) return false;
      if (f.sup && (p?.supplierId || '') !== f.sup && (!m || m.sup !== f.sup)) return false;
      if (f.q) { const n = I.norm(f.q); if (!I.norm([p?.name || m?.n, p?.barcode, p?.sku].join(' ')).includes(n)) return false; }
      return true;
    };
    const moves = movesAll.filter((m) => pmatch(m.p, m) && (!f.loc || m.l === f.loc || m.to === f.loc));
    const sub = `${fmtDate(f.from)} – ${fmtDate(f.to)}` + [f.cat && 'category ' + f.cat, f.sup && 'supplier ' + A.supName(f.sup), f.loc && 'location ' + A.locName(f.loc), f.q && '"' + f.q + '"'].filter(Boolean).map((x) => ' · ' + x).join('');
    const costOf = (m) => (m.c != null ? num(m.c) : num(S.products.get(m.p)?.cost));
    const vatOf = (pid) => num(S.products.get(pid)?.vat, 20) / 100;
    const inc = S.cfg.settings?.pricesIncVat !== false;
    const netOf = (m, rev) => (inc ? rev / (1 + vatOf(m.p)) : rev);
    const products = [...S.products.values()].filter((p) => !p.archived && pmatch(p.id));
    const C = (h, o = {}) => ({ h, ...o });
    const salesAgg = (keyFn) => {
      const mp = new Map();
      for (const m of moves) {
        if (m.ty !== 'sale' && m.ty !== 'ret') continue;
        const s = m.ty === 'sale' ? 1 : -1, q = s * Math.abs(m.q), rev = q * num(m.pr), cost = q * costOf(m);
        const k = keyFn(m); const e = mp.get(k) || { k, u: 0, rev: 0, net: 0, cost: 0, n: m.n, p: m.p };
        e.u += q; e.rev += rev; e.net += netOf(m, rev); e.cost += cost; mp.set(k, e);
      }
      return [...mp.values()];
    };
    const sum = (arr, f2) => arr.reduce((s, x) => s + num(f2(x)), 0);
    const T = f.type;
    if (T === 'current' || T === 'valuation' || T === 'low' || T === 'dead') {
      if (T === 'valuation') {
        const mp = new Map();
        for (const p of products) { const q = f.loc ? num(p.stock?.[f.loc]) : totalStock(p); const k = p.category || 'Uncategorised'; const e = mp.get(k) || { k, n: 0, u: 0, c: 0, r: 0 }; e.n++; e.u += q; e.c += q * num(p.cost); e.r += q * num(p.price); mp.set(k, e); }
        const rows = [...mp.values()].sort((a, b) => b.c - a.c).map((e) => [e.k, e.n, e.u, e.c, e.r]);
        const tc = sum(rows, (r) => r[3]), tr = sum(rows, (r) => r[4]);
        return { title: 'Inventory valuation', sub: 'As of now' + (f.loc ? ' · ' + A.locName(f.loc) : ''), cols: [C('Category'), C('Products', { n: 1 }), C('Units', { n: 1 }), C('Value at cost', { money: 1, n: 1 }), C('Value at retail', { money: 1, n: 1 })], rows, foot: ['Total', sum(rows, (r) => r[1]), sum(rows, (r) => r[2]), tc, tr], summary: [['Value at cost', money(tc)], ['Value at retail', money(tr)]] };
      }
      let list = products.map((p) => ({ p, st: A.stats(p) }));
      if (f.loc) list = list.filter((x) => num(x.p.stock?.[f.loc]) !== 0);
      if (T === 'low') list = list.filter((x) => x.st.avail <= num(x.p.min) && (num(x.p.min) > 0 || x.st.avail <= 0));
      if (T === 'dead') list = list.filter((x) => x.st.total > 0 && x.st.idle >= num(S.cfg.settings?.deadDays, 30)).sort((a, b) => b.st.idle - a.st.idle);
      else list.sort((a, b) => a.p.name.localeCompare(b.p.name));
      const whereTxt = (p) => Object.entries(p.stock || {}).filter(([, v]) => num(v)).map(([l, v]) => A.locName(l) + ': ' + v).join('; ');
      if (T === 'dead') {
        const rows = list.map(({ p, st }) => [p.name, p.barcode, p.category, st.total, p.lastSale ? dkey(p.lastSale) : 'Never', st.idle, st.total * num(p.cost), whereTxt(p)]);
        return { title: 'Dead stock', sub: `In stock with no sale for ${num(S.cfg.settings?.deadDays, 30)}+ days`, cols: [C('Product'), C('Barcode'), C('Category'), C('In stock', { n: 1 }), C('Last sale'), C('Days idle', { n: 1 }), C('Tied-up cost', { money: 1, n: 1 }), C('Where')], rows, foot: ['Total', '', '', sum(rows, (r) => r[3]), '', '', sum(rows, (r) => r[6]), ''], summary: [['Products', fmtN(rows.length)], ['Money tied up', money(sum(rows, (r) => r[6]))]] };
      }
      const rows = list.map(({ p, st }) => { const q = f.loc ? num(p.stock?.[f.loc]) : st.total; return [p.name, p.barcode || p.sku, p.category, q, num(p.min), T === 'low' ? I.reorderSuggestion(p, st, S.cfg) : q * num(p.cost), T === 'low' ? A.supName(p.supplierId) : q * num(p.price), whereTxt(p)]; });
      if (T === 'low') return { title: 'Low stock', sub: 'At or below minimum, as of now', cols: [C('Product'), C('Code'), C('Category'), C('Available', { n: 1 }), C('Minimum', { n: 1 }), C('Suggested order', { n: 1 }), C('Supplier'), C('Where')], rows };
      return { title: 'Current stock', sub: 'As of now' + (f.loc ? ' · ' + A.locName(f.loc) : ''), cols: [C('Product'), C('Code'), C('Category'), C('Quantity', { n: 1 }), C('Minimum', { n: 1 }), C('Value at cost', { money: 1, n: 1 }), C('Value at retail', { money: 1, n: 1 }), C('Where')], rows, foot: ['Total', '', '', sum(rows, (r) => r[3]), '', sum(rows, (r) => r[5]), sum(rows, (r) => r[6]), ''] };
    }
    if (T === 'received' || T === 'sold' || T === 'adjust' || T === 'moves') {
      const want = { received: ['in', 'ret'], sold: ['sale'], adjust: ['out', 'adj', 'count'], moves: ['xfer'] }[T];
      const list = moves.filter((m) => want.includes(m.ty)).sort((a, b) => b.t - a.t);
      A.resolveNames(list.map((m) => m.by));
      if (T === 'received') {
        const rows = list.map((m) => [m.t, m.n, I.KINDS[m.ty].label + (m.r && m.r !== 'Delivery' ? ' (' + m.r + ')' : ''), Math.abs(m.d), m.u || '', costOf(m), Math.abs(m.d) * costOf(m), A.supName(m.sup), m.ref || '', A.locName(m.l), A.nameOf(m.by)]);
        return { title: 'Stock received', sub, cols: [C('When', { dt: 1 }), C('Product'), C('Type'), C('Units', { n: 1 }), C('As'), C('Cost each', { money: 1, n: 1 }), C('Total cost', { money: 1, n: 1 }), C('Supplier'), C('Ref'), C('Location'), C('By')], rows, foot: ['Total', '', '', sum(rows, (r) => r[3]), '', '', sum(rows, (r) => r[6]), '', '', '', ''], summary: [['Deliveries / lines', fmtN(rows.length)], ['Units received', fmtN(sum(rows, (r) => r[3]))], ['Cost', money(sum(rows, (r) => r[6]))]] };
      }
      if (T === 'sold') {
        const rows = list.map((m) => [m.t, m.n, Math.abs(m.q), num(m.pr), Math.abs(m.q) * num(m.pr), m.ch || '', A.locName(m.l), m.src || A.nameOf(m.by)]);
        return { title: 'Stock sold', sub, cols: [C('When', { dt: 1 }), C('Product'), C('Units', { n: 1 }), C('Price each', { money: 1, n: 1 }), C('Total', { money: 1, n: 1 }), C('Channel'), C('Taken from'), C('By')], rows, foot: ['Total', '', sum(rows, (r) => r[2]), '', sum(rows, (r) => r[4]), '', '', ''] };
      }
      if (T === 'moves') {
        const rows = list.map((m) => [m.t, m.n, m.q, A.locName(m.l), A.locName(m.to), m.no || '', A.nameOf(m.by)]);
        return { title: 'Location moves', sub, cols: [C('When', { dt: 1 }), C('Product'), C('Units', { n: 1 }), C('From'), C('To'), C('Notes'), C('By')], rows };
      }
      const rows = list.map((m) => [m.t, m.n, I.KINDS[m.ty].label, m.r || '', m.d, costOf(m) * m.d, A.locName(m.l), m.no || '', A.nameOf(m.by)]);
      return { title: 'Adjustments & removals', sub, cols: [C('When', { dt: 1 }), C('Product'), C('Type'), C('Reason'), C('Change', { n: 1 }), C('Cost impact', { money: 1, n: 1 }), C('Location'), C('Notes'), C('By')], rows, foot: ['Total', '', '', '', sum(rows, (r) => r[4]), sum(rows, (r) => r[5]), '', '', ''], summary: [['Units lost / removed', fmtN(-sum(rows.filter((r) => r[4] < 0), (r) => r[4]))], ['Cost of losses', money(-sum(rows.filter((r) => r[5] < 0), (r) => r[5]))]] };
    }
    if (T === 'daily' || T === 'weekly' || T === 'monthly') {
      const keyFn = T === 'daily' ? (m) => dkey(m.t) : T === 'weekly' ? (m) => I.weekStart(dkey(m.t)) : (m) => dkey(m.t).slice(0, 7);
      const agg = salesAgg(keyFn);
      if (T === 'daily') { for (let d = f.from; d <= f.to; d = addDays(d, 1)) if (!agg.some((e) => e.k === d)) agg.push({ k: d, u: 0, rev: 0, net: 0, cost: 0 }); }
      agg.sort((a, b) => (a.k < b.k ? -1 : 1));
      const label = (k) => (T === 'daily' ? new Date(k + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : T === 'weekly' ? 'Week of ' + fmtDate(k) : new Date(k + '-01T12:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }));
      const rows = agg.map((e) => [label(e.k), e.u, e.rev, e.net - e.cost, e.net ? ((e.net - e.cost) / e.net) * 100 : 0]);
      const tr = sum(agg, (e) => e.rev), tp = sum(agg, (e) => e.net - e.cost), tn = sum(agg, (e) => e.net);
      return { title: { daily: 'Daily sales', weekly: 'Weekly sales', monthly: 'Monthly sales' }[T], sub, cols: [C(T === 'daily' ? 'Day' : T === 'weekly' ? 'Week' : 'Month'), C('Units', { n: 1 }), C('Revenue', { money: 1, n: 1 }), C('Gross profit', { money: 1, n: 1 }), C('Margin', { pct: 1, n: 1 })], rows, foot: ['Total', sum(agg, (e) => e.u), tr, tp, tn ? (tp / tn) * 100 : 0], summary: [['Revenue', money(tr)], ['Estimated gross profit', money(tp)], ['Units sold', fmtN(sum(agg, (e) => e.u))]], chart: { labels: rows.map((r) => r[0]), values: agg.map((e) => I.round2(e.rev)), money: true } };
    }
    if (T === 'bycat' || T === 'profitcat') {
      const agg = salesAgg((m) => S.products.get(m.p)?.category || m.cat || 'Uncategorised').sort((a, b) => (T === 'bycat' ? b.rev - a.rev : (b.net - b.cost) - (a.net - a.cost)));
      const rows = agg.map((e) => [e.k, e.u, e.rev, e.cost, e.net - e.cost, e.net ? ((e.net - e.cost) / e.net) * 100 : 0]);
      return { title: T === 'bycat' ? 'Sales by category' : 'Profit by category', sub, cols: [C('Category'), C('Units', { n: 1 }), C('Revenue', { money: 1, n: 1 }), C('Cost of goods', { money: 1, n: 1 }), C('Gross profit', { money: 1, n: 1 }), C('Margin', { pct: 1, n: 1 })], rows, foot: ['Total', sum(rows, (r) => r[1]), sum(rows, (r) => r[2]), sum(rows, (r) => r[3]), sum(rows, (r) => r[4]), ''], chart: { labels: rows.slice(0, 12).map((r) => r[0]), values: rows.slice(0, 12).map((r) => I.round2(T === 'bycat' ? r[2] : r[4])), money: true } };
    }
    // per-product sales / profit
    const agg = salesAgg((m) => m.p);
    if (T === 'worst') { for (const p of products) if (!agg.some((e) => e.k === p.id)) agg.push({ k: p.id, p: p.id, n: p.name, u: 0, rev: 0, net: 0, cost: 0 }); }
    const sorter = { best: (a, b) => b.u - a.u, worst: (a, b) => a.u - b.u, byprod: (a, b) => b.rev - a.rev, profit: (a, b) => (b.net - b.cost) - (a.net - a.cost) }[T] || ((a, b) => b.rev - a.rev);
    agg.sort(sorter);
    const days = I.daysBetween(f.from, f.to) + 1;
    const rows = agg.map((e) => { const p = S.products.get(e.k); return [p?.name || e.n, p?.category || '', e.u, e.u / days, e.rev, e.net - e.cost, e.net ? ((e.net - e.cost) / e.net) * 100 : 0, p ? totalStock(p) : '']; });
    const title = { best: 'Best-selling products', worst: 'Worst-selling products', byprod: 'Sales by product', profit: 'Profit per product' }[T];
    return { title, sub, cols: [C('Product'), C('Category'), C('Units sold', { n: 1 }), C('Per day', { n: 1, dp: 2 }), C('Revenue', { money: 1, n: 1 }), C('Gross profit', { money: 1, n: 1 }), C('Margin', { pct: 1, n: 1 }), C('In stock now', { n: 1 })], rows, foot: ['Total', '', sum(rows, (r) => r[2]), '', sum(rows, (r) => r[4]), sum(rows, (r) => r[5]), '', ''], summary: [['Revenue', money(sum(rows, (r) => r[4]))], ['Gross profit', money(sum(rows, (r) => r[5]))]] };
  }
  A.buildReport = buildReport;

  // ================= more =================
  V.office = {
    owner: true,
    render(el) {
      const al = S.alerts; const cnt = (t) => al.filter((a) => a.type === t).length;
      const td = today(); const mv = S.moves.filter((m) => dkey(m.t) === td && m.ty === 'sale');
      const sales = mv.reduce((s, m) => s + num(m.q) * num(m.pr), 0);
      const urgent = al.filter((a) => a.sev === 'bad').length;
      const tiles = [['#dashboard', 'Dashboard', 'Sales, profit, stock value, best and worst sellers.'], ['#alerts', 'Alerts & reorder list', `${urgent} urgent · ${cnt('reorder')} to reorder · ${cnt('dead')} not selling`], ['#reports', 'Reports', 'Stock, sales and profit reports. Download as Excel, CSV or PDF.'], ['#import', 'Import', 'Your till\'s daily sales report, or a product list from Excel.'], ['#activity', 'Activity log', 'Every change, with who made it and when.'], ['#settings', 'Shop settings', 'Locations, suppliers, categories, VAT and alert rules.'], ['#backup', 'Backup & restore', 'Download a full copy of your shop\'s data.'], ['#help', 'How to use this app', 'Plain-English guide for you and your staff.']];
      el.innerHTML = `<div class="wrap"><div><h1>Back office</h1><p class="muted small">Only you can see this. Staff only see Scan, Stock and Count.</p></div>
        <div class="tiles">
          <a class="tile ok" href="#dashboard"><span>Sales today</span><b>${money(sales)}</b></a>
          <a class="tile ${urgent ? 'bad' : ''}" href="#alerts"><span>Urgent alerts</span><b>${fmtN(urgent)}</b></a>
          <a class="tile ${cnt('reorder') ? 'warn' : ''}" href="#alerts"><span>To reorder</span><b>${fmtN(cnt('reorder'))}</b></a>
        </div>
        <div class="menu">${tiles.map(([h, t, d]) => `<a class="menu-row" href="${h}"><div><b>${t}</b><span>${esc(d)}</span></div><span aria-hidden="true">›</span></a>`).join('')}</div>
        ${window.Platform ? '<button id="signOut">Sign out</button>' : ''}</div>`;
      const so = $('#signOut'); if (so) so.onclick = async () => { if (await A.confirmBox('Sign out?', 'You will need your email and password to sign in again.', 'Sign out')) window.Platform.signOut(); };
    },
    live: true,
  };

  // ================= stocktake =================
  V.count = {
    loc: '', lines: [],
    render(el) {
      if (!this.loc) this.loc = A.locs()[0]?.id || '';
      el.innerHTML = `<div class="wrap"><h1>Stock count</h1>
        <div class="notice small">Pick a location, then scan or search each product and type how many you physically counted there. Press <strong>Apply counts</strong> when done — the app fixes the numbers and records the differences.</div>
        <div class="card"><div class="form"><label for="stLoc">Counting in${A.locSelect('stLoc', this.loc)}</label></div>
          <div class="scan-input"><input id="stCode" placeholder="Scan, type barcode or name" autocomplete="off">${A.cameraButton('stCam', 'Camera')}</div>
          <div id="stHits" class="list"></div>
          <div id="stLines"></div>
          <label class="check" for="stZero"><input id="stZero" type="checkbox"> Also set products I didn't count in this location to zero</label>
          <div class="row"><button class="primary" id="stApply"${ro()}>Apply counts</button><button id="stClear">Clear list</button></div></div></div>`;
      const draw = () => {
        const L = this.loc;
        $('#stLines').innerHTML = this.lines.length ? `<div class="tablebox"><table><thead><tr><th>Product</th><th class="n">System says</th><th class="n">Counted</th><th class="n">Difference</th><th></th></tr></thead><tbody>${this.lines.map((l, i) => { const p = S.products.get(l.pid); const sys = num(p?.stock?.[L]); const d = l.c === '' ? '' : num(l.c) - sys; return `<tr><td>${esc(p?.name)}</td><td class="n">${fmtN(sys)}</td><td class="n"><input type="number" inputmode="decimal" min="0" step="any" style="width:90px;min-height:36px" data-c="${i}" value="${l.c}" aria-label="Counted ${esc(p?.name)}"></td><td class="n ${d > 0 ? 'tag-in' : d < 0 ? 'tag-out' : ''}">${d === '' ? '' : (d > 0 ? '+' : '') + fmtN(d, 2)}</td><td><button class="ghost" data-rm="${i}" aria-label="Remove">✕</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No products counted yet.</div>';
        $$('[data-c]').forEach((inp) => (inp.oninput = () => {
          const l = this.lines[inp.dataset.c]; l.c = inp.value;
          const sys = num(S.products.get(l.pid)?.stock?.[this.loc]); const cell = inp.closest('tr').children[3];
          const d = inp.value === '' ? '' : num(inp.value) - sys;
          cell.textContent = d === '' ? '' : (d > 0 ? '+' : '') + fmtN(d, 2); cell.className = 'n ' + (d > 0 ? 'tag-in' : d < 0 ? 'tag-out' : '');
        }));
        $$('[data-rm]').forEach((b) => (b.onclick = () => { this.lines.splice(+b.dataset.rm, 1); draw(); }));
      };
      const add = (p) => {
        if (!this.lines.some((l) => l.pid === p.id)) this.lines.unshift({ pid: p.id, c: '' });
        $('#stCode').value = ''; $('#stHits').innerHTML = ''; draw();
        setTimeout(() => { const i = $('[data-c="' + this.lines.findIndex((l) => l.pid === p.id) + '"]'); i && i.focus(); }, 30);
      };
      this.onScan = (code) => { const p = A.findByCode(code); if (p) add(p); else toast(code + ' isn\'t registered yet', true); };
      $('#stLoc').onchange = (e) => { this.loc = e.target.value; draw(); };
      A.bindCamera('stCam', this.onScan);
      const inp = $('#stCode');
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const p = A.findByCode(inp.value); if (p) add(p); else { const h = A.search(inp.value); if (h.length === 1) add(h[0]); } } };
      inp.oninput = () => { const v = inp.value.trim(); const hits = v.length >= 2 ? A.search(v).slice(0, 6) : []; $('#stHits').innerHTML = hits.map((p) => `<button class="item" data-add="${p.id}">${A.thumb(p)}<div><div class="t">${esc(p.name)}</div><div class="s">${esc(p.barcode || '')}</div></div><div class="q">${fmtN(num(p.stock?.[this.loc]))}</div></button>`).join(''); $$('[data-add]').forEach((b) => (b.onclick = () => add(S.products.get(b.dataset.add)))); };
      $('#stClear').onclick = () => { this.lines = []; draw(); };
      $('#stApply').onclick = async () => {
        const L = this.loc;
        const items = this.lines.filter((l) => l.c !== '' && S.products.has(l.pid)).map((l) => ({ pid: l.pid, ty: 'count', counted: num(l.c), l: L, r: 'Stock count' }));
        if ($('#stZero').checked) {
          const counted = new Set(items.map((i) => i.pid));
          for (const p of S.products.values()) if (!counted.has(p.id) && num(p.stock?.[L]) !== 0) items.push({ pid: p.id, ty: 'count', counted: 0, l: L, r: 'Stock count (not found)' });
        }
        if (!items.length) return toast('Type a counted quantity for at least one product.', true);
        if (!(await A.confirmBox('Apply counts?', `${items.length} product(s) in ${esc(A.locName(L))} will be set to the counted numbers.`, 'Apply'))) return;
        const btn = $('#stApply'); btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const res = await Store.record(items, S.cfg, (d, n) => (btn.textContent = `Saving ${d}/${n}…`));
          A.applyLocal(res);
          if (res.failed.length) toast(res.failed.length + ' could not be saved: ' + res.failed[0].error, true); else { toast('Counts applied'); this.lines = []; }
        } catch (e) { toast(e.message, true); }
        this.render(el);
      };
      draw();
    },
  };

  // ================= activity =================
  V.activity = {
    owner: true,
    f: 'all', extra: null,
    render(el) {
      const moves = (this.extra || S.moves).slice().reverse();
      const groups = { all: () => true, in: (m) => m.ty === 'in' || m.ty === 'ret', sale: (m) => m.ty === 'sale', adj: (m) => ['out', 'adj', 'count'].includes(m.ty), xfer: (m) => m.ty === 'xfer', edit: (m) => ['new', 'edit', 'archive', 'restore', 'delete'].includes(m.ty) };
      const shown = moves.filter(groups[this.f]).slice(0, 500);
      A.resolveNames(shown.map((m) => m.by));
      el.innerHTML = `<div class="wrap"><h1>Activity log</h1>
        <div class="chips">${[['all', 'Everything'], ['in', 'Received'], ['sale', 'Sales'], ['adj', 'Adjustments'], ['xfer', 'Moves'], ['edit', 'Product changes']].map(([k, l]) => `<button class="chip${this.f === k ? ' on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
        <div class="card">${shown.length ? `<div class="tablebox"><table><thead><tr><th>When</th><th>Product</th><th>What</th><th class="n">Qty</th><th>Where</th><th>Details</th><th>By</th></tr></thead><tbody>${shown.map((m) => `<tr><td class="small">${fmtDT(m.t)}</td><td><a href="#" data-open="${esc(m.p)}">${esc(m.n)}</a></td><td>${esc(I.KINDS[m.ty]?.label || m.ty)}</td><td class="n ${m.d > 0 ? 'tag-in' : m.d < 0 ? 'tag-out' : ''}">${m.ty === 'xfer' ? fmtN(m.q) : m.d ? (m.d > 0 ? '+' : '') + fmtN(m.d) : ''}</td><td class="small">${m.ty === 'xfer' ? esc(A.locName(m.l) + ' → ' + A.locName(m.to)) : esc(m.l ? A.locName(m.l) : '')}</td><td class="small">${esc([m.r, m.ref && 'Ref ' + m.ref, m.no, m.src].filter(Boolean).join(' · '))}</td><td class="small">${esc(A.nameOf(m.by))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No activity yet.</div>'}
        <p class="small muted">${this.extra ? 'Showing the last 12 months.' : 'Showing the last 120 days.'}</p>${this.extra ? '' : '<button id="actMore">Load the last 12 months</button>'}</div></div>`;
      $$('[data-f]', el).forEach((b) => (b.onclick = () => { this.f = b.dataset.f; this.render(el); }));
      $$('[data-open]', el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); if (S.products.has(a.dataset.open)) A.openSheet(a.dataset.open); else toast('That product has been deleted'); }));
      const more = $('#actMore'); if (more) more.onclick = async () => { more.disabled = true; more.textContent = 'Loading…'; try { this.extra = await Store.loadDays(addDays(today(), -365), today()); } catch (e) { toast(e.message, true); } this.render(el); };
    },
    live: true,
  };

  // ================= settings =================
  V.settings = {
    owner: true,
    render(el) {
      const c = I.clone(S.cfg); const s = c.settings || (c.settings = {});
      const own = S.isOwner && !S.ro;
      const dis = own ? '' : ' disabled';
      const stockAt = (lid) => [...S.products.values()].reduce((n, p) => n + (num(p.stock?.[lid]) !== 0 ? 1 : 0), 0);
      el.innerHTML = `<div class="wrap"><h1>Shop settings</h1>
        ${own ? '' : '<div class="notice warn">Only the shop owner can change settings.</div>'}
        <div class="card"><h2>Shop</h2><div class="form">
          <label for="sName">Shop name<input id="sName" value="${esc(c.name)}"${dis}></label>
          <label class="check full" for="sVat"><input id="sVat" type="checkbox"${s.pricesIncVat !== false ? ' checked' : ''}${dis}> Selling prices include VAT (normal for UK shops). Profit is worked out on the price without VAT.</label>
        </div></div>
        <div class="card"><h2>Alert rules</h2><div class="form">
          <label for="sDead">"Not selling" after (days)<input id="sDead" type="number" min="1" value="${num(s.deadDays, 30)}"${dis}><span class="hint">Alerts also show 60 and 90 days.</span></label>
          <label for="sExp">Expiry warning (days before)<input id="sExp" type="number" min="1" value="${num(s.expiryDays, 30)}"${dis}></label>
          <label for="sStor">"Sitting in storage" after (days)<input id="sStor" type="number" min="1" value="${num(s.storageDays, 45)}"${dis}></label>
          <label for="sCover">"Overstocked" when stock lasts more than (days)<input id="sCover" type="number" min="7" value="${num(s.coverDays, 90)}"${dis}></label>
          <label for="sLead">Reorder when stock lasts less than (days)<input id="sLead" type="number" min="1" value="${num(s.leadDays, 7)}"${dis}><span class="hint">Roughly how long a delivery takes</span></label>
          <label for="sRe">Order enough for (days)<input id="sRe" type="number" min="1" value="${num(s.reorderDays, 21)}"${dis}></label>
        </div></div>
        <div class="card"><div class="card-h"><h2>Locations</h2>${own ? '<button id="lAdd">Add location</button>' : ''}</div>
          <p class="small muted">"Shop" places count as on the shop floor, "Storage" as stock in the back. "Unavailable" holds damaged or reserved stock that shouldn't be sold.</p>
          <div id="lList" class="stack">${c.locations.map((l, i) => `<div class="row"><input data-ln="${i}" value="${esc(l.name)}" aria-label="Location name" style="flex:2;min-width:150px"${dis}><select data-lk="${i}" style="flex:1;min-width:120px"${dis}>${[['shop', 'Shop'], ['storage', 'Storage'], ['other', 'Other'], ['hold', 'Unavailable']].map(([k, n]) => opt(k, n, l.kind === k)).join('')}</select>${own ? `<button class="ghost" data-ld="${i}"${stockAt(l.id) ? ' disabled title="Move its stock first"' : ''}>Remove</button>` : ''}<span class="small muted">${stockAt(l.id)} products</span></div>`).join('')}</div></div>
        <div class="card"><div class="card-h"><h2>Suppliers</h2>${own ? '<button id="supAdd">Add supplier</button>' : ''}</div>
          <div id="supList" class="stack">${(c.suppliers || []).length ? c.suppliers.map((sp, i) => `<fieldset><legend>${esc(sp.name || 'Supplier')}</legend>
            <label>Name<input data-sp="${i}" data-k="name" value="${esc(sp.name)}"${dis}></label><label>Contact<input data-sp="${i}" data-k="contact" value="${esc(sp.contact)}"${dis}></label>
            <label>Phone<input data-sp="${i}" data-k="phone" value="${esc(sp.phone)}" inputmode="tel"${dis}></label><label>Email<input data-sp="${i}" data-k="email" value="${esc(sp.email)}" inputmode="email"${dis}></label>
            <label>Order days / notes<input data-sp="${i}" data-k="notes" value="${esc(sp.notes)}"${dis}></label>
            <div class="row small muted">${[...S.products.values()].filter((p) => p.supplierId === sp.id).length} products${own ? ` <button class="ghost" data-sd="${i}">Remove</button>` : ''}</div></fieldset>`).join('') : '<div class="empty">No suppliers yet. Add your cash & carry, wholesalers and reps.</div>'}</div></div>
        <div class="card"><h2>Lists</h2><div class="form">
          <label for="sCats">Categories (one per line)<textarea id="sCats" rows="6"${dis}>${esc((c.categories || []).join('\n'))}</textarea></label>
          <label for="sCh">Sales channels (one per line)<textarea id="sCh" rows="6"${dis}>${esc((c.channels || []).join('\n'))}</textarea></label>
        </div></div>
        ${own ? '<div class="row"><button class="primary big" id="sSave">Save settings</button></div>' : ''}</div>`;
      if (!own) return;
      const collect = () => {
        c.name = $('#sName').value.trim() || c.name;
        Object.assign(s, { pricesIncVat: $('#sVat').checked, deadDays: num($('#sDead').value, 30), expiryDays: num($('#sExp').value, 30), storageDays: num($('#sStor').value, 45), coverDays: num($('#sCover').value, 90), leadDays: num($('#sLead').value, 7), reorderDays: num($('#sRe').value, 21) });
        $$('[data-ln]').forEach((i) => (c.locations[i.dataset.ln].name = i.value.trim() || c.locations[i.dataset.ln].name));
        $$('[data-lk]').forEach((i) => (c.locations[i.dataset.lk].kind = i.value));
        $$('[data-sp]').forEach((i) => (c.suppliers[i.dataset.sp][i.dataset.k] = i.value.trim()));
        c.categories = $('#sCats').value.split('\n').map((x) => x.trim()).filter(Boolean);
        c.channels = $('#sCh').value.split('\n').map((x) => x.trim()).filter(Boolean);
      };
      $('#lAdd').onclick = () => { collect(); c.locations.push({ id: 'l' + I.uid(), name: 'New location', kind: 'storage' }); redrawKeep(); };
      $$('[data-ld]').forEach((b) => (b.onclick = () => { collect(); c.locations.splice(+b.dataset.ld, 1); redrawKeep(); }));
      $('#supAdd').onclick = () => { collect(); c.suppliers = c.suppliers || []; c.suppliers.push({ id: 's' + I.uid(), name: 'New supplier' }); redrawKeep(); };
      $$('[data-sd]').forEach((b) => (b.onclick = () => { collect(); c.suppliers.splice(+b.dataset.sd, 1); redrawKeep(); }));
      const self = this;
      function redrawKeep() { const saved = S.cfg; S.cfg = c; self.render(el); S.cfg = saved; toast('Press Save settings to keep this change'); }
      $('#sSave').onclick = async () => {
        collect(); const b = $('#sSave'); b.disabled = true; b.textContent = 'Saving…';
        try { await Store.saveConfig(c); S.cfg = c; A.recompute(); toast('Settings saved'); } catch (e) { toast(e.message, true); }
        b.disabled = false; b.textContent = 'Save settings';
      };
    },
  };

  // ================= import =================
  const PROD_FIELDS = [['name', 'Product name', /name|product|description|item|title/], ['barcode', 'Barcode / EAN', /barcode|ean|upc|gtin/], ['sku', 'SKU / code', /sku|code|plu|ref/], ['category', 'Category', /cat|department|dept|group/], ['brand', 'Brand', /brand|manufacturer|make/], ['supplier', 'Supplier', /supplier|vendor/], ['cost', 'Cost price', /cost|buy|purchase/], ['price', 'Selling price', /sell|retail|rrp|price/], ['vat', 'VAT %', /vat|tax/], ['unitName', 'Unit name', /unit/], ['caseQty', 'Units per case', /case|outer|per\s*case/], ['packQty', 'Units per pack', /pack\s*qty|per\s*pack/], ['min', 'Minimum stock', /min|reorder/], ['max', 'Maximum stock', /max/], ['qty', 'Current stock quantity', /stock|qty|quantity|on\s*hand|count/], ['location', 'Location', /location|shelf|bay|where/], ['expiry', 'Expiry date', /expir|best|bbe|use\s*by/]];
  const SALE_FIELDS = [['code', 'Barcode or SKU', /barcode|ean|upc|plu|sku|code/], ['name', 'Product name (if no barcode)', /name|product|description|item/], ['qty', 'Quantity sold', /qty|quantity|units|sold|count/], ['date', 'Date (optional)', /date|day|time/], ['price', 'Unit price (optional)', /unit\s*price|price|each/], ['total', 'Line total (optional)', /total|value|amount|sales|net|gross/]];
  function parseDateCell(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return dkey(d.getTime() + d.getTimezoneOffset() * 60000); }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    const t = Date.parse(s); return Number.isFinite(t) ? dkey(t) : null;
  }
  async function readTable(file) {
    if (/\.(xlsx|xls|xlsm|ods)$/i.test(file.name)) {
      await A.loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return { rows: window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }), text: JSON.stringify(window.XLSX.utils.sheet_to_json(ws, { header: 1 })) };
    }
    const text = await file.text();
    const res = window.Papa.parse(text.replace(/^﻿/, ''), { skipEmptyLines: true });
    return { rows: res.data, text };
  }
  V.import = {
    owner: true,
    mode: 'products', data: null,
    render(el) {
      const own = !S.ro;
      el.innerHTML = `<div class="wrap"><h1>Import</h1>
        <div class="chips">${[['products', 'Products from Excel / CSV'], ['sales', 'Till sales report']].map(([k, l]) => `<button class="chip${this.mode === k ? ' on' : ''}" data-m="${k}">${l}</button>`).join('')}</div>
        <div class="card">
          ${this.mode === 'products' ? `<p>Upload a spreadsheet with one product per row (Excel or CSV). The first row should be the column names. If it has a stock quantity column, that becomes your opening stock.</p>
            <p class="small muted">Products with a barcode or SKU that already exists are updated rather than duplicated.</p>`
          : `<p>Export the sales report from your till (usually "product sales" or "PLU sales" for a day, as CSV or Excel) and upload it here. The app takes the sold quantities off your stock, shop floor first.</p>
            <p class="small muted">Each file is remembered, so importing the same report twice is flagged. Make sure the report covers only the days you haven't imported yet.</p>`}
          <label class="btn camera-btn" for="impFile">Choose file<input id="impFile" type="file" accept=".csv,.txt,.xlsx,.xls,.ods"></label>
          <div id="impStep"></div>
        </div></div>`;
      $$('[data-m]', el).forEach((b) => (b.onclick = () => { this.mode = b.dataset.m; this.data = null; this.render(el); }));
      $('#impFile').disabled = !own;
      $('#impFile').onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try { const t = await readTable(file); this.data = { ...t, name: file.name, hash: I.hashStr(t.text) }; this.mapStep(el); } catch (err) { toast('Could not read that file: ' + err.message, true); }
      };
    },
    mapStep(el) {
      const d = this.data; const rows = d.rows.filter((r) => r.some((c) => String(c).trim() !== ''));
      if (rows.length < 2) { $('#impStep').innerHTML = '<div class="notice bad">The file needs a header row and at least one row of data.</div>'; return; }
      // find header row: first row with at least 2 text cells
      let hi = rows.findIndex((r) => r.filter((c) => typeof c === 'string' && c.trim() && isNaN(num(c, NaN))).length >= 2); if (hi < 0) hi = 0;
      const head = rows[hi].map((h) => String(h).trim()); const body = rows.slice(hi + 1);
      const fields = this.mode === 'products' ? PROD_FIELDS : SALE_FIELDS;
      const used = new Set();
      const guess = fields.map(([k, , re]) => { const i = head.findIndex((h, j) => !used.has(j) && re.test(h.toLowerCase())); if (i >= 0) used.add(i); return i; });
      const dup = this.mode === 'sales' && (S.cfg.imports || []).find((x) => x.hash === d.hash);
      $('#impStep').innerHTML = `<div class="sep"></div><h2>Match the columns</h2><p class="small muted">${fmtN(body.length)} rows in ${esc(d.name)}. Check each box points at the right column.</p>
        ${dup ? `<div class="notice bad">This exact file was already imported on ${fmtDT(dup.t)}. Importing it again would take the sales off twice.</div>` : ''}
        <div class="form">${fields.map(([k, l], fi) => `<label for="map_${k}">${esc(l)}<select id="map_${k}">${opt(-1, '— not in file —')}${head.map((h, i) => opt(i, h || 'Column ' + (i + 1), guess[fi] === i)).join('')}</select></label>`).join('')}
          ${this.mode === 'sales' ? `<label for="impDate">Date of these sales (if the file has no date column)<input id="impDate" type="date" value="${addDays(today(), -1)}"></label>` : `<label for="impLoc">Put stock in (if no location column)${A.locSelect('impLoc', I.firstShopLoc(S.cfg))}</label><label class="check" for="impUpd"><input id="impUpd" type="checkbox" checked> Update products that already exist</label>`}
        </div>
        <div class="tablebox"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.slice(0, 5).map((r) => `<tr>${head.map((_, i) => `<td>${esc(r[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="row"><button class="primary" id="impGo">${this.mode === 'sales' ? 'Check sales' : 'Import products'}</button></div><div id="impRes"></div>`;
      $('#impGo').onclick = () => {
        const map = {}; for (const [k] of fields) map[k] = +$('#map_' + k).value;
        if (this.mode === 'products') this.importProducts(head, body, map); else this.checkSales(body, map);
      };
    },
    async importProducts(head, body, map) {
      if (map.name < 0) return toast('Pick the column with product names.', true);
      const get = (r, k) => (map[k] >= 0 ? r[map[k]] : '');
      const upd = $('#impUpd').checked, defLoc = $('#impLoc').value;
      const cfg = I.clone(S.cfg); cfg.suppliers = cfg.suppliers || []; cfg.categories = cfg.categories || [];
      const locByName = (n) => { if (!n) return defLoc; const k = I.norm(n); let l = cfg.locations.find((x) => I.norm(x.name) === k || x.id === n); if (!l) { l = { id: 'l' + I.uid(), name: String(n).trim(), kind: 'storage' }; cfg.locations.push(l); } return l.id; };
      const supByName = (n) => { if (!n) return ''; const k = I.norm(n); let s = cfg.suppliers.find((x) => I.norm(x.name) === k); if (!s) { s = { id: 's' + I.uid(), name: String(n).trim() }; cfg.suppliers.push(s); } return s.id; };
      const btn = $('#impGo'); btn.disabled = true;
      let created = 0, updated = 0, skipped = 0; const newRecs = []; const errors = [];
      const tasks = [];
      const seen = new Set();
      for (const r of body) {
        const name = String(get(r, 'name')).trim(); if (!name) { skipped++; continue; }
        const code = I.codeNorm(get(r, 'barcode')), sku = String(get(r, 'sku')).trim();
        const key = code || sku || name.toLowerCase(); if (seen.has(key)) { skipped++; continue; } seen.add(key);
        const ex = (code && A.findByCode(code)) || (sku && [...S.products.values()].find((p) => I.norm(p.sku) === I.norm(sku)));
        if (ex && !upd) { skipped++; continue; }
        const fields = { name, barcode: code || ex?.barcode || '', sku: sku || ex?.sku || '' };
        const setIf = (k, v) => { if (v !== '' && v != null) fields[k] = v; };
        setIf('category', String(get(r, 'category')).trim()); setIf('brand', String(get(r, 'brand')).trim());
        if (map.supplier >= 0 && get(r, 'supplier')) fields.supplierId = supByName(get(r, 'supplier'));
        for (const k of ['cost', 'price', 'vat', 'caseQty', 'packQty', 'min', 'max']) if (map[k] >= 0 && String(get(r, k)).trim() !== '') fields[k] = num(get(r, k));
        setIf('unitName', String(get(r, 'unitName')).trim());
        if (map.expiry >= 0) { const e = parseDateCell(get(r, 'expiry')); if (e) fields.expiry = e; }
        if (fields.category && !cfg.categories.includes(fields.category)) cfg.categories.push(fields.category);
        const qtyCell = map.qty >= 0 ? String(get(r, 'qty')).trim() : '';
        const loc = map.location >= 0 ? locByName(String(get(r, 'location')).trim()) : defLoc;
        tasks.push({ ex, fields, qty: qtyCell === '' ? null : num(qtyCell), loc });
      }
      try { await Store.saveConfig(cfg); S.cfg = cfg; } catch (e) { btn.disabled = false; return toast(e.message, true); }
      let done = 0;
      const res = $('#impRes');
      const work = async () => {
        while (tasks.length) {
          const t = tasks.shift();
          try {
            if (t.ex) {
              const np = await Store.saveProduct({ ...S.products.get(t.ex.id), ...t.fields });
              A.applyLocal({ updated: [np] }); updated++;
              if (t.qty != null) { const r2 = await Store.record([{ pid: np.pid, ty: 'count', counted: t.qty, l: t.loc, r: 'Imported stock level' }], cfg); A.applyLocal(r2); }
            } else {
              let p = { vat: 20, unitName: 'unit', min: 0, ...t.fields, id: I.uid(), created: Date.now(), stock: {}, totals: { in: 0, sold: 0, rev: 0, cost: 0, out: 0 }, loc: t.loc };
              const recs = [{ id: I.uid(), t: Date.now(), p: p.id, n: p.name, ty: 'new', d: 0, q: 0, b: 0, by: Store.by, src: 'Import' }];
              if (t.qty) { const a = I.applyToProduct(p, { ty: t.qty > 0 ? 'in' : 'adj', q: t.qty, l: t.loc, t: Date.now(), r: 'Opening stock', by: Store.by, src: 'Import' }, cfg); p = a.p; recs.push(a.rec); }
              const saved = await Store.saveProduct(p, true);
              A.applyLocal({ updated: [saved] }); newRecs.push(...recs); created++;
            }
          } catch (e) { errors.push(t.fields.name + ': ' + e.message); }
          done++; if (done % 5 === 0) res.innerHTML = `<p class="muted">Imported ${done}…</p>`;
        }
      };
      await Promise.all([work(), work(), work(), work()]);
      try { if (newRecs.length) await Store.appendDays(newRecs); } catch (e) { errors.push('Activity log: ' + e.message); }
      A.applyLocal({ recs: newRecs, updated: [] });
      res.innerHTML = `<div class="notice ${errors.length ? 'warn' : ''}"><strong>Done.</strong> ${created} added, ${updated} updated, ${skipped} skipped.${errors.length ? '<br>Problems: ' + errors.slice(0, 5).map(esc).join('<br>') : ''}</div>`;
      btn.disabled = false;
    },
    checkSales(body, map) {
      if (map.qty < 0 || (map.code < 0 && map.name < 0)) return toast('Pick the quantity column and the barcode (or name) column.', true);
      const get = (r, k) => (map[k] >= 0 ? r[map[k]] : '');
      const defDate = $('#impDate').value || addDays(today(), -1);
      const agg = new Map(); const unmatched = [];
      for (const r of body) {
        const q = num(get(r, 'qty'), NaN); if (!Number.isFinite(q) || q === 0) continue;
        const code = String(get(r, 'code')).trim(); const name = String(get(r, 'name')).trim();
        let p = code ? A.findByCode(code) : null;
        if (!p && name) p = [...S.products.values()].find((x) => I.norm(x.name) === I.norm(name));
        if (!p) { unmatched.push([code, name, q]); continue; }
        const day = (map.date >= 0 && parseDateCell(get(r, 'date'))) || defDate;
        let pr = map.price >= 0 && String(get(r, 'price')).trim() !== '' ? num(get(r, 'price')) : null;
        if (pr == null && map.total >= 0 && String(get(r, 'total')).trim() !== '') pr = Math.abs(num(get(r, 'total')) / q);
        const k = p.id + '|' + day; const e = agg.get(k) || { p, day, q: 0, rev: 0 };
        e.q += q; e.rev += q * (pr ?? num(p.price)); agg.set(k, e);
      }
      const lines = [...agg.values()];
      const totalU = lines.reduce((s, e) => s + e.q, 0), totalR = lines.reduce((s, e) => s + e.rev, 0);
      this.pending = { lines, unmatched };
      $('#impRes').innerHTML = `<div class="sep"></div><h2>Ready to import</h2>
        <div class="tiles"><div class="tile"><span>Products matched</span><b>${fmtN(new Set(lines.map((l) => l.p.id)).size)}</b></div><div class="tile"><span>Units sold</span><b>${fmtN(totalU)}</b></div><div class="tile"><span>Sales value</span><b>${money(totalR)}</b></div><div class="tile ${unmatched.length ? 'warn' : ''}"><span>Rows not matched</span><b>${fmtN(unmatched.length)}</b></div></div>
        ${unmatched.length ? `<details><summary>Show rows that didn't match a product (${unmatched.length})</summary><div class="tablebox"><table><thead><tr><th>Code</th><th>Name</th><th class="n">Qty</th></tr></thead><tbody>${unmatched.slice(0, 200).map((u) => `<tr><td class="mono">${esc(u[0])}</td><td>${esc(u[1])}</td><td class="n">${fmtN(u[2])}</td></tr>`).join('')}</tbody></table></div><button id="impUnm">Download unmatched rows</button></details><p class="small muted">Register those products (or add their barcodes) and import their rows later.</p>` : ''}
        <div class="row"><button class="primary" id="impApply"${lines.length ? '' : ' disabled'}>Take ${fmtN(totalU)} units off stock</button></div>`;
      const um = $('#impUnm'); if (um) um.onclick = () => A.saveFile('unmatched-sales.csv', I.toCSV([['Code', 'Name', 'Qty'], ...unmatched]));
      $('#impApply').onclick = async () => {
        const b = $('#impApply'); b.disabled = true;
        const items = lines.map((e) => ({ pid: e.p.id, name: e.p.name, ty: e.q > 0 ? 'sale' : 'ret', q: Math.abs(e.q), pr: Math.abs(e.rev / e.q), t: new Date(e.day + 'T18:00:00').getTime(), ch: 'Till', src: 'Till import', r: e.q < 0 ? 'Till refund' : undefined }));
        try {
          const res = await Store.record(items, S.cfg, (d, n) => (b.textContent = `Saving ${d}/${n}…`));
          A.applyLocal(res);
          const cfg = I.clone(S.cfg); cfg.imports = [{ hash: this.data.hash, name: this.data.name, t: Date.now(), lines: res.recs.length }, ...(cfg.imports || [])].slice(0, 60);
          await Store.saveConfig(cfg); S.cfg = cfg;
          $('#impRes').innerHTML = `<div class="notice ${res.failed.length ? 'warn' : ''}"><strong>Done.</strong> ${res.recs.length} sales lines recorded.${res.failed.length ? ' ' + res.failed.length + ' product(s) could not be updated (' + esc(res.failed[0].error) + '). Record those sales by hand from each product\'s page.' : ''}</div>`;
        } catch (e) { toast(e.message, true); b.disabled = false; }
      };
    },
  };

  // ================= backup =================
  V.backup = {
    owner: true,
    render(el) {
      el.innerHTML = `<div class="wrap"><h1>Backup &amp; restore</h1>
        <div class="card"><h2>Download a backup</h2><p>Your data is stored online and kept when the app is updated, but it's good practice to download a full copy every week and keep it on your computer or Google Drive.</p>
          <label class="check" for="bkImg"><input id="bkImg" type="checkbox"> Include product photos (bigger file)</label>
          <div class="row"><button class="primary" id="bkGo">Download full backup (.json)</button><button id="bkCsv">Download product list (CSV)</button></div><div id="bkMsg"></div></div>
        <div class="card"><h2>Restore from a backup</h2><p class="small muted">Only the owner can restore. Restoring writes every product back from the file and adds any history that's missing; products added since the backup are kept. You can also use this to move everything from the claude.ai version of the app into the Android app.</p>
          <label class="btn camera-btn" for="bkFile">Choose backup file<input id="bkFile" type="file" accept=".json"${S.isOwner && !S.ro ? '' : ' disabled'}></label><div id="rsMsg"></div></div></div>`;
      $('#bkCsv').onclick = () => {
        const rows = [['Name', 'Barcode', 'SKU', 'Category', 'Brand', 'Supplier', 'Cost', 'Price', 'VAT %', 'Unit', 'Units per case', 'Min', 'Max', 'Total stock', ...A.locs().map((l) => l.name), 'Expiry', 'Archived']];
        for (const p of [...S.products.values()].sort((a, b) => a.name.localeCompare(b.name))) rows.push([p.name, p.barcode, p.sku, p.category, p.brand, A.supName(p.supplierId), p.cost, p.price, p.vat, p.unitName, p.caseQty, p.min, p.max, totalStock(p), ...A.locs().map((l) => num(p.stock?.[l.id])), p.expiry, p.archived ? 'yes' : '']);
        A.saveFile('products-' + today() + '.csv', I.toCSV(rows));
      };
      $('#bkGo').onclick = async () => {
        const b = $('#bkGo'), msg = $('#bkMsg'); b.disabled = true;
        try {
          msg.textContent = 'Collecting history…';
          const imgs = {};
          if ($('#bkImg').checked) { const is = await Store.retry(() => Store.db.collection('imgs').get()); for (const d of is.docs) imgs[d.id] = d.data(); }
          msg.textContent = 'Collecting the ledger…';
          const led = {};
          for (const u of await Store.ledgerUsers()) { const ds = await Store.retry(() => Store.db.collection('led/' + u + '/d').get()); led[u] = {}; for (const d of ds.docs) led[u][d.id] = d.data(); }
          const products = Object.fromEntries(S.pub); const priv = Object.fromEntries(S.priv);
          const data = JSON.stringify({ app: 'shop-stock', version: 2, exported: Date.now(), config: S.cfg, products, priv, led, imgs });
          await A.saveFile('shop-backup-' + today() + '.json', data);
          msg.textContent = '';
        } catch (e) { toast(e.message, true); msg.textContent = ''; }
        b.disabled = false;
      };
      $('#bkFile').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        let data; try { data = JSON.parse(await f.text()); } catch (err) { return toast('That isn\'t a backup file.', true); }
        if (data.app !== 'shop-stock') return toast('That isn\'t a backup from this app.', true);
        const n = Object.keys(data.products || {}).length;
        if (!(await A.confirmBox('Restore backup?', `This writes back ${n} products, their history and the shop settings from ${fmtDT(data.exported)}. Current stock numbers for those products will be replaced by the backup's.`, 'Restore', true))) return;
        const msg = $('#rsMsg');
        try {
          await Store.saveConfig({ ...data.config, owner: S.cfg?.owner || S.uid || null, staff: S.cfg?.staff || [] });
          let i = 0;
          for (const [id, p0] of Object.entries(data.products || {})) {
            const { pub, priv } = I.splitProduct({ ...p0, ...(data.priv?.[id] || {}) });
            await Store.retry(() => Store.db.doc('products/' + id).set(pub)); await Store.retry(() => Store.db.doc('priv/' + id).set(priv));
            if (data.imgs?.[id]) await Store.retry(() => Store.db.doc('imgs/' + id).set(data.imgs[id]));
            if (++i % 10 === 0) msg.textContent = `Restored ${i} of ${n}…`;
          }
          const allMoves = [];
          for (const days of Object.values(data.led || {})) for (const d of Object.values(days)) allMoves.push(...(d.moves || []));
          for (const d of Object.values(data.days || {})) allMoves.push(...(d.moves || []));
          const have = new Set((await Store.loadDays('2000-01-01', today())).map((m) => m.id));
          const missing = allMoves.filter((m) => !have.has(m.id)).sort((x, y) => x.t - y.t);
          if (missing.length) await Store.appendDays(missing);
          msg.innerHTML = '<div class="notice">Restore complete.</div>';
        } catch (err) { toast('Restore stopped: ' + err.message, true); }
      };
    },
  };

  // ================= help =================
  V.help = {
    render(el) {
      const own = S.isOwner;
      el.innerHTML = `<div class="wrap help"><h1>How to use this app</h1>
        <div class="card"><h2>The idea</h2><p>Every time stock arrives, moves, gets counted or thrown away, it's recorded — so the app always knows how much of each product you have and exactly where it is.</p></div>
        <div class="card"><h2>Scanning</h2><ul>
          <li><strong>Barcode scanner (fastest):</strong> pair a Bluetooth scanner with your phone like a keyboard. Open the app and scan — the product opens straight away, no buttons.</li>
          <li><strong>Phone camera:</strong> press <em>Scan barcode</em>. Your camera opens; take the picture and the product opens. Hold the phone 10–20 cm away with the barcode flat and well lit.</li>
          <li><strong>Typing:</strong> type the barcode number or part of the name in the box.</li></ul></div>
        <div class="card"><h2>Adding a new product</h2><ol>
          <li>Scan its barcode and press <em>Register this product</em>.</li>
          <li>Press <em>Take product photo</em> and photograph the front of the pack. The app reads the pack and fills in the name, brand, size and description.</li>
          <li>Check the details, ${own ? 'add the prices' : 'add the shelf price'}, type how many you have and where, then save.</li></ol></div>
        <div class="card"><h2>Everyday jobs</h2><ul>
          <li><strong>Delivery arrived:</strong> Scan → Receive a delivery (or open a product → Receive stock). Choose "Cases" and the app works out the units: 10 cases × 24 = 240 cans.</li>
          <li><strong>Filling shelves from the back:</strong> open the product → Move stock, from the storage room to the shop floor.</li>
          <li><strong>Damaged or expired:</strong> open the product → Remove stock and pick the reason.</li>
          <li><strong>Counting:</strong> the Count tab. Pick the place, scan each product and type what you counted.</li></ul></div>
        ${own ? `<div class="card owner-card"><h2>Owner: your daily routine</h2><ol>
          <li><strong>Import yesterday's till sales</strong> — Back office → Import → Till sales report. This takes the sold items off your stock.</li>
          <li><strong>Check Alerts</strong> — what's running out, what to reorder, what's not selling, what's expiring, and what's been forgotten in storage.</li>
          <li><strong>Once a week:</strong> look at the Dashboard and download a backup.</li></ol></div>
        <div class="card owner-card"><h2>Owner: staff access</h2><p>Share this app from its page on claude.ai (the Share button) with each staff member's email as <strong>Editor</strong>. They need a free claude.ai account. Staff only see Scan, Stock and Count: product details, selling prices and stock levels. Cost prices, suppliers, sales, profit, reports and the activity log stay in your Back office, and the database itself refuses to show them to anyone but you.</p></div>` : ''}
        <div class="card"><h2>Good habits</h2><ul>
          <li>Never "fix" a number by guessing — use Count stock, so the difference is recorded.</li>
          <li>Always use Move stock when you take things from the back to the shelf, so the app knows where they are.</li></ul></div></div>`;
    },
  };

  A.boot();
})();
