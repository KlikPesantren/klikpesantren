const pool = require("../db");
const { sahriyahLedgerJoin, sahriyahCanonicalExpressions } = require("./sahriyahCanonicalSql");

const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

function formatDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function normalizeWhatsAppNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;
  return digits;
}

function buildInvoiceNo({ paymentId, tenantId, tanggal, prefix = "INV-SHR" }) {
  const date = tanggal ? new Date(tanggal) : new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${prefix}-${tenantId}-${yyyy}${mm}-${String(paymentId).padStart(6, "0")}`;
}

function buildWhatsAppText(invoice) {
  const item = invoice.items[0] || {};
  const tenantName = invoice.tenant?.nama || "Pesantren";
  return [
    "Assalamu'alaikum.",
    "",
    "Pembayaran santri telah diterima.",
    "",
    `Nama Santri: ${invoice.santri.nama || "-"}`,
    `Kelas: ${invoice.kelas.nama || "-"}`,
    `Jenis Pembayaran: ${item.description || "-"}`,
    `Nominal: ${formatCurrency(invoice.total)}`,
    `Tanggal: ${invoice.tanggal_label || "-"}`,
    `Status: ${invoice.status || "-"}`,
    "",
    "Terima kasih.",
    tenantName,
  ].join("\n");
}

async function getSahriyahInvoice(tenantId, invoiceId) {
  const canonical = sahriyahCanonicalExpressions("ts");
  const result = await pool.query(
    `
    SELECT
      ps.id AS pembayaran_id,
      ps.tagihan_id,
      ps.tanggal AS pembayaran_tanggal,
      ps.nominal AS pembayaran_nominal,
      ps.nominal_beras AS pembayaran_beras,
      ps.petugas AS pembayaran_petugas,
      ts.bulan,
      ts.tahun,
      ts.nominal AS tagihan_nominal,
      ts.nominal_beras AS tagihan_beras,
      ${canonical.paid} AS total_bayar,
      ${canonical.remaining} AS sisa_tagihan,
      ${canonical.paidBeras} AS beras_terbayar,
      ${canonical.remainingBeras} AS sisa_beras,
      ${canonical.status} AS status,
      s.id AS santri_id,
      s.nis,
      s.nama AS santri_nama,
      s.kamar,
      s.orang_tua,
      s.nomor_hp_ortu,
      k.id AS kelas_id,
      k.nama_kelas,
      ws.nama AS wali_nama,
      ws.nomor_hp AS wali_nomor_hp,
      t.id AS tenant_id,
      t.slug AS tenant_slug,
      COALESCE(pp.nama_pesantren, t.nama) AS tenant_nama,
      COALESCE(pp.alamat, t.alamat) AS tenant_alamat,
      COALESCE(pp.telepon, t.telepon) AS tenant_telepon,
      COALESCE(pp.email, t.email) AS tenant_email,
      COALESCE(pp.website, t.website) AS tenant_website,
      COALESCE(pp.logo_url, t.logo_url) AS tenant_logo_url
    FROM pembayaran_sahriyah ps
    INNER JOIN tagihan_sahriyah ts
      ON ts.id = ps.tagihan_id
     AND ts.tenant_id = ps.tenant_id
    ${sahriyahLedgerJoin("ts")}
    LEFT JOIN santri s
      ON s.id = ts.santri_id
     AND s.tenant_id = ts.tenant_id
    LEFT JOIN kelas k
      ON k.id = s.kelas_id
     AND k.tenant_id = s.tenant_id
    LEFT JOIN wali_santri ws
      ON ws.santri_id = s.id
     AND ws.tenant_id = s.tenant_id
    INNER JOIN tenants t
      ON t.id = ps.tenant_id
    LEFT JOIN profil_pesantren pp
      ON pp.tenant_id = t.id
    WHERE ps.id = $1
      AND ps.tenant_id = $2
    ORDER BY ws.id ASC
    LIMIT 1
    `,
    [invoiceId, tenantId]
  );

  const row = result.rows[0];
  if (!row) {
    const err = new Error("Invoice sahriyah tidak ditemukan");
    err.statusCode = 404;
    throw err;
  }

  const monthName = MONTHS_ID[Number(row.bulan) - 1] || `Bulan ${row.bulan}`;
  const waliName = row.wali_nama || row.orang_tua || null;
  const waliPhone = row.wali_nomor_hp || row.nomor_hp_ortu || null;
  const paymentAmount = Number(row.pembayaran_nominal || 0);
  const riceAmount = Number(row.pembayaran_beras || 0);
  const itemDescription = `Sahriyah ${monthName} ${row.tahun}`;

  const invoice = {
    invoice_id: row.pembayaran_id,
    invoice_no: buildInvoiceNo({
      paymentId: row.pembayaran_id,
      tenantId,
      tanggal: row.pembayaran_tanggal,
    }),
    tanggal: row.pembayaran_tanggal,
    tanggal_label: formatDate(row.pembayaran_tanggal),
    tenant: {
      id: row.tenant_id,
      slug: row.tenant_slug,
      nama: row.tenant_nama,
      alamat: row.tenant_alamat,
      telepon: row.tenant_telepon,
      email: row.tenant_email,
      website: row.tenant_website,
      logo_url: row.tenant_logo_url,
    },
    santri: {
      id: row.santri_id,
      nis: row.nis,
      nama: row.santri_nama,
      kamar: row.kamar,
    },
    kelas: {
      id: row.kelas_id,
      nama: row.nama_kelas,
    },
    wali: {
      nama: waliName,
      nomor_hp: waliPhone,
      whatsapp_number: normalizeWhatsAppNumber(waliPhone),
    },
    items: [
      {
        description: itemDescription,
        bulan: row.bulan,
        bulan_label: monthName,
        tahun: row.tahun,
        nominal: paymentAmount,
        nominal_label: formatCurrency(paymentAmount),
        nominal_beras: riceAmount,
      },
    ],
    total: paymentAmount,
    total_label: formatCurrency(paymentAmount),
    status: row.status || "Diterima",
    payment_method: "Tunai",
    petugas: row.pembayaran_petugas,
    tagihan: {
      id: row.tagihan_id,
      total_bayar: Number(row.total_bayar || 0),
      sisa_tagihan: Number(row.sisa_tagihan || 0),
      beras_terbayar: Number(row.beras_terbayar || 0),
      sisa_beras: Number(row.sisa_beras || 0),
    },
  };

  invoice.whatsapp_text = buildWhatsAppText(invoice);
  return invoice;
}

async function getPembayaranInvoice(tenantId, invoiceId) {
  const result = await pool.query(
    `
    SELECT
      pd.id AS pembayaran_detail_id,
      pd.pembayaran_id,
      pd.tanggal AS pembayaran_tanggal,
      pd.nominal AS pembayaran_nominal,
      pd.petugas AS pembayaran_petugas,
      p.nama_tagihan,
      p.bulan,
      p.tahun,
      p.nominal_tagihan,
      p.nominal_bayar,
      p.sisa_tunggakan,
      p.status,
      s.id AS santri_id,
      s.nis,
      s.nama AS santri_nama,
      s.kamar,
      s.orang_tua,
      s.nomor_hp_ortu,
      k.id AS kelas_id,
      k.nama_kelas,
      ws.nama AS wali_nama,
      ws.nomor_hp AS wali_nomor_hp,
      t.id AS tenant_id,
      t.slug AS tenant_slug,
      COALESCE(pp.nama_pesantren, t.nama) AS tenant_nama,
      COALESCE(pp.alamat, t.alamat) AS tenant_alamat,
      COALESCE(pp.telepon, t.telepon) AS tenant_telepon,
      COALESCE(pp.email, t.email) AS tenant_email,
      COALESCE(pp.website, t.website) AS tenant_website,
      COALESCE(pp.logo_url, t.logo_url) AS tenant_logo_url
    FROM pembayaran_detail pd
    INNER JOIN pembayaran p
      ON p.id = pd.pembayaran_id
     AND p.tenant_id = pd.tenant_id
    LEFT JOIN santri s
      ON s.id = p.santri_id
     AND s.tenant_id = p.tenant_id
    LEFT JOIN kelas k
      ON k.id = s.kelas_id
     AND k.tenant_id = s.tenant_id
    LEFT JOIN wali_santri ws
      ON ws.santri_id = s.id
     AND ws.tenant_id = s.tenant_id
    INNER JOIN tenants t
      ON t.id = pd.tenant_id
    LEFT JOIN profil_pesantren pp
      ON pp.tenant_id = t.id
    WHERE pd.id = $1
      AND pd.tenant_id = $2
    ORDER BY ws.id ASC
    LIMIT 1
    `,
    [invoiceId, tenantId]
  );

  const row = result.rows[0];
  if (!row) {
    const err = new Error("Invoice pembayaran tidak ditemukan");
    err.statusCode = 404;
    throw err;
  }

  const waliName = row.wali_nama || row.orang_tua || null;
  const waliPhone = row.wali_nomor_hp || row.nomor_hp_ortu || null;
  const paymentAmount = Number(row.pembayaran_nominal || 0);
  const itemDescription = row.nama_tagihan || "Pembayaran";

  const invoice = {
    invoice_id: row.pembayaran_detail_id,
    invoice_no: buildInvoiceNo({
      paymentId: row.pembayaran_detail_id,
      tenantId,
      tanggal: row.pembayaran_tanggal,
      prefix: "INV-PBY",
    }),
    tanggal: row.pembayaran_tanggal,
    tanggal_label: formatDate(row.pembayaran_tanggal),
    tenant: {
      id: row.tenant_id,
      slug: row.tenant_slug,
      nama: row.tenant_nama,
      alamat: row.tenant_alamat,
      telepon: row.tenant_telepon,
      email: row.tenant_email,
      website: row.tenant_website,
      logo_url: row.tenant_logo_url,
    },
    santri: {
      id: row.santri_id,
      nis: row.nis,
      nama: row.santri_nama,
      kamar: row.kamar,
    },
    kelas: {
      id: row.kelas_id,
      nama: row.nama_kelas,
    },
    wali: {
      nama: waliName,
      nomor_hp: waliPhone,
      whatsapp_number: normalizeWhatsAppNumber(waliPhone),
    },
    items: [
      {
        description: itemDescription,
        bulan_label: row.bulan,
        tahun: row.tahun,
        nominal: paymentAmount,
        nominal_label: formatCurrency(paymentAmount),
        nominal_beras: null,
      },
    ],
    total: paymentAmount,
    total_label: formatCurrency(paymentAmount),
    status: row.status || "Diterima",
    payment_method: "Tunai",
    petugas: row.pembayaran_petugas,
    tagihan: {
      id: row.pembayaran_id,
      nominal_tagihan: Number(row.nominal_tagihan || 0),
      nominal_bayar: Number(row.nominal_bayar || 0),
      sisa_tunggakan: Number(row.sisa_tunggakan || 0),
    },
  };

  invoice.whatsapp_text = buildWhatsAppText(invoice);
  return invoice;
}

module.exports = {
  getSahriyahInvoice,
  getPembayaranInvoice,
  normalizeWhatsAppNumber,
};
