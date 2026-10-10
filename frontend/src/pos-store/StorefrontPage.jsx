import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { orderSecretKey, rupiah, storeApi } from './storeApi';
import './storefront.css';
import './responsive.css';
import './storefrontPolish.css';
import { clearDraft, loadDraft, prepareDraft } from './checkoutState.mjs';

function readCart(slug) {
  try {
    const rows = JSON.parse(sessionStorage.getItem(`pos-cart:${slug}`) || '[]');
    return Array.isArray(rows) ? rows.slice(0, 50).filter(p => /^[a-f0-9-]{36}$/.test(p.id) && Number.isInteger(p.quantity) && p.quantity > 0 && p.quantity <= 1000 && /^\d+$/.test(String(p.selling_price))) : [];
  } catch { return []; }
}

function SafeImage({ src, alt = '', fallback = null, ...props }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return fallback;
  return <img src={src} alt={alt} onError={() => setFailed(true)} {...props} />;
}

function Store({ slug, productId, orderId }) {
  const [data, setData] = useState(null), [detail, setDetail] = useState(null), [order, setOrder] = useState(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [search, setSearch] = useState(''), [category, setCategory] = useState('');
  const [cart, setCart] = useState(() => readCart(slug)), [cartOpen, setCartOpen] = useState(() => !!loadDraft(sessionStorage, slug)), [quantity, setQuantity] = useState(1), [page, setPage] = useState(1);
  const [checkout, setCheckout] = useState(() => !!loadDraft(sessionStorage, slug)), [customerAccess, setCustomerAccess] = useState('');
  const [contact, setContact] = useState(() => { const d = loadDraft(sessionStorage, slug); return d ? { recipient: d.recipient, phone: d.phone, fulfillment: d.fulfillment, address: d.address, notes: d.notes, payment_method: d.payment_method } : { recipient: '', phone: '', fulfillment: 'PICKUP', address: '', notes: '', payment_method: 'BANK' }; });
  const pending = useRef(loadDraft(sessionStorage, slug)), submitting = useRef(false);
  const [uncertain, setUncertain] = useState(() => !!loadDraft(sessionStorage, slug));
  const catalogRequest = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    storeApi(`/store-api/${slug}`, { signal: controller.signal }).then(setData).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    if (productId) storeApi(`/store-api/${slug}/products/${productId}`, { signal: controller.signal }).then(setDetail).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    if (orderId) storeApi(`/store-api/${slug}/orders/${orderId}`, { signal: controller.signal, headers: { 'X-Order-Access': sessionStorage.getItem(orderSecretKey(slug, orderId)) || '' } })
      .then(setOrder).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => { controller.abort(); catalogRequest.current?.abort(); };
  }, [slug, productId, orderId]);
  useEffect(() => { sessionStorage.setItem(`pos-cart:${slug}`, JSON.stringify(cart)); }, [slug, cart]);
  async function loadCatalog(nextPage = 1, nextCategory = category) {
    catalogRequest.current?.abort(); const controller = new AbortController(); catalogRequest.current = controller;
    try {
      const query = new URLSearchParams({ search, category: nextCategory, page: String(nextPage) });
      const result = await storeApi(`/store-api/${slug}?${query}`, { signal: controller.signal });
      if (!controller.signal.aborted) { setData(result); setCategory(nextCategory); setPage(nextPage); }
    } catch (e) { if (e.name !== 'AbortError') setError(e.message); }
  }
  const add = (p, qty = 1) => {
    if (uncertain) { setError('Selesaikan retry pesanan sebelumnya sebelum mengubah tas.'); return; }
    pending.current = null;
    setCart(rows => { const old = rows.find(r => r.id === p.id); return old ? rows.map(r => r.id === p.id ? { ...r, quantity: Math.min(1000, r.quantity + qty) } : r) : [...rows, { ...p, quantity: qty }]; });
    setCartOpen(true); setCheckout(false);
  };
  const update = (id, qty) => { if (uncertain) return; pending.current = null; setCart(rows => rows.flatMap(r => r.id !== id ? [r] : qty > 0 ? [{ ...r, quantity: Math.min(1000, qty) }] : [])); };
  const subtotal = cart.reduce((n, p) => n + BigInt(p.selling_price) * BigInt(p.quantity), 0n);
  const shipping = contact.fulfillment === 'DELIVERY' ? BigInt(data?.store.shipping_charge || 0) : 0n;
  const changeContact = (key, value) => { if (uncertain) return; pending.current = null; setContact(c => ({ ...c, [key]: value })); };
  async function submit(e) {
    e.preventDefault(); if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (!pending.current) {
        pending.current = prepareDraft(sessionStorage, slug, { items: cart.map(p => ({ product_id: p.id, quantity: p.quantity })), ...contact }, crypto);
      }
      setUncertain(true);
      const result = await storeApi(`/store-api/${slug}/orders`, { body: pending.current, headers: customerAccess ? { 'X-Customer-Access': customerAccess } : {} });
      sessionStorage.setItem(orderSecretKey(slug, result.id), pending.current.order_access);
      setOrder(result); setCart([]); setCheckout(false); setCartOpen(false); pending.current = null; clearDraft(sessionStorage, slug); setUncertain(false);
    } catch (e) {
      if (e.status >= 400 && e.status < 500 && e.message !== 'IDEMPOTENCY_CONFLICT') { pending.current = null; clearDraft(sessionStorage, slug); setUncertain(false); }
      setError(`${e.message}. Jika koneksi terputus, coba lagi tanpa mengubah pesanan.`);
    }
    finally { submitting.current = false; setBusy(false); }
  }
  async function refreshOrder(cancel = false) {
    if (busy) return; setBusy(true); setError('');
    try { setOrder(await storeApi(`/store-api/${slug}/orders/${order.id}${cancel ? '/cancel' : ''}`, {
      ...(cancel ? { body: {} } : {}), headers: { 'X-Order-Access': sessionStorage.getItem(orderSecretKey(slug, order.id)) || '' },
    })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  if (!data) return <main className="store-page"><p role="status">{error || 'Membuka toko…'}</p></main>;
  const brand = data.store;
  const products = data.products;
  return <main className="store-page" style={{ '--store-brand': brand.color || '#166534' }}>
    <header className="store-header"><Link to={`/store/${slug}`} className="store-identity"><SafeImage src={brand.logo_url} alt={`Logo ${brand.name}`} fallback={<span className="store-logo-fallback">{brand.name.slice(0,1)}</span>}/><span><strong>{brand.name}</strong><small>Toko resmi</small></span></Link>
      <button className="store-cart-button" onClick={() => setCartOpen(v => !v)}><span aria-hidden="true">◻</span> Tas <b>{cart.reduce((n, p) => n + p.quantity, 0)}</b></button></header>
    {error && <div role="alert" className="store-alert">{error}</div>}
    {order ? <section className="store-order"><span className="store-eyebrow">PESANAN ANDA</span><h1>{order.brand.name}</h1><p className="store-number">{order.order_number}</p>
      <h2>{order.status}</h2><p>Pembayaran: {order.payment_state} · {order.payment_method}</p><p>Pesanan baru belum berarti pembayaran diterima. Merchant memverifikasi pembayaran secara manual.</p>
      <ul>{order.items.map(p => <li key={p.product_id}>{p.name} × {p.quantity} <strong>{rupiah(BigInt(p.unit_price) * BigInt(p.quantity))}</strong></li>)}</ul>
      <p>Barang: {rupiah(order.merchandise_total)} · Ongkir: {rupiah(order.shipping_total)}</p><h2>{rupiah(order.total)}</h2>
      <p>{order.recipient} · {order.phone}</p><p>{order.fulfillment} {order.address}</p><p>{order.brand.payment_instructions}</p>
      {order.courier && <p>Kurir: {order.courier} · Resi: {order.tracking || 'Belum tersedia'}</p>}
      <ol className="store-timeline">{order.timeline.map((step, i) => <li key={`${step.status}-${i}`}><strong>{step.status}</strong><time>{new Date(step.created_at).toLocaleString('id-ID')}</time></li>)}</ol>
      <button disabled={busy} onClick={() => refreshOrder()}>Perbarui status</button>{order.status === 'ORDERED' && <button disabled={busy} onClick={() => refreshOrder(true)}>Batalkan pesanan</button>}
      <p>Simpan tautan ini pada browser yang sama: <Link to={`/store/${slug}/orders/${order.id}`}>Status pesanan</Link>. Akses aman tersimpan hanya dalam sesi browser ini.</p>
      <Link to={`/store/${slug}`} onClick={() => setOrder(null)}>Kembali ke toko</Link>
    </section> : <>
      {!productId && <><section className="store-hero"><SafeImage src={brand.banner_url} alt=""/><div><span className="store-eyebrow">BELANJA LANGSUNG DARI TOKO</span><h1>Belanja praktis di {brand.name}</h1><p>{brand.description}</p><a href="#catalog">Jelajahi produk</a></div></section><section className="store-trust" aria-label="Keunggulan toko"><span><b>Stok nyata</b><small>Diverifikasi saat checkout</small></span><span><b>Harga transparan</b><small>Snapshot tersimpan di pesanan</small></span><span><b>Status mudah dilacak</b><small>Tanpa perlu membuat akun</small></span></section></>}
      {detail ? <section className="store-detail"><SafeImage src={detail.image_url} alt={detail.name} fallback={<div className="store-placeholder">Produk</div>}/><div><p>{detail.category}</p><h1>{detail.name}</h1><h2>{rupiah(detail.selling_price)}</h2><p>{detail.online_long_description || detail.online_description}</p><p>{detail.available ? 'Tersedia' : 'Stok belum tersedia'}</p>
        <label>Jumlah <input type="number" min="1" max="1000" value={quantity} onChange={e => setQuantity(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} /></label><button disabled={!detail.available} onClick={() => add(detail, quantity)}>Tambah ke tas</button></div></section>
        : !productId && <section id="catalog"><div className="store-catalog-heading"><h2>Pilihan dari toko kami</h2><form onSubmit={e => { e.preventDefault(); loadCatalog(); }}><label>Cari produk<input placeholder="Cari yang Anda butuhkan" value={search} onChange={e => setSearch(e.target.value)} /></label><button>Cari</button></form></div>
          <div className="store-categories"><button onClick={() => loadCatalog(1, '')} aria-pressed={!category}>Semua</button>{data.categories.map(c => <button key={c} aria-pressed={c === category} onClick={() => loadCatalog(1, c)}>{c}</button>)}</div>
          <div className="store-grid">{products.map(p => <article key={p.id} className="store-product"><Link to={`/store/${slug}/products/${p.id}`} className="store-product-media"><SafeImage loading="lazy" src={p.image_url} alt={p.name} fallback={<div className="store-placeholder">{p.category || 'Produk'}</div>}/>{p.online_featured&&<span className="store-featured">Unggulan</span>}</Link><div><small className="store-category">{p.category||'Produk'}</small><h3><Link to={`/store/${slug}/products/${p.id}`}>{p.name}</Link></h3><p>{p.online_description}</p><strong className="store-price">{rupiah(p.selling_price)}</strong><button disabled={!p.available} onClick={() => add(p)}>{p.available ? 'Tambah ke tas' : 'Stok habis'}</button></div></article>)}</div>{!products.length && <p className="store-empty">Belum ada produk sesuai pencarian.</p>}
          <p>Halaman {page} · Ketersediaan dan harga diverifikasi kembali saat pemesanan.</p><button disabled={page === 1} onClick={() => loadCatalog(page - 1)}>Sebelumnya</button><button disabled={products.length < 40} onClick={() => loadCatalog(page + 1)}>Berikutnya</button>
        </section>}
      {cartOpen && <section className="store-cart" aria-label="Tas belanja"><h2>Tas belanja</h2>{cart.map(p => <div key={p.id} className="store-cart-row"><span>{p.name}<small>{rupiah(p.selling_price)}</small></span><div><button disabled={busy} onClick={() => update(p.id, p.quantity - 1)}>−</button><span>{p.quantity}</span><button disabled={busy} onClick={() => update(p.id, p.quantity + 1)}>+</button><button disabled={busy} onClick={() => update(p.id, 0)}>Hapus</button></div></div>)}
        <p>Subtotal: <strong>{rupiah(subtotal)}</strong></p><button disabled={!cart.length || busy} onClick={() => setCheckout(true)}>Lanjut pemesanan</button>
        {checkout && <form onSubmit={submit} className="store-checkout"><h3>Informasi pemesanan</h3>{uncertain && <p role="status">Pesanan sebelumnya perlu diverifikasi. Tombol di bawah mengulangi request yang sama, bukan membuat pesanan baru. Jika customer terdaftar, masukkan kembali akses Anda.</p>}
          {['recipient', 'phone'].map(k => <label key={k}>{k === 'recipient' ? 'Nama penerima' : 'Telepon'}<input required maxLength={k === 'phone' ? 40 : 160} value={contact[k]} disabled={busy || uncertain} onChange={e => changeContact(k, e.target.value)} /></label>)}
          <label>Pengambilan<select disabled={busy || uncertain} value={contact.fulfillment} onChange={e => changeContact('fulfillment', e.target.value)}><option value="PICKUP">Ambil di toko</option><option value="DELIVERY">Pengiriman manual</option></select></label>
          {contact.fulfillment === 'DELIVERY' && <label>Alamat lengkap<textarea required minLength={10} maxLength={1000} disabled={busy || uncertain} value={contact.address} onChange={e => changeContact('address', e.target.value)} /></label>}
          <label>Catatan<textarea maxLength={500} disabled={busy || uncertain} value={contact.notes} onChange={e => changeContact('notes', e.target.value)} /></label>
          <label>Akses customer terdaftar (opsional)<input type="password" autoComplete="off" disabled={busy} value={customerAccess} onChange={e => { if (!uncertain) pending.current = null; setCustomerAccess(e.target.value); }} /></label>
          <label>Pembayaran<select disabled={busy || uncertain} value={contact.payment_method} onChange={e => changeContact('payment_method', e.target.value)}><option value="BANK">Transfer bank · konfirmasi manual</option><option value="QRIS">QRIS · konfirmasi manual</option>{contact.fulfillment === 'PICKUP' && <option value="CASH">Tunai saat pengambilan</option>}{(customerAccess || contact.payment_method === 'CREDIT') && shipping === 0n && <option value="CREDIT">Piutang customer terdaftar</option>}</select></label>
          <p>Barang {rupiah(subtotal)} + ongkir {rupiah(shipping)}</p><h3>Total perkiraan {rupiah(subtotal + shipping)}</h3><p>{brand.payment_instructions}</p><p>Harga final mengikuti snapshot server. Tidak ada pembayaran otomatis atau gateway.</p><button disabled={busy || !cart.length} type="submit">{busy ? 'Memproses…' : 'Buat pesanan'}</button>
        </form>}
      </section>}
    </>}
    <footer className="store-footer"><h3>{brand.name}</h3><p>{brand.address}</p><p>{brand.hours}</p>{brand.phone && <a href={`https://wa.me/${brand.phone.replace(/\D/g, '')}`} rel="noreferrer">Hubungi toko</a>}<p>{brand.footer}</p><small>Powered by KlikPesantren</small></footer>
  </main>;
}
export default function StorefrontPage() {
  const { slug, productId, orderId } = useParams();
  return <Store key={`${slug}:${productId || ''}:${orderId || ''}`} slug={slug} productId={productId} orderId={orderId} />;
}
