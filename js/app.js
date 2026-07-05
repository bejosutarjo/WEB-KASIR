/* ============================================================
   app.js — Logika utama Kasir BEJO
   ============================================================ */

const DEFAULT_QRIS_STATIC = "00020101021126610014COM.GO-JEK.WWW01189360091438800139540210G8800139540303UMI51440014ID.CO.QRIS.WWW0215ID10264928258920303UMI5204899953033605802ID5925WARUNG WEB3, Digital & Kr6009PRINGSEWU61053537662070703A0163046BA4";

const S = { STORES: DB.STORES };

let state = {
  session: null,
  settings: null,
  view: 'dashboard',
  cart: [],          // {productId,name,price,buyPrice,qty,stock,unit}
  scanner: null,     // instance Html5Qrcode aktif
  products: [],       // cache produk untuk POS
};

/* ---------------- util ---------------- */
function rupiah(n){
  n = Math.round(Number(n)||0);
  return 'Rp' + n.toLocaleString('id-ID');
}
function fmtDate(d){
  const dt = new Date(d);
  return dt.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) + ' ' +
         dt.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
}
function todayKey(d = new Date()){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function toast(msg, type=''){
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' '+type : '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(()=> el.remove(), 3200);
}
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function uid(){ return Math.random().toString(36).slice(2,9); }

function openModal(innerHTML, opts={}){
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay" id="modal-overlay"><div class="modal-box ${opts.wide?'modal-wide':''}">${innerHTML}</div></div>`;
  document.getElementById('modal-overlay').addEventListener('mousedown', (e)=>{
    if(e.target.id === 'modal-overlay' && opts.closable !== false) closeModal();
  });
  if(opts.onMount) opts.onMount();
}
function closeModal(){
  const scannerEl = document.getElementById('barcode-reader');
  if(state.scanner){
    try{ state.scanner.stop().then(()=>state.scanner.clear()).catch(()=>{}); }catch(e){}
    state.scanner = null;
  }
  document.getElementById('modal-root').innerHTML = '';
}

/* ================= INIT ================= */
window.addEventListener('DOMContentLoaded', init);

async function init(){
  registerSW();
  const owners = await DB.getByIndex(S.STORES.users, 'username', null).catch(()=>[]);
  const allUsers = await DB.getAll(S.STORES.users);
  const hasOwner = allUsers.some(u => u.role === 'owner');

  state.settings = await loadSettings();

  if(!hasOwner){
    showView('view-setup');
  } else {
    const session = Auth.getSession();
    document.getElementById('login-store-name').textContent = state.settings.storeName || 'Kasir BEJO';
    if(session){
      state.session = session;
      await enterApp();
    } else {
      showView('view-login');
    }
  }

  bindStaticEvents();
}

async function loadSettings(){
  const all = {};
  const rows = await DB.getAll(S.STORES.settings);
  rows.forEach(r => all[r.key] = r.value);
  return {
    storeName: all.storeName || 'Warung Bejo',
    qrisStatic: all.qrisStatic || DEFAULT_QRIS_STATIC,
    cashierLoginMode: all.cashierLoginMode || 'password', // 'password' | 'pin'
    address: all.address || '',
  };
}
async function saveSettingsPatch(patch){
  for(const k in patch){
    await DB.setSetting(k, patch[k]);
  }
  state.settings = await loadSettings();
}

function showView(id){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function registerSW(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
}

/* ================= SETUP (owner pertama kali) ================= */
document.addEventListener('submit', async (e) => {
  if(e.target.id === 'form-setup'){
    e.preventDefault();
    const storeName = document.getElementById('setup-store-name').value.trim();
    const ownerName = document.getElementById('setup-owner-name').value.trim();
    const username = document.getElementById('setup-username').value.trim().toLowerCase();
    const pw1 = document.getElementById('setup-password').value;
    const pw2 = document.getElementById('setup-password2').value;
    if(pw1 !== pw2){ toast('Password tidak sama','error'); return; }
    if(pw1.length < 6){ toast('Password minimal 6 karakter','error'); return; }

    const cred = await Auth.makeCredential(pw1);
const user = {
    username,
    name: ownerName,
    role: 'owner',
    active: true,
    loginMode: 'password',
    ...cred,
    createdAt: new Date().toISOString()
};

const id = await DB.add(S.STORES.users, user);

await saveSettingsPatch({
    storeName,
    qrisStatic: DEFAULT_QRIS_STATIC,
    cashierLoginMode: 'password'
});

const created = await DB.get(S.STORES.users, id);

if (!created) {
    toast('Gagal membuat akun pemilik', 'error');
    return;
}

toast('Akun pemilik berhasil dibuat!');

Auth.setSession(created);
state.session = created;

await enterApp();
  }
});

/* ================= LOGIN ================= */
function bindStaticEvents(){
  document.getElementById('role-switch').addEventListener('click', (e)=>{
    const btn = e.target.closest('.role-btn');
    if(!btn) return;
    document.querySelectorAll('.role-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    updateLoginFieldsForRole(btn.dataset.role);
  });

  document.getElementById('form-login').addEventListener('submit', onLoginSubmit);
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('btn-mt-logout').addEventListener('click', doLogout);
  document.getElementById('btn-open-menu').addEventListener('click', ()=>{
    document.getElementById('sidebar').classList.add('mobile-open');
    const bd = document.createElement('div');
    bd.className='sidebar-backdrop'; bd.id='sidebar-backdrop';
    bd.onclick = ()=>{ document.getElementById('sidebar').classList.remove('mobile-open'); bd.remove(); };
    document.body.appendChild(bd);
  });
}

function updateLoginFieldsForRole(role){
  const usernameWrap = document.getElementById('login-username-wrap');
  const pwLabel = document.getElementById('login-password-label');
  const pwInput = document.getElementById('login-password');
  usernameWrap.style.display = '';
  if(role === 'kasir' && state.settings.cashierLoginMode === 'pin'){
    pwLabel.childNodes[0].textContent = 'PIN';
    pwInput.setAttribute('inputmode','numeric');
    pwInput.setAttribute('placeholder','Masukkan PIN');
  } else {
    pwLabel.childNodes[0].textContent = 'Password';
    pwInput.setAttribute('placeholder','Password');
  }
}

async function onLoginSubmit(e){
  e.preventDefault();
  const role = document.querySelector('.role-btn.active').dataset.role;
  const username = document.getElementById('login-username').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  const matches = await DB.getByIndex(S.STORES.users, 'username', username);
  const user = matches.find(u => u.role === role);
  if(!user || user.active === false){
    errorEl.textContent = 'Username tidak ditemukan atau akun dinonaktifkan.';
    return;
  }
  const ok = await Auth.verify(password, user.salt, user.hash);
  if(!ok){
    errorEl.textContent = role === 'owner' ? 'Password salah.' : 'Password/PIN salah.';
    return;
  }
  Auth.setSession(user);
  state.session = Auth.getSession();
  document.getElementById('form-login').reset();
  await enterApp();
}

function doLogout(){
  Auth.clearSession();
  state.session = null;
  state.cart = [];
  document.getElementById('sidebar-backdrop')?.remove();
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('login-store-name').textContent = state.settings.storeName;
  showView('view-login');
}

/* ================= ENTER APP / NAV ================= */
async function enterApp(){
  document.getElementById('sb-store-name').textContent = state.settings.storeName;
  document.getElementById('sb-user-name').textContent = `${state.session.name} · ${state.session.role === 'owner' ? 'Pemilik' : 'Kasir'}`;
  buildSidebarNav();
  showView('view-app');
  navigate(state.session.role === 'owner' ? 'dashboard' : 'pos');
}

function navItemsForRole(role){
  if(role === 'owner'){
    return [
      {id:'dashboard', label:'Dashboard', ic:'📊'},
      {id:'pos', label:'Kasir (POS)', ic:'🛒'},
      {id:'produk', label:'Produk', ic:'📦'},
      {id:'stok', label:'Stok', ic:'📈'},
      {id:'omset', label:'Omset', ic:'💰'},
      {id:'riwayat', label:'Riwayat Transaksi', ic:'🧾'},
      {id:'akunkasir', label:'Akun Kasir', ic:'👥'},
      {id:'pengaturan', label:'Pengaturan', ic:'⚙️'},
    ];
  }
  return [
    {id:'pos', label:'Kasir (POS)', ic:'🛒'},
    {id:'riwayat', label:'Riwayat Saya', ic:'🧾'},
  ];
}

function buildSidebarNav(){
  const nav = document.getElementById('sidebar-nav');
  const items = navItemsForRole(state.session.role);
  nav.innerHTML = items.map(it => `<button class="nav-item" data-view="${it.id}"><span class="ic">${it.ic}</span>${esc(it.label)}</button>`).join('');
  nav.querySelectorAll('.nav-item').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      navigate(btn.dataset.view);
      document.getElementById('sidebar-backdrop')?.remove();
      document.getElementById('sidebar').classList.remove('mobile-open');
    });
  });
}

const RENDERERS = {
  dashboard: renderDashboard,
  pos: renderPOS,
  produk: renderProduk,
  stok: renderStok,
  omset: renderOmset,
  riwayat: renderRiwayat,
  akunkasir: renderAkunKasir,
  pengaturan: renderPengaturan,
};

async function navigate(viewId){
  const allowed = navItemsForRole(state.session.role).map(i=>i.id);
  if(!allowed.includes(viewId)) viewId = allowed[0];
  state.view = viewId;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === viewId));
  document.getElementById('mt-title').textContent = navItemsForRole(state.session.role).find(i=>i.id===viewId)?.label || 'Kasir BEJO';
  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="empty-state">Memuat…</div>';
  await RENDERERS[viewId]();
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function renderDashboard(){
  const trx = await DB.getAll(S.STORES.transactions);
  const today = todayKey();
  const todayTrx = trx.filter(t => todayKey(new Date(t.date)) === today);
  const omsetHarian = todayTrx.reduce((a,t)=>a+t.total,0);
  const bersihHarian = todayTrx.reduce((a,t)=>a+t.profit,0);
  const jumlahTrxHarian = todayTrx.length;

  const products = await DB.getAll(S.STORES.products);
  const stokMenipis = products.filter(p => p.stock <= (p.minStock ?? 5)).length;

  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-head">
      <div><h2>Dashboard</h2><p>Ringkasan performa toko hari ini · ${new Date().toLocaleDateString('id-ID',{weekday:'long', day:'numeric', month:'long', year:'numeric'})}</p></div>
    </div>
    <div class="grid grid-stats">
      <div class="stat-ticket"><div class="st-label">Omset Hari Ini</div><div class="st-value">${rupiah(omsetHarian)}</div><div class="st-sub">${jumlahTrxHarian} transaksi</div></div>
      <div class="stat-ticket accent-gold"><div class="st-label">Omset Bersih Hari Ini</div><div class="st-value">${rupiah(bersihHarian)}</div><div class="st-sub">Setelah dikurangi modal produk</div></div>
      <div class="stat-ticket accent-amber"><div class="st-label">Total Produk</div><div class="st-value">${products.length}</div><div class="st-sub">${stokMenipis} stok menipis</div></div>
      <div class="stat-ticket"><div class="st-label">Total Transaksi</div><div class="st-value">${trx.length}</div><div class="st-sub">Sepanjang waktu</div></div>
    </div>
    <div class="card mt-2">
      <div class="card-head"><h3>Transaksi Terbaru</h3><button class="btn btn-outline btn-sm" onclick="navigate('riwayat')">Lihat Semua</button></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Waktu</th><th>Kasir</th><th>Item</th><th>Bayar</th><th class="text-right">Total</th></tr></thead>
          <tbody>
            ${trx.slice(-6).reverse().map(t=>`
              <tr>
                <td>${fmtDate(t.date)}</td>
                <td>${esc(t.cashierName)}</td>
                <td>${t.items.length} produk</td>
                <td><span class="badge ${t.paymentMethod==='qris'?'badge-ok':'badge-warn'}">${t.paymentMethod==='qris'?'QRIS':'Tunai'}</span></td>
                <td class="text-right">${rupiah(t.total)}</td>
              </tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--ink-400)">Belum ada transaksi</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ============================================================
   PRODUK
   ============================================================ */
async function renderProduk(){
  const products = (await DB.getAll(S.STORES.products)).sort((a,b)=>a.name.localeCompare(b.name));
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-head">
      <div><h2>Produk</h2><p>Kelola daftar produk, harga, dan barcode</p></div>
      <button class="btn btn-primary" onclick="openProductForm()">＋ Tambah Produk</button>
    </div>
    <div class="card">
      <input type="text" id="produk-search" placeholder="Cari nama atau barcode…" style="width:100%;border:1.5px solid var(--line);border-radius:8px;padding:11px 14px;margin-bottom:14px;background:var(--cream-50)">
      <div class="table-wrap">
        <table id="produk-table">
          <thead><tr><th>Produk</th><th>Barcode</th><th>Harga Beli</th><th>Harga Jual</th><th>Stok</th><th></th></tr></thead>
          <tbody>${productRows(products)}</tbody>
        </table>
      </div>
      ${products.length===0 ? `<div class="empty-state"><div class="es-emoji">📦</div>Belum ada produk. Klik "Tambah Produk" untuk mulai.</div>` : ''}
    </div>
  `;
  document.getElementById('produk-search').addEventListener('input', (e)=>{
    const q = e.target.value.toLowerCase();
    const filtered = products.filter(p => p.name.toLowerCase().includes(q) || (p.barcode||'').includes(q));
    document.querySelector('#produk-table tbody').innerHTML = productRows(filtered);
  });
}
function productRows(products){
  return products.map(p => `
    <tr>
      <td><strong>${esc(p.name)}</strong><br><span style="color:var(--ink-400);font-size:12px">${esc(p.category||'-')}</span></td>
      <td>${esc(p.barcode || '-')}</td>
      <td>${rupiah(p.buyPrice)}</td>
      <td>${rupiah(p.sellPrice)}</td>
      <td>${p.stock} ${esc(p.unit||'')} ${p.stock<=(p.minStock??5)?'<span class="badge badge-danger">Menipis</span>':''}</td>
      <td><button class="btn btn-outline btn-sm" onclick="openProductForm(${p.id})">Edit</button> <button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.id})">Hapus</button></td>
    </tr>
  `).join('') || '';
}

function openProductForm(id){
  (async ()=>{
    const p = id ? await DB.get(S.STORES.products, id) : null;
    openModal(`
      <div class="modal-head"><h3>${p?'Edit':'Tambah'} Produk</h3><button class="icon-btn" style="color:var(--ink-400)" onclick="closeModal()">✕</button></div>
      <form id="form-product">
        <div class="modal-body">
          <div class="form-grid">
            <div class="field"><label>Nama Produk</label><input required id="pf-name" value="${p?esc(p.name):''}"></div>
            <div class="field"><label>Kategori</label><input id="pf-category" value="${p?esc(p.category||''):''}" placeholder="Sembako, Minuman, dll"></div>
            <div class="field">
              <label>Barcode</label>
              <div class="field-row">
                <input id="pf-barcode" value="${p?esc(p.barcode||''):''}" placeholder="Scan atau ketik manual">
                <button type="button" class="btn btn-outline btn-sm" onclick="scanIntoField('pf-barcode')">📷 Scan</button>
              </div>
            </div>
            <div class="field"><label>Satuan</label><input id="pf-unit" value="${p?esc(p.unit||'pcs'):'pcs'}" placeholder="pcs / kg / botol"></div>
            <div class="field"><label>Harga Beli (Modal)</label><input required type="number" min="0" id="pf-buy" value="${p?p.buyPrice:''}"></div>
            <div class="field"><label>Harga Jual</label><input required type="number" min="0" id="pf-sell" value="${p?p.sellPrice:''}"></div>
            <div class="field"><label>Stok Awal/Saat Ini</label><input required type="number" min="0" id="pf-stock" value="${p?p.stock:0}" ${p?'disabled title="Ubah stok lewat menu Stok"':''}></div>
            <div class="field"><label>Stok Minimum (Peringatan)</label><input type="number" min="0" id="pf-minstock" value="${p?p.minStock??5:5}"></div>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button>
          <button type="submit" class="btn btn-primary btn-block">${p?'Simpan Perubahan':'Tambah Produk'}</button>
        </div>
      </form>
    `);
    document.getElementById('form-product').addEventListener('submit', async (e)=>{
      e.preventDefault();
      const data = {
        name: document.getElementById('pf-name').value.trim(),
        category: document.getElementById('pf-category').value.trim(),
        barcode: document.getElementById('pf-barcode').value.trim(),
        unit: document.getElementById('pf-unit').value.trim() || 'pcs',
        buyPrice: Number(document.getElementById('pf-buy').value),
        sellPrice: Number(document.getElementById('pf-sell').value),
        minStock: Number(document.getElementById('pf-minstock').value) || 5,
      };
      if(p){
        await DB.put(S.STORES.products, {...p, ...data});
        toast('Produk diperbarui');
      } else {
        data.stock = Number(document.getElementById('pf-stock').value) || 0;
        data.createdAt = new Date().toISOString();
        const newId = await DB.add(S.STORES.products, data);
        if(data.stock > 0){
          await DB.add(S.STORES.stockLogs, {productId:newId, type:'in', change:data.stock, previousStock:0, newStock:data.stock, note:'Stok awal', date:new Date().toISOString(), user: state.session.name});
        }
        toast('Produk ditambahkan');
      }
      closeModal();
      renderProduk();
    });
  })();
}
async function deleteProduct(id){
  if(!confirm('Hapus produk ini? Riwayat transaksi lama tidak akan terhapus.')) return;
  await DB.delete(S.STORES.products, id);
  toast('Produk dihapus');
  renderProduk();
}

function scanIntoField(fieldId){
  openModal(`
    <div class="modal-head"><h3>Scan Barcode</h3><button class="icon-btn" style="color:var(--ink-400)" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div id="barcode-reader"></div>
      <p style="text-align:center;color:var(--ink-400);font-size:13px;margin-top:10px">Arahkan kamera ke barcode/QR produk</p>
    </div>
  `, {onMount: ()=> startScanner((text)=>{
      const field = document.getElementById(fieldId);
      if(field){ field.value = text; }
      closeModal();
      toast('Barcode terbaca: '+text);
    })});
}

function startScanner(onResult){
  if(typeof Html5Qrcode === 'undefined'){
    toast('Pemindai butuh koneksi internet saat pertama kali dipakai.', 'error');
    return;
  }
  const scanner = new Html5Qrcode('barcode-reader');
  state.scanner = scanner;
  scanner.start(
    { facingMode: 'environment' },
    { fps: 12, qrbox: { width: 260, height: 160 } },
    (decodedText) => { onResult(decodedText); },
    () => {}
  ).catch(()=> toast('Tidak bisa mengakses kamera. Cek izin kamera browser.', 'error'));
}

/* ============================================================
   STOK
   ============================================================ */
async function renderStok(){
  const products = (await DB.getAll(S.STORES.products)).sort((a,b)=>a.name.localeCompare(b.name));
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-head"><div><h2>Stok Produk</h2><p>Pantau stok saat ini dan riwayat perubahan stok (stok lama)</p></div></div>
    <div class="role-switch" style="max-width:340px" id="stok-tabs">
      <button class="role-btn active" data-tab="current">Stok Saat Ini</button>
      <button class="role-btn" data-tab="history">Riwayat / Stok Lama</button>
    </div>
    <div id="stok-content"></div>
  `;
  const renderCurrent = ()=>{
    document.getElementById('stok-content').innerHTML = `
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Produk</th><th>Stok</th><th>Min. Stok</th><th>Status</th><th></th></tr></thead>
            <tbody>${products.map(p=>`
              <tr>
                <td><strong>${esc(p.name)}</strong></td>
                <td>${p.stock} ${esc(p.unit||'')}</td>
                <td>${p.minStock ?? 5}</td>
                <td>${p.stock<=(p.minStock??5) ? '<span class="badge badge-danger">Menipis</span>' : '<span class="badge badge-ok">Aman</span>'}</td>
                <td><button class="btn btn-outline btn-sm" onclick="openStockAdjust(${p.id})">± Sesuaikan</button></td>
              </tr>`).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--ink-400)">Belum ada produk</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  };
  const renderHistory = async ()=>{
    const logs = (await DB.getAll(S.STORES.stockLogs)).sort((a,b)=> new Date(b.date)-new Date(a.date));
    const prodMap = {}; products.forEach(p=>prodMap[p.id]=p.name);
    document.getElementById('stok-content').innerHTML = `
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tanggal</th><th>Produk</th><th>Tipe</th><th>Perubahan</th><th>Stok Sebelum → Sesudah</th><th>Catatan</th><th>Oleh</th></tr></thead>
            <tbody>${logs.map(l=>`
              <tr>
                <td>${fmtDate(l.date)}</td>
                <td>${esc(prodMap[l.productId] || '(dihapus)')}</td>
                <td><span class="badge ${l.type==='in'?'badge-ok':(l.type==='out'?'badge-warn':'badge-danger')}">${l.type==='in'?'Masuk':l.type==='out'?'Keluar':'Koreksi'}</span></td>
                <td>${l.change>0?'+':''}${l.change}</td>
                <td>${l.previousStock} → ${l.newStock}</td>
                <td>${esc(l.note||'-')}</td>
                <td>${esc(l.user||'-')}</td>
              </tr>`).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--ink-400)">Belum ada riwayat stok</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  };
  renderCurrent();
  document.getElementById('stok-tabs').addEventListener('click', (e)=>{
    const btn = e.target.closest('.role-btn'); if(!btn) return;
    document.querySelectorAll('#stok-tabs .role-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    btn.dataset.tab === 'current' ? renderCurrent() : renderHistory();
  });
}

function openStockAdjust(productId){
  (async ()=>{
    const p = await DB.get(S.STORES.products, productId);
    openModal(`
      <div class="modal-head"><h3>Sesuaikan Stok — ${esc(p.name)}</h3><button class="icon-btn" style="color:var(--ink-400)" onclick="closeModal()">✕</button></div>
      <form id="form-stock">
        <div class="modal-body">
          <p style="margin-bottom:14px;color:var(--ink-400);font-size:13.5px">Stok saat ini: <strong>${p.stock} ${esc(p.unit||'')}</strong></p>
          <div class="field mb-1"><label>Jenis Penyesuaian</label>
            <select id="sf-type">
              <option value="in">Tambah Stok (barang masuk)</option>
              <option value="out">Kurangi Stok (rusak/hilang)</option>
            </select>
          </div>
          <div class="field mb-1"><label>Jumlah</label><input type="number" min="1" required id="sf-qty" value="1"></div>
          <div class="field"><label>Catatan</label><input id="sf-note" placeholder="Contoh: Kulakan dari agen"></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button>
          <button type="submit" class="btn btn-primary btn-block">Simpan</button>
        </div>
      </form>
    `);
    document.getElementById('form-stock').addEventListener('submit', async (e)=>{
      e.preventDefault();
      const type = document.getElementById('sf-type').value;
      const qty = Number(document.getElementById('sf-qty').value);
      const note = document.getElementById('sf-note').value.trim();
      const change = type === 'in' ? qty : -qty;
      const newStock = Math.max(0, p.stock + change);
      await DB.put(S.STORES.products, {...p, stock:newStock});
      await DB.add(S.STORES.stockLogs, {productId:p.id, type, change, previousStock:p.stock, newStock, note, date:new Date().toISOString(), user:state.session.name});
      toast('Stok diperbarui');
      closeModal();
      renderStok();
    });
  })();
}

/* ============================================================
   OMSET
   ============================================================ */
async function renderOmset(){
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-head"><div><h2>Omset</h2><p>Omset harian (kotor) dan omset bersih (setelah modal)</p></div></div>
    <div class="card">
      <div class="field-row mb-1" style="flex-wrap:wrap">
        <div class="field"><label>Dari Tanggal</label><input type="date" id="om-from"></div>
        <div class="field"><label>Sampai Tanggal</label><input type="date" id="om-to"></div>
        <div class="field" style="justify-content:flex-end"><label>&nbsp;</label><button class="btn btn-secondary" onclick="loadOmset()">Terapkan</button></div>
      </div>
    </div>
    <div id="omset-stats" class="grid grid-stats mt-2"></div>
    <div class="card mt-2">
      <div class="card-head"><h3>Rincian Per Hari</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Tanggal</th><th>Jumlah Transaksi</th><th>Omset Kotor</th><th>Modal</th><th>Omset Bersih</th></tr></thead>
        <tbody id="omset-rows"></tbody>
      </table></div>
    </div>
  `;
  const today = new Date();
  const weekAgo = new Date(); weekAgo.setDate(today.getDate()-6);
  document.getElementById('om-from').value = todayKey(weekAgo);
  document.getElementById('om-to').value = todayKey(today);
  loadOmset();
}
async function loadOmset(){
  const from = document.getElementById('om-from').value;
  const to = document.getElementById('om-to').value;
  const trx = await DB.getAll(S.STORES.transactions);
  const filtered = trx.filter(t=>{
    const k = todayKey(new Date(t.date));
    return k >= from && k <= to;
  });
  const byDay = {};
  filtered.forEach(t=>{
    const k = todayKey(new Date(t.date));
    if(!byDay[k]) byDay[k] = {gross:0, cost:0, count:0};
    byDay[k].gross += t.total;
    byDay[k].cost += (t.total - t.profit);
    byDay[k].count += 1;
  });
  const totalGross = filtered.reduce((a,t)=>a+t.total,0);
  const totalNet = filtered.reduce((a,t)=>a+t.profit,0);
  const totalCost = totalGross - totalNet;

  document.getElementById('omset-stats').innerHTML = `
    <div class="stat-ticket"><div class="st-label">Omset Kotor</div><div class="st-value">${rupiah(totalGross)}</div><div class="st-sub">${filtered.length} transaksi</div></div>
    <div class="stat-ticket accent-gold"><div class="st-label">Omset Bersih (Laba)</div><div class="st-value">${rupiah(totalNet)}</div></div>
    <div class="stat-ticket accent-amber"><div class="st-label">Total Modal Terjual</div><div class="st-value">${rupiah(totalCost)}</div></div>
  `;
  const rows = Object.keys(byDay).sort().reverse().map(k=>`
    <tr><td>${new Date(k).toLocaleDateString('id-ID',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})}</td>
    <td>${byDay[k].count}</td><td>${rupiah(byDay[k].gross)}</td><td>${rupiah(byDay[k].cost)}</td><td><strong>${rupiah(byDay[k].gross-byDay[k].cost)}</strong></td></tr>
  `).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--ink-400)">Tidak ada data pada rentang ini</td></tr>`;
  document.getElementById('omset-rows').innerHTML = rows;
}

/* ============================================================
   RIWAYAT TRANSAKSI
   ============================================================ */
async function renderRiwayat(){
  let trx = (await DB.getAll(S.STORES.transactions)).sort((a,b)=> new Date(b.date)-new Date(a.date));
  if(state.session.role !== 'owner'){
    trx = trx.filter(t => t.cashierId === state.session.id);
  }
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-head"><div><h2>${state.session.role==='owner'?'Riwayat Transaksi':'Riwayat Transaksi Saya'}</h2><p>${trx.length} transaksi tercatat</p></div></div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Waktu</th>${state.session.role==='owner'?'<th>Kasir</th>':''}<th>Item</th><th>Metode</th><th class="text-right">Total</th><th></th></tr></thead>
        <tbody>
          ${trx.map(t=>`
            <tr>
              <td>${fmtDate(t.date)}</td>
              ${state.session.role==='owner'?`<td>${esc(t.cashierName)}</td>`:''}
              <td>${t.items.length} produk</td>
              <td><span class="badge ${t.paymentMethod==='qris'?'badge-ok':'badge-warn'}">${t.paymentMethod==='qris'?'QRIS':'Tunai'}</span></td>
              <td class="text-right">${rupiah(t.total)}</td>
              <td><button class="btn btn-outline btn-sm" onclick="viewReceipt(${t.id})">Lihat/Cetak</button></td>
            </tr>`).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--ink-400)">Belum ada transaksi</td></tr>`}
        </tbody>
      </table></div>
    </div>
  `;
}

async function viewReceipt(trxId){
  const t = await DB.get(S.STORES.transactions, trxId);
  openModal(`
    <div class="modal-head"><h3>Struk Transaksi</h3><button class="icon-btn" style="color:var(--ink-400)" onclick="closeModal()">✕</button></div>
    <div class="modal-body">${receiptHTML(t)}</div>
    <div class="modal-foot"><button class="btn btn-primary btn-block" onclick="printReceipt(${t.id})">🖨️ Cetak Struk</button></div>
  `);
}
function receiptHTML(t){
  return `
    <div class="receipt" id="receipt-${t.id}">
      <div class="r-center r-title">${esc(state.settings.storeName)}</div>
      ${state.settings.address?`<div class="r-center">${esc(state.settings.address)}</div>`:''}
      <div class="r-center">${fmtDate(t.date)}</div>
      <div class="r-center">Kasir: ${esc(t.cashierName)}</div>
      <hr>
      ${t.items.map(it=>`
        <div class="r-row"><span>${esc(it.name)} x${it.qty}</span><span>${rupiah(it.subtotal)}</span></div>
      `).join('')}
      <hr>
      <div class="r-row"><strong>TOTAL</strong><strong>${rupiah(t.total)}</strong></div>
      <div class="r-row"><span>Metode</span><span>${t.paymentMethod==='qris'?'QRIS':'Tunai'}</span></div>
      ${t.paymentMethod==='cash'?`<div class="r-row"><span>Dibayar</span><span>${rupiah(t.paid)}</span></div><div class="r-row"><span>Kembali</span><span>${rupiah(t.change)}</span></div>`:''}
      <hr>
      <div class="r-center">Terima kasih telah berbelanja 🙏</div>
    </div>
  `;
}
function printReceipt(trxId){
  (async ()=>{
    const t = await DB.get(S.STORES.transactions, trxId);
    let printArea = document.getElementById('print-area');
    if(!printArea){ printArea = document.createElement('div'); printArea.id='print-area'; document.body.appendChild(printArea); }
    printArea.innerHTML = receiptHTML(t);
    window.print();
  })();
}

/* ============================================================
   AKUN KASIR (owner only)
   ============================================================ */
async function renderAkunKasir(){
  const users = (await DB.getAll(S.STORES.users)).filter(u=>u.role==='kasir');
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-head">
      <div><h2>Akun Kasir</h2><p>Kelola siapa saja yang boleh mengoperasikan mesin kasir</p></div>
      <button class="btn btn-primary" onclick="openCashierForm()">＋ Tambah Akun Kasir</button>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Nama</th><th>Username</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${users.map(u=>`
            <tr>
              <td>${esc(u.name)}</td>
              <td>${esc(u.username)}</td>
              <td>${u.active!==false?'<span class="badge badge-ok">Aktif</span>':'<span class="badge badge-danger">Nonaktif</span>'}</td>
              <td>
                <button class="btn btn-outline btn-sm" onclick="openCashierForm(${u.id})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="toggleCashier(${u.id}, ${u.active===false})">${u.active!==false?'Nonaktifkan':'Aktifkan'}</button>
              </td>
            </tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:var(--ink-400)">Belum ada akun kasir</td></tr>`}
        </tbody>
      </table></div>
    </div>
  `;
}
function openCashierForm(id){
  (async ()=>{
    const u = id ? await DB.get(S.STORES.users, id) : null;
    const mode = state.settings.cashierLoginMode;
    openModal(`
      <div class="modal-head"><h3>${u?'Edit':'Tambah'} Akun Kasir</h3><button class="icon-btn" style="color:var(--ink-400)" onclick="closeModal()">✕</button></div>
      <form id="form-cashier">
        <div class="modal-body">
          <div class="field mb-1"><label>Nama</label><input required id="cf-name" value="${u?esc(u.name):''}"></div>
          <div class="field mb-1"><label>Username</label><input required id="cf-username" value="${u?esc(u.username):''}" ${u?'':''}></div>
          <div class="field mb-1"><label>${mode==='pin'?'PIN (4-6 digit)':'Password'} ${u?'(kosongkan jika tidak diubah)':''}</label>
            <input type="password" id="cf-password" ${u?'':'required'} inputmode="${mode==='pin'?'numeric':'text'}" minlength="${mode==='pin'?4:6}">
          </div>
          <p style="font-size:12px;color:var(--ink-400)">Mode login kasir saat ini: <strong>${mode==='pin'?'PIN':'Username & Password'}</strong>. Ubah di menu Pengaturan.</p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Batal</button>
          <button type="submit" class="btn btn-primary btn-block">${u?'Simpan':'Tambah'}</button>
        </div>
      </form>
    `);
    document.getElementById('form-cashier').addEventListener('submit', async (e)=>{
      e.preventDefault();
      const name = document.getElementById('cf-name').value.trim();
      const username = document.getElementById('cf-username').value.trim().toLowerCase();
      const password = document.getElementById('cf-password').value;

      const existing = await DB.getByIndex(S.STORES.users,'username',username);
      const conflict = existing.find(x => x.id !== (u?.id));
      if(conflict){ toast('Username sudah dipakai','error'); return; }

      if(u){
        const patch = {...u, name, username};
        if(password) Object.assign(patch, await Auth.makeCredential(password));
        await DB.put(S.STORES.users, patch);
        toast('Akun kasir diperbarui');
      } else {
        const cred = await Auth.makeCredential(password);
        await DB.add(S.STORES.users, {username, name, role:'kasir', active:true, loginMode:mode, ...cred, createdAt:new Date().toISOString()});
        toast('Akun kasir ditambahkan');
      }
      closeModal();
      renderAkunKasir();
    });
  })();
}
async function toggleCashier(id, activate){
  const u = await DB.get(S.STORES.users, id);
  await DB.put(S.STORES.users, {...u, active: activate});
  toast(activate ? 'Akun diaktifkan' : 'Akun dinonaktifkan');
  renderAkunKasir();
}

/* ============================================================
   PENGATURAN (owner only)
   ============================================================ */
async function renderPengaturan(){
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="page-head"><div><h2>Pengaturan</h2><p>Profil toko, mode login kasir, QRIS, dan keamanan akun</p></div></div>

    <div class="card">
      <div class="card-head"><h3>Profil Toko</h3></div>
      <form id="form-store">
        <div class="form-grid mb-1">
          <div class="field"><label>Nama Toko</label><input id="st-name" value="${esc(state.settings.storeName)}" required></div>
          <div class="field"><label>Alamat (opsional, tampil di struk)</label><input id="st-address" value="${esc(state.settings.address)}"></div>
        </div>
        <button class="btn btn-secondary" type="submit">Simpan Profil</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head"><h3>Mode Login Akun Kasir</h3></div>
      <p style="color:var(--ink-400);font-size:13.5px;margin-bottom:12px">Pilih cara kasir masuk ke aplikasi. Berlaku untuk akun kasir yang dibuat/diubah setelah ini.</p>
      <div class="role-switch" style="max-width:360px" id="mode-switch">
        <button class="role-btn ${state.settings.cashierLoginMode==='password'?'active':''}" data-mode="password">Username & Password</button>
        <button class="role-btn ${state.settings.cashierLoginMode==='pin'?'active':''}" data-mode="pin">PIN Angka</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Pembayaran QRIS</h3></div>
      <p style="color:var(--ink-400);font-size:13.5px;margin-bottom:12px">Tempel string QRIS statis milik toko Anda. Sistem akan otomatis membuat QRIS dinamis sesuai nominal setiap transaksi.</p>
      <form id="form-qris">
        <div class="field mb-1"><label>String QRIS Statis</label><textarea id="st-qris" rows="4" style="font-family:monospace;font-size:12px" required>${esc(state.settings.qrisStatic)}</textarea></div>
        <button class="btn btn-secondary" type="submit">Simpan QRIS</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head"><h3>Ubah Password Pemilik</h3></div>
      <p class="hint-security mb-1">🔒 Password hanya tersimpan di perangkat ini dalam bentuk terenkripsi (hash), tidak pernah tersimpan sebagai teks biasa maupun ditulis di kode program.</p>
      <form id="form-pw">
        <div class="form-grid mb-1">
          <div class="field"><label>Password Baru</label><input type="password" id="pw-new" minlength="6" required></div>
          <div class="field"><label>Ulangi Password Baru</label><input type="password" id="pw-confirm" minlength="6" required></div>
        </div>
        <button class="btn btn-danger" type="submit">Ubah Password</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head"><h3>Cadangkan / Pulihkan Data</h3></div>
      <p style="color:var(--ink-400);font-size:13.5px;margin-bottom:12px">Semua data tersimpan lokal di perangkat ini. Unduh cadangan secara berkala agar data tidak hilang.</p>
      <button class="btn btn-outline" onclick="exportBackup()">⬇️ Unduh Cadangan (.json)</button>
    </div>
  `;

  document.getElementById('form-store').addEventListener('submit', async (e)=>{
    e.preventDefault();
    await saveSettingsPatch({ storeName: document.getElementById('st-name').value.trim(), address: document.getElementById('st-address').value.trim() });
    document.getElementById('sb-store-name').textContent = state.settings.storeName;
    toast('Profil toko disimpan');
  });

  document.getElementById('mode-switch').addEventListener('click', async (e)=>{
    const btn = e.target.closest('.role-btn'); if(!btn) return;
    document.querySelectorAll('#mode-switch .role-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    await saveSettingsPatch({ cashierLoginMode: btn.dataset.mode });
    toast('Mode login kasir diperbarui');
  });

  document.getElementById('form-qris').addEventListener('submit', async (e)=>{
    e.preventDefault();
    await saveSettingsPatch({ qrisStatic: document.getElementById('st-qris').value.trim() });
    toast('QRIS disimpan');
  });

  document.getElementById('form-pw').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const p1 = document.getElementById('pw-new').value, p2 = document.getElementById('pw-confirm').value;
    if(p1 !== p2){ toast('Password tidak sama','error'); return; }
    const cred = await Auth.makeCredential(p1);
    const owner = await DB.get(S.STORES.users, state.session.id);
    await DB.put(S.STORES.users, {...owner, ...cred});
    toast('Password berhasil diubah');
    e.target.reset();
  });
}

async function exportBackup(){
  const dump = {};
  for(const key of Object.values(S.STORES)){
    dump[key] = await DB.getAll(key);
  }
  const blob = new Blob([JSON.stringify(dump,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `backup-kasir-bejo-${todayKey()}.json`;
  a.click();
}

/* ============================================================
   POS (Kasir)
   ============================================================ */
async function renderPOS(){
  state.products = (await DB.getAll(S.STORES.products)).sort((a,b)=>a.name.localeCompare(b.name));
  state.cart = [];
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="pos-layout">
      <div>
        <div class="pos-search">
          <input type="text" id="pos-search" placeholder="Cari produk…">
          <button class="btn btn-secondary" onclick="scanForPOS()">📷 Scan</button>
        </div>
        <div class="product-grid" id="pos-grid"></div>
      </div>
      <div class="cart-panel">
        <div class="cart-head"><h3>Keranjang</h3><button class="btn btn-ghost btn-sm" onclick="clearCart()">Kosongkan</button></div>
        <div class="cart-items" id="cart-items"></div>
        <div class="cart-summary">
          <div class="summary-line"><span>Total Item</span><span id="cart-count">0</span></div>
          <div class="summary-line total"><span>Total Bayar</span><span id="cart-total">Rp0</span></div>
        </div>
        <div class="cart-actions">
          <button class="btn btn-primary btn-block" id="btn-checkout" onclick="openCheckout()">Bayar</button>
        </div>
      </div>
    </div>
  `;
  renderProductGrid(state.products);
  renderCart();
  document.getElementById('pos-search').addEventListener('input', (e)=>{
    const q = e.target.value.toLowerCase();
    renderProductGrid(state.products.filter(p=>p.name.toLowerCase().includes(q) || (p.barcode||'').includes(q)));
  });
}
function renderProductGrid(products){
  document.getElementById('pos-grid').innerHTML = products.map(p=>`
    <button class="product-tile ${p.stock<=0?'out-of-stock':''}" ${p.stock<=0?'disabled':''} onclick="addToCart(${p.id})">
      <div class="pt-name">${esc(p.name)}</div>
      <div class="pt-price">${rupiah(p.sellPrice)}</div>
      <div class="pt-stock">Stok: ${p.stock} ${esc(p.unit||'')}</div>
    </button>
  `).join('') || `<div class="empty-state"><div class="es-emoji">🔍</div>Produk tidak ditemukan</div>`;
}
function addToCart(productId){
  const p = state.products.find(x=>x.id===productId);
  if(!p || p.stock<=0){ toast('Stok habis','error'); return; }
  const line = state.cart.find(c=>c.productId===productId);
  if(line){
    if(line.qty >= p.stock){ toast('Stok tidak cukup','warn'); return; }
    line.qty += 1;
  } else {
    state.cart.push({productId:p.id, name:p.name, price:p.sellPrice, buyPrice:p.buyPrice, qty:1, stock:p.stock, unit:p.unit});
  }
  renderCart();
}
function changeQty(productId, delta){
  const line = state.cart.find(c=>c.productId===productId);
  if(!line) return;
  line.qty += delta;
  if(line.qty <= 0){ state.cart = state.cart.filter(c=>c.productId!==productId); }
  else if(line.qty > line.stock){ line.qty = line.stock; toast('Stok tidak cukup','warn'); }
  renderCart();
}
function clearCart(){ state.cart = []; renderCart(); }
function renderCart(){
  const wrap = document.getElementById('cart-items');
  if(!wrap) return;
  if(state.cart.length===0){
    wrap.innerHTML = `<div class="cart-empty">Keranjang masih kosong.<br>Pilih produk di sebelah kiri.</div>`;
  } else {
    wrap.innerHTML = state.cart.map(c=>`
      <div class="cart-row">
        <div class="cr-info"><div class="cr-name">${esc(c.name)}</div><div class="cr-price">${rupiah(c.price)} / ${esc(c.unit||'pcs')}</div></div>
        <div class="qty-ctrl">
          <button onclick="changeQty(${c.productId},-1)">−</button>
          <span>${c.qty}</span>
          <button onclick="changeQty(${c.productId},1)">+</button>
        </div>
      </div>
    `).join('');
  }
  const totalQty = state.cart.reduce((a,c)=>a+c.qty,0);
  const total = state.cart.reduce((a,c)=>a+c.qty*c.price,0);
  document.getElementById('cart-count').textContent = totalQty;
  document.getElementById('cart-total').textContent = rupiah(total);
}
function scanForPOS(){
  openModal(`
    <div class="modal-head"><h3>Scan Produk</h3><button class="icon-btn" style="color:var(--ink-400)" onclick="closeModal()">✕</button></div>
    <div class="modal-body"><div id="barcode-reader"></div></div>
  `, {onMount: ()=> startScanner((text)=>{
      const p = state.products.find(x=>x.barcode === text);
      closeModal();
      if(p){ addToCart(p.id); toast('Ditambahkan: '+p.name); }
      else toast('Produk dengan barcode tersebut tidak ditemukan', 'error');
    })});
}

/* ---- Checkout ---- */
function openCheckout(){
  if(state.cart.length===0){ toast('Keranjang kosong','error'); return; }
  const total = state.cart.reduce((a,c)=>a+c.qty*c.price,0);
  openModal(`
    <div class="modal-head"><h3>Pembayaran</h3><button class="icon-btn" style="color:var(--ink-400)" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="summary-line total mb-1"><span>Total Tagihan</span><span>${rupiah(total)}</span></div>
      <div class="role-switch" id="pay-switch">
        <button class="role-btn active" data-pay="cash">Tunai</button>
        <button class="role-btn" data-pay="qris">QRIS</button>
      </div>
      <div id="pay-content"></div>
    </div>
  `, {wide:true});

  const renderCash = ()=>{
    document.getElementById('pay-content').innerHTML = `
      <div class="field mb-1"><label>Uang Diterima</label><input type="number" id="pay-received" min="0" placeholder="0"></div>
      <div class="summary-line"><span>Kembalian</span><span id="pay-change">Rp0</span></div>
      <button class="btn btn-primary btn-block mt-2" id="btn-confirm-cash">Selesaikan Transaksi</button>
    `;
    const input = document.getElementById('pay-received');
    input.addEventListener('input', ()=>{
      const received = Number(input.value)||0;
      document.getElementById('pay-change').textContent = rupiah(Math.max(0, received-total));
    });
    document.getElementById('btn-confirm-cash').addEventListener('click', async ()=>{
      const received = Number(input.value)||0;
      if(received < total){ toast('Uang diterima kurang dari total','error'); return; }
      await finalizeTransaction('cash', received, received-total);
    });
  };
  const renderQris = async ()=>{
    document.getElementById('pay-content').innerHTML = `<div class="empty-state">Membuat kode QRIS…</div>`;
    let dynamicStr;
    try{
      dynamicStr = QRIS.makeDynamic(state.settings.qrisStatic, total);
    }catch(err){
      document.getElementById('pay-content').innerHTML = `<div class="empty-state" style="color:var(--danger)">String QRIS tidak valid. Cek di menu Pengaturan.</div>`;
      return;
    }
    document.getElementById('pay-content').innerHTML = `
      <div class="qris-box">
        <div class="qris-canvas-wrap"><canvas id="qris-canvas"></canvas></div>
        <div class="qris-amount">${rupiah(total)}</div>
        <p style="color:var(--ink-400);font-size:13px;margin-bottom:16px">Minta pelanggan scan kode di atas menggunakan e-wallet / mobile banking. Nominal sudah otomatis sesuai tagihan.</p>
        <p style="color:var(--ink-400);font-size:12px;margin-bottom:16px">⚠️ Konfirmasi pembayaran dilakukan manual — pastikan notifikasi/dana masuk sudah diterima sebelum menekan tombol di bawah.</p>
        <button class="btn btn-primary btn-block" id="btn-confirm-qris">✅ Pembayaran Diterima</button>
      </div>
    `;
    if(typeof QRCode !== 'undefined'){
      QRCode.toCanvas(document.getElementById('qris-canvas'), dynamicStr, {width:220, margin:1, color:{dark:'#0F4C3A'}});
    } else {
      document.getElementById('pay-content').insertAdjacentHTML('afterbegin', `<p style="color:var(--danger);font-size:12px">Library QR butuh koneksi internet saat pertama kali dipakai.</p>`);
    }
    document.getElementById('btn-confirm-qris').addEventListener('click', async ()=>{
      await finalizeTransaction('qris', total, 0);
    });
  };

  renderCash();
  document.getElementById('pay-switch').addEventListener('click', (e)=>{
    const btn = e.target.closest('.role-btn'); if(!btn) return;
    document.querySelectorAll('#pay-switch .role-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    btn.dataset.pay === 'cash' ? renderCash() : renderQris();
  });
}

async function finalizeTransaction(method, paid, change){
  const total = state.cart.reduce((a,c)=>a+c.qty*c.price,0);
  const profit = state.cart.reduce((a,c)=>a+c.qty*(c.price-c.buyPrice),0);
  const trx = {
    date: new Date().toISOString(),
    cashierId: state.session.id,
    cashierName: state.session.name,
    items: state.cart.map(c=>({productId:c.productId, name:c.name, price:c.price, buyPrice:c.buyPrice, qty:c.qty, subtotal:c.qty*c.price})),
    total, profit, paymentMethod: method, paid, change
  };
  const trxId = await DB.add(S.STORES.transactions, trx);

  for(const c of state.cart){
    const p = await DB.get(S.STORES.products, c.productId);
    if(!p) continue;
    const newStock = Math.max(0, p.stock - c.qty);
    await DB.put(S.STORES.products, {...p, stock:newStock});
    await DB.add(S.STORES.stockLogs, {productId:p.id, type:'out', change:-c.qty, previousStock:p.stock, newStock, note:`Penjualan #${trxId}`, date:new Date().toISOString(), user:state.session.name});
  }

  toast('Transaksi berhasil!');
  closeModal();
  viewReceipt(trxId);
  await renderPOS();
}
