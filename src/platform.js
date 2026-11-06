// platform.js — Android app only. Gives the shared app code the same "claude.use()" services it gets on
// claude.ai (database, user, downloads), but backed by Google Firebase and the phone's own features.
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, updateProfile,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc as fdoc, collection as fcol,
  getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, runTransaction,
} from 'firebase/firestore';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { firebaseConfig } from './firebase-config.js';

const configured = firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PASTE');
let app, auth, fs;
if (configured) {
  app = initializeApp(firebaseConfig);
  auth = initializeAuth(app, { persistence: indexedDBLocalPersistence });
  // Keeps a copy on the phone, so the app opens instantly and keeps working without signal.
  fs = initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
}

// ---------- database adapter (same shape the app uses on claude.ai) ----------
const wrapDoc = (s) => ({ id: s.id, exists: s.exists(), data: () => (s.exists() ? s.data() : undefined), metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites } });
const wrapQuery = (qs) => ({
  docs: qs.docs.map(wrapDoc), size: qs.size, empty: qs.empty,
  docChanges: () => qs.docChanges().map((c) => ({ type: c.type, doc: wrapDoc(c.doc), oldIndex: c.oldIndex, newIndex: c.newIndex })),
  metadata: { fromCache: qs.metadata.fromCache, hasPendingWrites: qs.metadata.hasPendingWrites },
});
const err = (e) => ({ code: e?.code === 'permission-denied' ? 'invalid_argument' : e?.code === 'resource-exhausted' ? 'resource_exhausted' : (e?.code === 'unavailable' || e?.code === 'deadline-exceeded') ? 'unavailable' : (e?.code || 'unavailable'), message: e?.message || String(e) });
const wrapErr = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { throw err(e); } };

function docRef(path) {
  const r = fdoc(fs, path);
  return {
    id: r.id, path,
    get: wrapErr(async () => wrapDoc(await getDoc(r))),
    set: wrapErr(async (data) => { await setDoc(r, data); }),
    update: wrapErr(async (data) => { await updateDoc(r, data); }),
    delete: wrapErr(async () => { await deleteDoc(r); }),
    // A short lock so two phones changing the same product can't overwrite each other.
    acquire: wrapErr(async ({ holder, ttlMs = 30000 }) => {
      if (!navigator.onLine) return { acquired: true, holder };
      const lock = fdoc(fs, 'locks/' + path.replace(/\//g, '__'));
      const now = Date.now();
      try {
        return await runTransaction(fs, async (tx) => {
          const s = await tx.get(lock);
          const l = s.exists() ? s.data() : null;
          if (l && l.exp > now && l.holder !== holder) return { acquired: false, expiresAt: new Date(l.exp).toISOString() };
          tx.set(lock, { holder, exp: now + Math.min(Math.max(ttlMs, 1000), 600000) });
          return { acquired: true, holder };
        });
      } catch (e) { if (e?.code === 'unavailable' || e?.code === 'failed-precondition') return { acquired: true, holder }; throw e; }
    }),
    onSnapshot(next, error) { return onSnapshot(r, { includeMetadataChanges: false }, (s) => next(wrapDoc(s)), (e) => error && error(err(e))); },
    collection(sub) { return collRef(path + '/' + sub); },
  };
}
function makeQuery(path, cons) {
  const build = () => query(fcol(fs, path), ...cons);
  return {
    where: (f, op, v) => makeQuery(path, [...cons, where(f, op, v)]),
    orderBy: (f, dir) => makeQuery(path, [...cons, orderBy(f, dir || 'asc')]),
    limit: (n) => makeQuery(path, [...cons, limit(n)]),
    get: wrapErr(async () => wrapQuery(await getDocs(build()))),
    onSnapshot(next, error) { return onSnapshot(build(), (qs) => next(wrapQuery(qs)), (e) => error && error(err(e))); },
  };
}
function collRef(path) {
  const q = makeQuery(path, []);
  return { ...q, path, doc: (id) => docRef(path + '/' + (id || fdoc(fcol(fs, path)).id)), add: async (d) => { const r = docRef(path + '/' + fdoc(fcol(fs, path)).id); await r.set(d); return r; } };
}
const db = { doc: docRef, collection: collRef };

// ---------- user ----------
let me = null, ownerId = null, configExists = false;
const names = new Map();
const user = {
  async id() { return me?.uid || null; },
  async isOwner() { return !!me && (!configExists || ownerId === me.uid); },
  async canEdit() { return this.isOwner(); },
  async can() { return true; },
  async me() { return { id: me?.uid || null, name: me?.displayName || '', email: me?.email || null, isOwner: await this.isOwner(), canEdit: await this.isOwner(), avatarUrl: '', color: '#0b7a55' }; },
  async profiles(ids) {
    const out = {};
    for (const id of [].concat(ids)) {
      if (!names.has(id)) { try { const s = await getDoc(fdoc(fs, 'users/' + id)); names.set(id, s.exists() ? s.data().name || '' : ''); } catch (e) { names.set(id, ''); } }
      out[id] = { id, name: names.get(id) || '', isMe: id === me?.uid, avatarUrl: '', color: '#0b7a55', email: null, guest: false };
    }
    return out;
  },
  async name() { return me?.displayName || ''; },
  async search() { return []; },
};

// ---------- downloads: save the file, then open Android's share menu (Drive, WhatsApp, email, Files…) ----------
const downloads = {
  async save({ filename, data }) {
    let base64;
    if (typeof data === 'string') base64 = btoa(unescape(encodeURIComponent(data)));
    else {
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      base64 = btoa(s);
    }
    const res = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    try { await Share.share({ title: filename, files: [res.uri] }); } catch (e) { if (!/cancel/i.test(e?.message || '')) throw { code: 'unavailable', message: e?.message }; throw { code: 'declined', message: 'cancelled' }; }
    return { status: 'saved' };
  },
};

window.claude = { use: async (n) => ({ db, user, downloads }[n] || null) };

// ---------- phone features ----------
async function ensureScanner() {
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (available) return;
  await BarcodeScanner.installGoogleBarcodeScannerModule();
  window.App?.toast('Downloading the barcode scanner (first time only)…');
  await new Promise((res) => {
    const h = BarcodeScanner.addListener('googleBarcodeScannerModuleInstallProgress', (e) => { if (e.state === 4 || e.progress >= 100) { h.then((x) => x.remove()); res(); } });
    setTimeout(res, 60000);
  });
}
async function scan() {
  await ensureScanner();
  const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE, BarcodeFormat.Code128, BarcodeFormat.Code39, BarcodeFormat.Itf, BarcodeFormat.QrCode], autoZoom: true });
  return barcodes && barcodes[0] ? barcodes[0].rawValue : null;
}
// Free product database: name, brand, size and a photo for many UK groceries, drinks and snacks.
async function lookup(code) {
  const tries = [code]; if (code.length === 12) tries.push('0' + code);
  for (const c of tries) {
    const r = await CapacitorHttp.get({ url: `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(c)}.json?fields=product_name,product_name_en,brands,quantity,generic_name,generic_name_en,categories,image_front_url`, headers: { 'User-Agent': 'ShopStockManager/1.0 (Android; personal shop app)' } });
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    if (!d || d.status !== 1 || !d.product) continue;
    const p = d.product;
    let image = null;
    if (p.image_front_url) {
      try { const img = await CapacitorHttp.get({ url: p.image_front_url, responseType: 'blob' }); if (img.data) image = 'data:image/jpeg;base64,' + img.data; } catch (e) { /* photo optional */ }
    }
    const brand = (p.brands || '').split(',')[0].trim();
    let name = (p.product_name_en || p.product_name || '').trim();
    if (brand && name && !name.toLowerCase().includes(brand.toLowerCase())) name = brand + ' ' + name;
    if (p.quantity && name && !name.toLowerCase().includes(String(p.quantity).toLowerCase().replace(/\s/g, ''))) name += ' ' + p.quantity;
    return { name, brand, size: p.quantity || '', description: p.generic_name_en || p.generic_name || '', category: '', image };
  }
  return null;
}
window.Native = Capacitor.isNativePlatform() ? { scan, lookup } : { lookup: null };

// Android back button: close the open screen first, then go back, then leave the app.
if (Capacitor.isNativePlatform()) {
  CapApp.addListener('backButton', () => {
    const A = window.App;
    if (A && !document.getElementById('modal').hidden) return A.closeModal();
    if (A && !document.getElementById('sheet').hidden) return A.closeSheet();
    if (location.hash && location.hash !== '#scan') { history.back(); return; }
    CapApp.exitApp();
  });
}

// ---------- sign-in screen ----------
const box = () => document.getElementById('view');
const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function loginScreen(msg) {
  document.querySelector('.tabbar').style.display = 'none';
  box().innerHTML = `<div class="setup card">
    <h1>Shop Stock</h1>
    <p class="muted">Sign in to your shop. The first account created becomes the owner.</p>
    ${msg ? `<div class="notice bad">${escH(msg)}</div>` : ''}
    <form id="lgForm" class="stack">
      <label for="lgEmail">Email<input id="lgEmail" type="email" autocomplete="email" required></label>
      <label for="lgPass">Password<input id="lgPass" type="password" autocomplete="current-password" minlength="6" required></label>
      <label for="lgName" id="lgNameL" hidden>Your name<input id="lgName" autocomplete="name"></label>
      <button class="primary big" id="lgGo" type="submit">Sign in</button>
    </form>
    <div class="row between"><button class="ghost" id="lgNew">Create an account</button><button class="ghost" id="lgForgot">Forgot password</button></div>
  </div>`;
  let creating = false;
  const go = document.getElementById('lgGo');
  document.getElementById('lgNew').onclick = () => { creating = !creating; document.getElementById('lgNameL').hidden = !creating; go.textContent = creating ? 'Create account' : 'Sign in'; document.getElementById('lgNew').textContent = creating ? 'I already have an account' : 'Create an account'; };
  document.getElementById('lgForgot').onclick = async () => {
    const em = document.getElementById('lgEmail').value.trim(); if (!em) return loginScreen('Type your email first, then press Forgot password.');
    try { await sendPasswordResetEmail(auth, em); loginScreen('Password reset email sent to ' + em + '.'); } catch (e) { loginScreen(niceAuth(e)); }
  };
  document.getElementById('lgForm').onsubmit = async (e) => {
    e.preventDefault(); go.disabled = true; go.textContent = 'Please wait…';
    const em = document.getElementById('lgEmail').value.trim(), pw = document.getElementById('lgPass').value;
    try {
      if (creating) { const c = await createUserWithEmailAndPassword(auth, em, pw); const nm = document.getElementById('lgName').value.trim() || em.split('@')[0]; await updateProfile(c.user, { displayName: nm }); await setDoc(fdoc(fs, 'users/' + c.user.uid), { name: nm }); }
      else await signInWithEmailAndPassword(auth, em, pw);
    } catch (ex) { loginScreen(niceAuth(ex)); }
  };
}
function niceAuth(e) {
  const c = e?.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Email or password is wrong.';
  if (c.includes('email-already-in-use')) return 'That email already has an account. Sign in instead.';
  if (c.includes('weak-password')) return 'Use a password of at least 6 characters.';
  if (c.includes('network')) return 'No internet connection. Connect and try again.';
  return e?.message || 'Something went wrong.';
}
window.Platform = { signOut: () => signOut(auth) };

window.PLATFORM_WAIT = new Promise((resolve) => {
  if (!configured) {
    setTimeout(() => { box().innerHTML = '<div class="setup card"><h1>Almost there</h1><p>This copy of the app hasn\'t been connected to your Firebase project yet.</p></div>'; }, 0);
    return;
  }
  let started = false;
  onAuthStateChanged(auth, async (u) => {
    if (!u) { if (started) location.reload(); else loginScreen(); return; }
    me = u;
    try { const s = await getDoc(fdoc(fs, 'config/shop')); configExists = s.exists(); ownerId = configExists ? s.data().owner : null; } catch (e) { configExists = false; }
    names.set(u.uid, u.displayName || '');
    if (!started) { started = true; document.querySelector('.tabbar').style.display = ''; resolve(); }
  });
});
