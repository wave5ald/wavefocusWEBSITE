/* ==========================================================================
   Optional cloud sync — Google sign-in + Firestore mirror.

   Local data stays authoritative: every change is saved to localStorage
   first, then pushed to `users/{uid}/apps/wavefocus` after a short pause.
   On sign-in the newest copy wins (cloud `updatedAt` vs local `updatedAt`).
   ========================================================================== */

import { importJSON, saveNow, state, subscribe } from './store.js';
import { configured, firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/11.6.1/';
const COLLECTION = 'apps';
const DOC_ID = 'wavefocus';
const LAST_KEY = 'wavefocus.sync.last';

let fb = null;
let user = null;
let status = configured ? 'signed-out' : 'unconfigured';
let lastError = '';
let lastSync = Number(localStorage.getItem(LAST_KEY)) || 0;
let pushTimer = null;
let applying = false;
let started = false;
const listeners = new Set();

function snapshot() {
  return {
    configured,
    status,
    lastSync,
    lastError,
    user: user ? { uid: user.uid, email: user.email || '', name: user.displayName || '' } : null,
  };
}

function emit() {
  const value = snapshot();
  listeners.forEach((fn) => {
    try { fn(value); } catch (err) { console.error(err); }
  });
}

export function onSync(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getSync = snapshot;

async function load() {
  if (fb) return fb;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${SDK}firebase-app.js`),
    import(`${SDK}firebase-auth.js`),
    import(`${SDK}firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  fb = { auth: authMod.getAuth(app), db: fsMod.getFirestore(app), authMod, fsMod };
  return fb;
}

function docRef() {
  return fb.fsMod.doc(fb.db, 'users', user.uid, COLLECTION, DOC_ID);
}

function markSynced() {
  lastSync = Date.now();
  lastError = '';
  try { localStorage.setItem(LAST_KEY, String(lastSync)); } catch { /* private mode */ }
}

function fail(err) {
  lastError = String(err?.code || err?.message || err || 'unknown');
  status = 'error';
  emit();
}

async function push({ quiet = false } = {}) {
  if (!user || !fb) return 'idle';
  status = 'syncing';
  emit();
  try {
    await fb.fsMod.setDoc(docRef(), {
      updatedAt: Number(state.updatedAt) || Date.now(),
      state: JSON.parse(JSON.stringify(state)),
      device: navigator.userAgent,
    });
    markSynced();
    status = 'synced';
    if (!quiet) emit();
    return 'pushed';
  } catch (err) {
    fail(err);
    return 'error';
  }
}

async function reconcile() {
  if (!user || !fb) return 'idle';
  status = 'syncing';
  emit();
  try {
    const snap = await fb.fsMod.getDoc(docRef());
    const cloud = snap.exists() ? snap.data() : null;
    const localAt = Number(state.updatedAt) || 0;

    if (cloud && cloud.state && Number(cloud.updatedAt) > localAt) {
      applying = true;
      importJSON(JSON.stringify({ app: 'wavefocus', schema: 2, data: cloud.state }));
      saveNow();
      applying = false;
      markSynced();
      status = 'synced';
      emit();
      window.dispatchEvent(new CustomEvent('wavefocus:sync-restored'));
      return 'pulled';
    }

    return await push({ quiet: true });
  } catch (err) {
    fail(err);
    return 'error';
  }
}

export async function initSync() {
  if (!configured || started) { emit(); return; }
  if (!navigator.onLine) {
    status = 'offline';
    emit();
    return;
  }
  started = true;

  try {
    const { auth, authMod } = await load();

    subscribe(() => {
      if (applying || !user) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => { push(); }, 1200);
    });

    authMod.onAuthStateChanged(auth, (next) => {
      user = next;
      if (!next) {
        status = 'signed-out';
        emit();
        return;
      }
      status = 'syncing';
      emit();
      reconcile();
    });

    authMod.getRedirectResult(auth).catch(fail);
  } catch (err) {
    fail(err);
  }
}

export async function signIn() {
  if (!configured) return;
  try {
    const { auth, authMod } = await load();
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    status = 'signing-in';
    emit();
    await authMod.signInWithRedirect(auth, provider);
  } catch (err) {
    fail(err);
  }
}

export async function signOut() {
  if (!fb) return;
  try {
    await fb.authMod.signOut(fb.auth);
    user = null;
    status = 'signed-out';
    emit();
  } catch (err) {
    fail(err);
  }
}

export async function syncNow() {
  if (!user) return 'idle';
  return reconcile();
}
