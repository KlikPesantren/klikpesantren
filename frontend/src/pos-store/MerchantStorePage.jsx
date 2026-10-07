import { useState } from 'react';
import { rupiah, storeApi } from './storeApi';
import './storefront.css';
import './responsive.css';

const transitions = { ORDERED: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['PROCESSING', 'REFUNDED'], PROCESSING: ['READY_TO_SHIP', 'REFUNDED'], READY_TO_SHIP: ['SHIPPED', 'COMPLETED', 'REFUNDED'], SHIPPED: ['COMPLETED', 'REFUNDED'], COMPLETED: ['REFUNDED'] };
export default function MerchantStorePage() {
  const [auth, setAuth] = useState(null), [login, setLogin] = useState({ login: '', password: '', businessId: '' });
  const [tab, setTab] = useState('orders'), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState([]), [settings, setSettings] = useState(null), [report, setReport] = useState(null), [statusFilter, setStatusFilter] = useState('');
  const [action, setAction] = useState(null), [form, setForm] = useState({}), [product, setProduct] = useState(null);
  const [paymentContext, setPaymentContext] = useState({ accounts: [], shifts: [] });
  const privateApi = (path, options = {}) => storeApi(`/pos-business/${auth.businessId}${path}`, { ...options, headers: { Authorization: `Bearer ${auth.token}` } });
  const can = permission => auth?.context.permissions.includes(permission);
  async function work(fn) { if (busy) return; setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function signIn(e) { e.preventDefault(); await work(async () => {
    const session = await storeApi('/pos-business/login', { body: { login: login.login, password: login.password } });
    const context = await storeApi(`/pos-business/${login.businessId}/context`, { headers: { Authorization: `Bearer ${session.token}` } });
    setAuth({ token: session.token, businessId: login.businessId, context }); setLogin(x => ({ ...x, password: '' }));
  }); }
  async function load(nextTab = tab) { await work(async () => {
    if (nextTab === 'orders') { setOrders(await privateApi(`/orders${statusFilter ? `?status=${statusFilter}` : ''}`)); if (can('orders.manage')) setPaymentContext(await privateApi('/order-payment-context')); }
    if (nextTab === 'settings') setSettings(await privateApi('/store'));
    if (nextTab === 'report') setReport(await privateApi('/online-report'));
    setTab(nextTab);
  }); }
  async function saveSettings(e) { e.preventDefault(); await work(async () => {
    await privateApi('/store', { body: { ...settings.store, hours_text: settings.store.hours, storefront_footer: settings.store.footer } });
    setSettings(await privateApi('/store')); setNotice('Pengaturan toko tersimpan.');
  }); }
  async function postTransition(e) { e.preventDefault(); await work(async () => {
    await privateApi(`/orders/${action.order.id}/transition`, { body: { ...form, status: action.status } });
    setNotice('Status pesanan tersimpan.'); setAction(null); setOrders(await privateApi('/orders'));
  }); }
  async function saveProduct(e) { e.preventDefault(); await work(async () => {
    await privateApi(`/products/${product.id}/online`, { body: product }); setProduct(null); setSettings(await privateApi('/store')); setNotice('Tampilan produk tersimpan. Harga dan stok tetap canonical.');
  }); }
  const setSetting = (key, value) => setSettings(s => ({ ...s, store: { ...s.store, [key]: value } }));
  if (!auth) return <main className="store-page store-merchant"><h1>Kelola toko online</h1><p>Akun merchant terpisah dari Admin Tenant. Lokal saja; tidak mengaktifkan akses production.</p>{error && <p role="alert">{error}</p>}
    <form onSubmit={signIn}>{['login', 'password', 'businessId'].map(k => <label key={k}>{k}<input type={k === 'password' ? 'password' : 'text'} required autoComplete={k === 'password' ? 'current-password' : 'off'} value={login[k]} onChange={e => setLogin(x => ({ ...x, [k]: e.target.value }))} /></label>)}<button disabled={busy}>Masuk</button></form></main>;
  return <main className="store-page store-merchant"><header className="store-header"><h2>{auth.context.business.display_name}</h2><button disabled={busy} onClick={() => work(async () => { await storeApi('/pos-business/logout', { body: {}, headers: { Authorization: `Bearer ${auth.token}` } }); setAuth(null); })}>Keluar</button></header>
    <nav>{[['orders', 'orders.read', 'Pesanan'], ['settings', 'store.manage', 'Toko & Produk'], ['report', 'reports.read', 'Laporan Online']].map(([key, permission, label]) => can(permission) && <button disabled={busy} key={key} onClick={() => load(key)}>{label}</button>)}</nav>
    {error && <p role="alert" className="store-alert">{error}</p>}{notice && <p role="status" className="store-success">{notice}</p>}{busy && <p role="status">Memproses…</p>}
    {tab === 'orders' && <section><h1>Pesanan online</h1><label>Filter status<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">Semua</option>{['ORDERED', 'CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED'].map(s => <option key={s}>{s}</option>)}</select></label><button disabled={busy || !can('orders.read')} onClick={() => load('orders')}>Muat pesanan</button>
      <div className="store-merchant-list">{orders.map(o => <article key={o.id}><span className="store-number">{o.order_number}</span><h3>{o.status} · {rupiah(o.total)}</h3><p>{o.recipient} · {o.phone}</p><p>{o.fulfillment} · {o.address}</p><p>Pembayaran {o.payment_method}: {o.payment_state}</p>
        <ul>{o.items.map(p => <li key={p.product_id}>{p.name} × {p.quantity} · {rupiah(p.unit_price)}</li>)}</ul><p>Barang {rupiah(o.merchandise_total)} · Ongkir {rupiah(o.shipping_total)}</p><p>{o.notes}</p><p>{o.courier} {o.tracking}</p>
        <details><summary>Riwayat</summary>{o.timeline.map((t, i) => <p key={i}>{t.status} · {new Date(t.created_at).toLocaleString('id-ID')} {t.reason}</p>)}</details>
        {can('orders.manage') && (transitions[o.status] || []).filter(s => s !== 'REFUNDED' || can('returns.post')).filter(s => !(s === 'SHIPPED' && o.fulfillment === 'PICKUP') && !(s === 'COMPLETED' && o.fulfillment === 'DELIVERY' && o.status === 'READY_TO_SHIP')).map(s => <button disabled={busy} key={s} onClick={() => { setAction({ order: o, status: s }); setForm({}); }}>{s}</button>)}
      </article>)}</div>
      {action && <form onSubmit={postTransition}><h2>{action.status} — {action.order.recipient}</h2>
        {action.status === 'CONFIRMED' && action.order.payment_method !== 'CREDIT' && <><label>Akun penerimaan merchant<select required value={form.account_id || ''} onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}><option value="">Pilih akun</option>{paymentContext.accounts.filter(a => a.kind === action.order.payment_method).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label><input required type="checkbox" checked={form.payment_confirmed || false} onChange={e => setForm(f => ({ ...f, payment_confirmed: e.target.checked }))} />Saya sudah memverifikasi penerimaan pembayaran</label></>}
        {(action.status === 'CONFIRMED' && action.order.payment_method !== 'CREDIT' || action.status === 'REFUNDED') && <label>Referensi bukti<input required value={form.reference || ''} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} /></label>}
        {action.status === 'CONFIRMED' && action.order.payment_method === 'CREDIT' && <label>Jatuh tempo piutang<input required type="date" value={form.due_date || ''} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></label>}
        {action.order.payment_method === 'CASH' && ['CONFIRMED', 'REFUNDED'].includes(action.status) && <label>Shift aktif<select required value={form.shift_id || ''} onChange={e => setForm(f => ({ ...f, shift_id: e.target.value }))}><option value="">Pilih shift Anda</option>{paymentContext.shifts.map(s => <option key={s.id} value={s.id}>Shift aktif · {paymentContext.accounts.find(a => a.id === s.cash_account_id)?.name}</option>)}</select></label>}
        {action.status === 'REFUNDED' && <label><input required type="checkbox" checked={form.refund_confirmed || false} onChange={e => setForm(f => ({ ...f, refund_confirmed: e.target.checked }))} />Pengembalian barang & dana sudah diverifikasi</label>}
        {['CANCELLED', 'REFUNDED'].includes(action.status) && <label>Alasan<textarea required value={form.reason || ''} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} /></label>}
        {action.status === 'SHIPPED' && <><label>Kurir<input required value={form.courier || ''} onChange={e => setForm(f => ({ ...f, courier: e.target.value }))} /></label><label>Resi (opsional)<input value={form.tracking || ''} onChange={e => setForm(f => ({ ...f, tracking: e.target.value }))} /></label></>}
        <button disabled={busy}>Konfirmasi aksi</button><button type="button" onClick={() => setAction(null)}>Tutup</button>
      </form>}
    </section>}
    {tab === 'settings' && settings && <section><form onSubmit={saveSettings}><h1>Identitas toko</h1>
      {['display_name', 'storefront_slug', 'logo_url', 'banner_url', 'brand_color', 'description', 'address', 'phone', 'hours', 'footer', 'payment_instructions', 'shipping_charge', 'reservation_minutes'].map(k => <label key={k}>{k}<input value={settings.store[k] ?? ''} onChange={e => setSetting(k, e.target.value)} /></label>)}
      {['storefront_enabled', 'public_phone'].map(k => <label key={k}><input type="checkbox" checked={!!settings.store[k]} onChange={e => setSetting(k, e.target.checked)} />{k}</label>)}<button disabled={busy}>Simpan identitas toko</button>
    </form><a href={`/store/${settings.store.storefront_slug}`}>Buka storefront</a><h2>Tampilan produk online</h2><div className="store-merchant-list">{settings.products.map(p => <article key={p.id}><h3>{p.name} · {rupiah(p.selling_price)}</h3><p>{p.online_visible ? 'Tampil online' : 'Disembunyikan'}</p>{can('products.manage') && <button onClick={() => setProduct(p)}>Edit tampilan</button>}</article>)}</div>
      {product && <form onSubmit={saveProduct}><h2>{product.name}</h2>{['online_description', 'online_long_description', 'image_url', 'category', 'online_sort'].map(k => <label key={k}>{k}<input value={product[k] ?? ''} onChange={e => setProduct(p => ({ ...p, [k]: e.target.value }))} /></label>)}{['online_visible', 'online_featured'].map(k => <label key={k}><input type="checkbox" checked={!!product[k]} onChange={e => setProduct(p => ({ ...p, [k]: e.target.checked }))} />{k}</label>)}<button disabled={busy}>Simpan tampilan produk</button></form>}
    </section>}
    {tab === 'report' && report && <section><h1>Laporan Online</h1><p>{report.formula}</p><p>{report.order_count} order · rata-rata {rupiah(report.average_online_order_value)}</p><div className="store-merchant-list">{report.channels.map(c => <article key={c.channel}><h3>{c.channel}</h3><p>Gross {rupiah(c.gross)} · Refund {rupiah(c.refunds)} · Net {rupiah(c.net)}</p></article>)}</div><h2>Status order</h2>{report.statuses.map(s => <p key={s.status}>{s.status}: {s.count}</p>)}<h2>Produk online teratas</h2>{report.top_products.map(p => <p key={p.product_id}>{p.name}: {rupiah(p.net)}</p>)}<h2>Customer online teratas</h2>{report.top_customers.map(p => <p key={p.id}>{p.name}: {rupiah(p.net)}</p>)}</section>}
  </main>;
}
