/* data.js — the shop's data layer: database access, stock movements, sales maths, alerts.
   Everything here works on plain objects so it can be tested without a screen. */
(function (G) {
  'use strict';

  // ---------- small helpers ----------
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const dkey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const today = () => dkey(Date.now());
  const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return dkey(new Date(y, m - 1, d + n, 12).getTime()); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / DAY);
  const weekStart = (key) => { const d = new Date(key + 'T12:00:00'); const wd = (d.getDay() + 6) % 7; return addDays(key, -wd); };
  const monthStart = (key) => key.slice(0, 8) + '01';
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const num = (v, def = 0) => { const n = parseFloat(String(v ?? '').replace(/[£,\s]/g, '')); return Number.isFinite(n) ? n : def; };
  const round2 = (n) => Math.round(n * 100) / 100;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (o) => JSON.parse(JSON.stringify(o || {}));
  const norm = (s) => String(s || '').trim().toLowerCase();
  const codeNorm = (s) => String(s || '').replace(/\s+/g, '').trim();

  // ---------- money: UK prices normally include VAT; cost prices from suppliers normally don't ----------
  function netPrice(p, cfg) {
    const price = num(p.price);
    const inc = cfg?.settings?.pricesIncVat !== false;
    const v = num(p.vat, 20) / 100;
    return inc ? price / (1 + v) : price;
  }
  function unitProfit(p, cfg) { return netPrice(p, cfg) - num(p.cost); }
  function marginPct(p, cfg) { const n = netPrice(p, cfg); return n > 0 ? (unitProfit(p, cfg) / n) * 100 : 0; }

  // ---------- units: individual units, packs, boxes, cases ----------
  const UNIT_TYPES = [
    { k: 'unit', label: 'Units' },
    { k: 'pack', label: 'Packs', f: 'packQty' },
    { k: 'box', label: 'Boxes', f: 'boxQty' },
    { k: 'case', label: 'Cases', f: 'caseQty' },
  ];
  function perUnit(p, k) {
    if (!k || k === 'unit') return 1;
    const t = UNIT_TYPES.find((u) => u.k === k);
    return Math.max(1, Math.round(num(p[t.f], 1)));
  }
  function unitTypesFor(p) { return UNIT_TYPES.filter((u) => u.k === 'unit' || num(p[u.f]) > 1); }
  function unitName(p, n) { const u = (p.unitName || 'unit').trim() || 'unit'; return n === 1 ? u : (/s$/.test(u) ? u : u + 's'); }
  function breakdown(p, total) {
    // "240 cans = 10 cases" / "250 cans = 10 cases + 10 cans"
    const parts = [];
    for (const t of [...UNIT_TYPES].reverse()) {
      if (t.k === 'unit') continue;
      const per = num(p[t.f]);
      if (per > 1 && Math.abs(total) >= per) {
        const whole = Math.trunc(total / per), rest = total - whole * per;
        parts.push(whole + ' ' + (whole === 1 ? t.label.slice(0, -1).toLowerCase() : t.label.toLowerCase()) + (rest ? ' + ' + rest + ' ' + unitName(p, rest) : ''));
        break;
      }
    }
    return parts[0] || '';
  }

  // ---------- default shop set-up (written only when the owner presses "Set up my shop") ----------
  function defaultConfig(name) {
    return {
      name: name || 'My Shop',
      locations: [
        { id: 'floor', name: 'Shop floor', kind: 'shop' },
        { id: 'front', name: 'Front shelf', kind: 'shop' },
        { id: 'back', name: 'Back shelf', kind: 'shop' },
        { id: 'store', name: 'Storage room', kind: 'storage' },
        { id: 'backroom', name: 'Back room', kind: 'storage' },
        { id: 'hold', name: 'Damaged / on hold', kind: 'hold' },
      ],
      categories: ['Soft drinks', 'Beer & cider', 'Wine', 'Spirits', 'Crisps & snacks', 'Confectionery', 'Grocery', 'Household', 'Tobacco', 'Other'],
      suppliers: [],
      channels: ['Till', 'Delivery', 'Phone order', 'Other'],
      settings: { pricesIncVat: true, deadDays: 30, expiryDays: 30, storageDays: 45, coverDays: 90, leadDays: 7, reorderDays: 21 },
      imports: [],
      created: Date.now(),
    };
  }

  // ---------- movement kinds ----------
  // d = change to the product's total stock. Transfers change locations only (d = 0).
  const KINDS = {
    in: { label: 'Stock received', sign: 1, cls: 'in' },
    ret: { label: 'Customer return', sign: 1, cls: 'in' },
    sale: { label: 'Sale', sign: -1, cls: 'out' },
    out: { label: 'Removed', sign: -1, cls: 'out' },
    adj: { label: 'Adjustment', sign: 0, cls: '' },
    count: { label: 'Stock count', sign: 0, cls: '' },
    xfer: { label: 'Moved', sign: 0, cls: '' },
    new: { label: 'Product added', sign: 0, cls: '' },
    edit: { label: 'Product edited', sign: 0, cls: '' },
    archive: { label: 'Archived', sign: 0, cls: '' },
    restore: { label: 'Restored', sign: 0, cls: '' },
    delete: { label: 'Deleted', sign: 0, cls: '' },
  };
  const OUT_REASONS = ['Damaged', 'Expired', 'Returned to supplier', 'Personal use', 'Lost / theft', 'Free sample', 'Other'];
  const IN_REASONS = ['Delivery', 'Opening stock', 'Found / correction'];

  function totalStock(p) { let t = 0; for (const v of Object.values(p.stock || {})) t += num(v); return t; }
  function stockByKind(p, cfg) {
    const out = { shop: 0, storage: 0, other: 0, hold: 0 };
    const locs = cfg?.locations || [];
    for (const [id, q] of Object.entries(p.stock || {})) {
      const l = locs.find((x) => x.id === id);
      out[l ? l.kind : 'other'] = (out[l ? l.kind : 'other'] || 0) + num(q);
    }
    return out;
  }
  function available(p, cfg) { const k = stockByKind(p, cfg); return k.shop + k.storage + k.other; }

  // Apply one movement to a product object (pure). Returns {p, rec}.
  function applyToProduct(p0, mv, cfg) {
    const p = clone(p0);
    p.stock = p.stock || {}; p.locSince = p.locSince || {}; p.totals = p.totals || { in: 0, sold: 0, rev: 0, cost: 0, out: 0 };
    const q = Math.abs(num(mv.q));
    const before = totalStock(p);
    const bump = (loc, delta) => {
      const prev = num(p.stock[loc]);
      const next = prev + delta;
      if (next === 0) delete p.stock[loc]; else p.stock[loc] = next;
      if (prev <= 0 && next > 0) p.locSince[loc] = mv.t;
      if (next <= 0) delete p.locSince[loc];
    };
    let d = 0;
    switch (mv.ty) {
      case 'in': case 'ret': bump(mv.l, q); d = q; break;
      case 'sale': case 'out': {
        // If no location was chosen, take stock from the shop floor first, then storage.
        if (mv.l) { bump(mv.l, -q); }
        else {
          let left = q;
          const order = pickOrder(p, cfg);
          for (const loc of order) { if (left <= 0) break; const have = num(p.stock[loc]); if (have <= 0) continue; const take = Math.min(have, left); bump(loc, -take); left -= take; }
          if (left > 0) bump(order[0] || firstShopLoc(cfg), -left);
          mv.l = mv.l || order[0] || firstShopLoc(cfg);
        }
        d = -q; break;
      }
      case 'adj': { const s = num(mv.q); bump(mv.l, s); d = s; break; }
      case 'count': { const prev = num(p.stock[mv.l]); const s = num(mv.counted) - prev; bump(mv.l, s); d = s; mv.q = s; break; }
      case 'xfer': { const have = num(p.stock[mv.l]); bump(mv.l, -q); bump(mv.to, q); d = 0; mv.had = have; break; }
      default: d = 0;
    }
    if (mv.ty === 'in') { p.totals.in += q; p.lastIn = mv.t; if (mv.c != null && num(mv.c) > 0) p.cost = round2(num(mv.c)); if (mv.exp) { if (!p.expiry || before <= 0 || mv.exp < p.expiry) p.expiry = mv.exp; } }
    if (mv.ty === 'sale') { const pr = mv.pr != null ? num(mv.pr) : num(p.price); p.totals.sold += q; p.totals.rev = round2(p.totals.rev + q * pr); p.totals.cost = round2(p.totals.cost + q * num(p.cost)); p.lastSale = Math.max(p.lastSale || 0, mv.t); }
    if (mv.ty === 'ret') { const pr = mv.pr != null ? num(mv.pr) : num(p.price); p.totals.sold -= q; p.totals.rev = round2(p.totals.rev - q * pr); p.totals.cost = round2(p.totals.cost - q * num(p.cost)); }
    if (mv.ty === 'out') p.totals.out += q;
    const after = totalStock(p);
    const rec = {
      id: mv.id || uid(), t: mv.t, p: p.id, n: p.name, ty: mv.ty, d, q: mv.ty === 'adj' || mv.ty === 'count' ? d : q,
      l: mv.l || null, to: mv.to || null, b: after,
      pr: mv.ty === 'sale' || mv.ty === 'ret' ? (mv.pr != null ? num(mv.pr) : num(p.price)) : undefined,
      c: num(p.cost), cat: p.category || '', sup: mv.sup || (mv.ty === 'in' ? p.supplierId : undefined) || undefined,
      r: mv.r || undefined, ref: mv.ref || undefined, ch: mv.ch || undefined, no: mv.no || undefined,
      u: mv.u || undefined, by: mv.by || undefined, src: mv.src || undefined,
    };
    for (const k of Object.keys(rec)) if (rec[k] === undefined || rec[k] === '') delete rec[k];
    return { p, rec };
  }
  function firstShopLoc(cfg) { const l = (cfg?.locations || []).find((x) => x.kind === 'shop'); return l ? l.id : (cfg?.locations?.[0]?.id || 'floor'); }
  function pickOrder(p, cfg) {
    const locs = cfg?.locations || [];
    const rank = { shop: 0, storage: 1, other: 2, hold: 3 };
    const ids = new Set([...Object.keys(p.stock || {}), ...locs.map((l) => l.id)]);
    return [...ids].filter((id) => { const l = locs.find((x) => x.id === id); return !l || l.kind !== 'hold'; })
      .sort((a, b) => {
        const la = locs.find((x) => x.id === a), lb = locs.find((x) => x.id === b);
        const ra = rank[la?.kind || 'other'], rb = rank[lb?.kind || 'other'];
        if (ra !== rb) return ra - rb;
        return num(p.stock?.[b]) - num(p.stock?.[a]);
      });
  }

  // ---------- statistics from the movement ledger ----------
  // moves: array of ledger records. Returns per-product daily sales map + helpers.
  function salesIndex(moves) {
    const byP = new Map(); // pid -> Map(day -> {u, rev, cost})
    for (const m of moves) {
      if (m.ty !== 'sale' && m.ty !== 'ret') continue;
      const s = m.ty === 'sale' ? 1 : -1;
      const day = dkey(m.t);
      let mp = byP.get(m.p); if (!mp) { mp = new Map(); byP.set(m.p, mp); }
      const e = mp.get(day) || { u: 0, rev: 0, cost: 0 };
      e.u += s * Math.abs(m.q); e.rev += s * Math.abs(m.q) * num(m.pr); e.cost += s * Math.abs(m.q) * num(m.c);
      mp.set(day, e);
    }
    return byP;
  }
  function sumRange(mp, from, to) {
    const out = { u: 0, rev: 0, cost: 0 };
    if (!mp) return out;
    for (const [day, e] of mp) if (day >= from && day <= to) { out.u += e.u; out.rev += e.rev; out.cost += e.cost; }
    return out;
  }
  function productStats(p, mp, cfg, now = today()) {
    const t = sumRange(mp, now, now);
    const wk = sumRange(mp, weekStart(now), now);
    const mo = sumRange(mp, monthStart(now), now);
    const d28 = sumRange(mp, addDays(now, -27), now);
    const d7 = sumRange(mp, addDays(now, -6), now);
    const prior21 = sumRange(mp, addDays(now, -27), addDays(now, -7));
    const ageDays = Math.max(1, daysBetween(dkey(p.created || Date.now()), now) + 1);
    const window = Math.min(28, ageDays);
    const v = d28.u / window; // average units per day
    const total = totalStock(p);
    const avail = available(p, cfg);
    const cover = v > 0 ? avail / v : Infinity; // days of stock left at current pace
    const lastSaleDay = p.lastSale ? dkey(p.lastSale) : null;
    const idle = daysBetween(lastSaleDay || dkey(p.created || Date.now()), now);
    let speed = 'none';
    if (v >= 3) speed = 'fast'; else if (v >= 0.5) speed = 'steady'; else if (v > 0) speed = 'slow';
    return { today: t, week: wk, month: mo, d28, d7, prior21, v, total, avail, cover, idle, speed, neverSold: !p.lastSale };
  }

  function reorderSuggestion(p, st, cfg) {
    const s = cfg?.settings || {};
    const min = num(p.min), max = num(p.max);
    const need = st.avail <= min || (st.v > 0 && st.cover < num(s.leadDays, 7));
    if (!need) return 0;
    let target = max > 0 ? max : Math.max(min * 2, Math.ceil(st.v * num(s.reorderDays, 21)));
    let q = Math.max(0, target - st.avail);
    const cs = num(p.caseQty) > 1 ? num(p.caseQty) : (num(p.boxQty) > 1 ? num(p.boxQty) : (num(p.packQty) > 1 ? num(p.packQty) : 1));
    if (cs > 1) q = Math.ceil(q / cs) * cs;
    return q || cs;
  }

  // Build the full list of problems the shop should look at.
  function buildAlerts(products, idx, cfg, now = today()) {
    const s = cfg?.settings || {};
    const out = [];
    const locs = cfg?.locations || [];
    for (const p of products) {
      if (p.archived) continue;
      const st = productStats(p, idx.get(p.id), cfg, now);
      const min = num(p.min);
      if (st.avail <= 0) out.push({ p, type: 'out', sev: 'bad', title: 'Out of stock', text: st.total > 0 ? 'Only damaged / on-hold stock left' : (p.lastSale ? 'Last sold ' + rel(p.lastSale) : 'No stock recorded') });
      else if (min > 0 && st.avail <= min) out.push({ p, type: 'low', sev: 'warn', title: 'Low stock', text: st.avail + ' left (minimum ' + min + ')' });
      const rq = reorderSuggestion(p, st, cfg);
      if (rq > 0) out.push({ p, type: 'reorder', sev: 'warn', title: 'Reorder', text: 'Suggest ordering ' + rq + ' ' + unitName(p, rq) + (breakdown(p, rq) ? ' (' + breakdown(p, rq) + ')' : '') + (st.v > 0 ? ' · sells ~' + fmtN(st.v, 1) + '/day' : ''), qty: rq });
      if (st.total > 0) {
        const created = daysBetween(dkey(p.created || Date.now()), now);
        for (const lim of [90, 60, 30]) {
          if (st.idle >= lim && created >= Math.min(lim, st.idle)) {
            out.push({ p, type: 'dead', sev: lim >= 60 ? 'bad' : 'warn', title: 'Not sold for ' + lim + '+ days', text: (p.lastSale ? 'Last sale ' + rel(p.lastSale) : 'Never sold since added') + ' · ' + st.total + ' in stock', days: lim });
            break;
          }
        }
      }
      if (p.expiry && st.total > 0) {
        const left = daysBetween(now, p.expiry);
        if (left < 0) out.push({ p, type: 'expiry', sev: 'bad', title: 'Expired', text: 'Expired ' + fmtDate(p.expiry) + ' · ' + st.total + ' in stock' });
        else if (left <= num(s.expiryDays, 30)) out.push({ p, type: 'expiry', sev: left <= 7 ? 'bad' : 'warn', title: 'Expiring soon', text: 'Expires ' + fmtDate(p.expiry) + ' (' + left + ' days) · ' + st.total + ' in stock' });
      }
      if (st.d7.u >= 5) {
        const base = st.prior21.u / 21 * 7;
        if (st.d7.u > Math.max(2 * base, base + 5)) out.push({ p, type: 'hot', sev: 'info', title: 'Selling unusually fast', text: st.d7.u + ' sold in 7 days (usually ~' + Math.round(base) + ')' });
      }
      const max = num(p.max);
      if ((max > 0 && st.total > max) || (st.v > 0 && st.cover > num(s.coverDays, 90))) {
        out.push({ p, type: 'over', sev: 'info', title: 'Possibly overstocked', text: max > 0 && st.total > max ? st.total + ' in stock (maximum ' + max + ')' : 'About ' + Math.round(st.cover) + ' days of stock at current sales' });
      }
      for (const [lid, since] of Object.entries(p.locSince || {})) {
        const l = locs.find((x) => x.id === lid);
        if (!l || l.kind !== 'storage' || num(p.stock?.[lid]) <= 0) continue;
        const days = daysBetween(dkey(since), now);
        if (days >= num(s.storageDays, 45)) out.push({ p, type: 'storage', sev: 'warn', title: 'Sitting in storage', text: p.stock[lid] + ' in ' + l.name + ' for ' + days + ' days', loc: lid });
      }
    }
    const order = { bad: 0, warn: 1, info: 2 };
    return out.sort((a, b) => order[a.sev] - order[b.sev]);
  }

  // ---------- formatting ----------
  const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  const money = (n) => GBP.format(num(n));
  const fmtN = (n, dp = 0) => (Number.isFinite(n) ? Number(n).toLocaleString('en-GB', { maximumFractionDigits: dp, minimumFractionDigits: 0 }) : '—');
  function fmtDate(x) { if (!x) return '—'; const d = typeof x === 'number' ? new Date(x) : new Date(String(x).length === 10 ? x + 'T12:00:00' : x); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function fmtDT(t) { if (!t) return '—'; const d = new Date(t); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function rel(t) { if (!t) return 'never'; const n = daysBetween(dkey(t), today()); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; }

  // ---------- database access ----------
  // What staff can see                      What only the owner can see
  //   config/shop      settings, locations    priv/<id>          cost, supplier, sales totals
  //   products/<id>    name, price, stock     led/<user>/d/<day> the movement ledger (each person writes
  //   imgs/<id>        product photo                             their own; only the owner reads everyone's)
  const PRIV = ['cost', 'supplierId', 'totals', 'lastSale', 'lastIn'];
  function splitProduct(p) {
    const pub = {}, priv = {};
    for (const [k, v] of Object.entries(p || {})) { if (k === 'id') continue; if (PRIV.includes(k)) priv[k] = v; else pub[k] = v; }
    return { pub, priv };
  }
  const Store = {
    db: null, holder: 'tab-' + uid(), by: null, owner: false, marked: false,
    init(db, by, owner) { this.db = db; this.by = by; this.owner = !!owner; },
    async lease(ref) {
      for (let i = 0; i < 25; i++) {
        let r = null;
        try { r = await ref.acquire({ holder: this.holder, ttlMs: 4000 }); } catch (e) { if (e && e.code === 'unavailable') { await sleep(300 + Math.random() * 400); continue; } throw e; }
        if (r && r.acquired) return true;
        await sleep(250 + Math.random() * 500);
      }
      throw new Error('Someone else is updating this record. Try again in a moment.');
    },
    async retry(fn) {
      try { return await fn(); } catch (e) { if (e && e.code === 'unavailable') { await sleep(400 + Math.random() * 600); return fn(); } throw e; }
    },
    // Record stock movements. Different products are written four at a time; the same product one after another,
    // under a short lock so two phones changing the same item can't overwrite each other.
    async record(items, cfg, onProgress, privOf) {
      const db = this.db; const recs = []; const updated = []; const failed = [];
      const groups = new Map();
      for (const it of items) { if (!groups.has(it.pid)) groups.set(it.pid, []); groups.get(it.pid).push(it); }
      const queue = [...groups.entries()];
      let done = 0;
      const work = async () => {
        while (queue.length) {
          const [pid, list] = queue.shift();
          try {
            const pref = db.doc('products/' + pid);
            await this.lease(pref);
            const snap = await this.retry(() => pref.get());
            if (!snap.exists || !snap.data().name) throw new Error('Product not found: ' + (list[0].name || pid));
            let priv0 = {};
            if (this.owner) { const ps = await this.retry(() => db.doc('priv/' + pid).get()); priv0 = ps.exists ? ps.data() : (privOf ? privOf(pid) || {} : {}); }
            let p = { ...snap.data(), ...priv0, id: pid };
            const mine = [];
            for (const it of list) {
              const mv = { ...it, t: it.t || Date.now(), by: this.by, id: uid() };
              delete mv.pid; delete mv.name;
              const r = applyToProduct(p, mv, cfg);
              p = r.p;
              if (!this.owner) { delete r.rec.c; delete r.rec.pr; delete r.rec.sup; }
              mine.push(r.rec);
            }
            p.updatedAt = Date.now(); p.updatedBy = this.by;
            const { pub, priv } = splitProduct(p);
            await this.retry(() => pref.set(pub));
            if (this.owner) await this.retry(() => db.doc('priv/' + pid).set(priv));
            recs.push(...mine); updated.push({ pid, pub, priv: this.owner ? priv : null });
          } catch (e) { failed.push({ pid, items: list, error: e.message || String(e) }); }
          done += list.length;
          onProgress && onProgress(done, items.length);
        }
      };
      await Promise.all([work(), work(), work(), work()]);
      recs.sort((a, b) => a.t - b.t);
      if (recs.length) await this.appendDays(recs);
      return { recs, updated, failed };
    },
    // Each person's movements go in their own ledger, one document per day (spilling into day_2, day_3 … past ~180 KB).
    async appendDays(recs) {
      if (!this.by) throw new Error('You need to be signed in to record stock.');
      const base = 'led/' + this.by;
      if (!this.marked) { await this.retry(() => this.db.doc(base).set({ u: this.by, t: Date.now() })); this.marked = true; }
      const groups = new Map();
      for (const r of recs) { const k = dkey(r.t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
      for (const [day, list] of groups) {
        let part = 1; const pending = list.slice();
        while (pending.length) {
          const ref = this.db.doc(base + '/d/' + (part === 1 ? day : day + '_' + part));
          await this.lease(ref);
          const s = await this.retry(() => ref.get());
          const moves = (s.exists && Array.isArray(s.data().moves)) ? s.data().moves.slice() : [];
          let size = JSON.stringify(moves).length;
          if (size > 180000) { part++; continue; }
          const take = [];
          while (pending.length && size < 180000) { const r = pending.shift(); size += JSON.stringify(r).length + 1; take.push(r); }
          await this.retry(() => ref.set({ date: day, part, moves: moves.concat(take) }));
          if (pending.length) part++;
        }
      }
    },
    async ledgerUsers() {
      if (!this.owner) return [this.by];
      const s = await this.retry(() => this.db.collection('led').get());
      return s.docs.map((d) => d.id);
    },
    async loadDays(from, to) {
      const users = await this.ledgerUsers(); const moves = [];
      for (const u of users) {
        const snap = await this.retry(() => this.db.collection('led/' + u + '/d').where('date', '>=', from).where('date', '<=', to).get());
        for (const d of snap.docs) { const m = d.data()?.moves; if (Array.isArray(m)) moves.push(...m); }
      }
      return moves.sort((a, b) => a.t - b.t);
    },
    async logEvent(ty, p, extra) {
      const rec = { id: uid(), t: Date.now(), p: p.id, n: p.name, ty, d: 0, q: 0, b: totalStock(p), by: this.by, ...(extra || {}) };
      await this.appendDays([rec]);
      return rec;
    },
    // Saves a product. Staff saves never touch the owner-only part.
    async saveProduct(p, isNew) {
      const id = p.id || uid();
      const { pub, priv } = splitProduct({ ...p, updatedAt: Date.now(), updatedBy: this.by });
      const ref = this.db.doc('products/' + id);
      if (!isNew) await this.lease(ref);
      await this.retry(() => ref.set(pub));
      if (this.owner) await this.retry(() => this.db.doc('priv/' + id).set(priv));
      return { pid: id, pub, priv: this.owner ? priv : null };
    },
    async saveImage(pid, dataUrl) { await this.retry(() => this.db.doc('imgs/' + pid).set({ d: dataUrl, t: Date.now() })); },
    async getImage(pid) { const s = await this.retry(() => this.db.doc('imgs/' + pid).get()); return s.exists ? s.data().d : null; },
    async saveConfig(cfg) { await this.retry(() => this.db.doc('config/shop').set(clone(cfg))); },
    async deleteProduct(pid) { for (const c of ['products', 'priv', 'imgs']) await this.retry(() => this.db.doc(c + '/' + pid).delete()); },
  };

  // ---------- CSV ----------
  function toCSV(rows) {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return rows.map((r) => r.map(esc).join(',')).join('\r\n');
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + '-' + s.length; }

  G.Inv = {
    DAY, dkey, today, addDays, daysBetween, weekStart, monthStart, uid, num, round2, sleep, clone, norm, codeNorm,
    netPrice, unitProfit, marginPct, UNIT_TYPES, perUnit, unitTypesFor, unitName, breakdown, defaultConfig,
    KINDS, OUT_REASONS, IN_REASONS, totalStock, stockByKind, available, applyToProduct, pickOrder, firstShopLoc,
    salesIndex, sumRange, splitProduct, PRIV, productStats, reorderSuggestion, buildAlerts, money, fmtN, fmtDate, fmtDT, rel, Store, toCSV, hashStr,
  };
})(typeof window !== 'undefined' ? window : globalThis);
