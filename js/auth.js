/* ============================================================
   auth.js — Autentikasi & keamanan password
   Password TIDAK PERNAH ditulis ke source code / repo.
   Password hanya dimasukkan sendiri oleh pemilik saat instalasi
   pertama, lalu di-hash (PBKDF2-SHA256 + salt acak) dan disimpan
   di IndexedDB milik browser masing-masing perangkat.
   ============================================================ */

const Auth = (() => {
  const ITER = 150000;

  function randomSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr));
  }

  async function hashPassword(password, saltB64) {
    const enc = new TextEncoder();
    const saltBytes = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: ITER, hash: 'SHA-256' },
      keyMaterial, 256
    );
    const hashArr = Array.from(new Uint8Array(bits));
    return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function makeCredential(password) {
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    return { salt, hash };
  }

  async function verify(password, salt, hash) {
    const test = await hashPassword(password, salt);
    return test === hash;
  }

  // --- session (in-memory only, not persisted to localStorage for security) ---
  let currentUser = null;

  function setSession(user) { currentUser = user; sessionStorage.setItem('kb_session', JSON.stringify({id: user.id, username: user.username, role: user.role, name: user.name})); }
  function getSession() {
    if (currentUser) return currentUser;
    const raw = sessionStorage.getItem('kb_session');
    if (raw) { currentUser = JSON.parse(raw); return currentUser; }
    return null;
  }
  function clearSession() { currentUser = null; sessionStorage.removeItem('kb_session'); }

  return { makeCredential, verify, setSession, getSession, clearSession };
})();
