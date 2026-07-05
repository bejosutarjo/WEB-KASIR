/* ============================================================
   db.js — Lapisan penyimpanan lokal (IndexedDB)
   Semua data tersimpan HANYA di perangkat/browser masing-masing.
   Tidak ada data yang dikirim ke server manapun.
   ============================================================ */

const DB_NAME = 'kasir_bejo_db';
const DB_VERSION = 1;

const STORES = {
  settings: 'settings',       // key-value: profil toko, config
  users: 'users',             // akun kasir + owner
  products: 'products',       // daftar produk
  stockLogs: 'stockLogs',     // riwayat perubahan stok
  transactions: 'transactions'// riwayat transaksi/penjualan
};

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.users)) {
        const s = db.createObjectStore(STORES.users, { keyPath: 'id', autoIncrement: true });
        s.createIndex('username', 'username', { unique: true });
      }
      if (!db.objectStoreNames.contains(STORES.products)) {
        const s = db.createObjectStore(STORES.products, { keyPath: 'id', autoIncrement: true });
        s.createIndex('barcode', 'barcode', { unique: false });
        s.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.stockLogs)) {
        const s = db.createObjectStore(STORES.stockLogs, { keyPath: 'id', autoIncrement: true });
        s.createIndex('productId', 'productId', { unique: false });
        s.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.transactions)) {
        const s = db.createObjectStore(STORES.transactions, { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date', { unique: false });
        s.createIndex('cashierId', 'cashierId', { unique: false });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return _dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

const DB = {
  // ---- generic helpers ----
  async add(store, value) {
    const s = await tx(store, 'readwrite');
    return new Promise((res, rej) => {
      const r = s.add(value);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async put(store, value) {
    const s = await tx(store, 'readwrite');
    return new Promise((res, rej) => {
      const r = s.put(value);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async get(store, key) {
    const s = await tx(store);
    return new Promise((res, rej) => {
      const r = s.get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async delete(store, key) {
    const s = await tx(store, 'readwrite');
    return new Promise((res, rej) => {
      const r = s.delete(key);
      r.onsuccess = () => res(true);
      r.onerror = () => rej(r.error);
    });
  },
  async getAll(store) {
    const s = await tx(store);
    return new Promise((res, rej) => {
      const r = s.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async getByIndex(store, indexName, value) {
    const s = await tx(store);
    return new Promise((res, rej) => {
      const r = s.index(indexName).getAll(value);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async clearStore(store) {
    const s = await tx(store, 'readwrite');
    return new Promise((res, rej) => {
      const r = s.clear();
      r.onsuccess = () => res(true);
      r.onerror = () => rej(r.error);
    });
  },

  // ---- settings shortcuts ----
  async getSetting(key, fallback = null) {
    const row = await DB.get(STORES.settings, key);
    return row ? row.value : fallback;
  },
  async setSetting(key, value) {
    return DB.put(STORES.settings, { key, value });
  },

  STORES
};
