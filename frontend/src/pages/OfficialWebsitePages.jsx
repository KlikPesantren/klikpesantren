import { useMemo, useState } from "react";
import {
  FaArrowRight,
  FaChartLine,
  FaCheck,
  FaClipboardCheck,
  FaCreditCard,
  FaEnvelope,
  FaGraduationCap,
  FaInstagram,
  FaLayerGroup,
  FaMobileAlt,
  FaPhoneAlt,
  FaRegBell,
  FaShieldAlt,
  FaUserCheck,
  FaWhatsapp,
} from "react-icons/fa";
import { Link } from "react-router-dom";
import PublicLayout from "../components/public/PublicLayout";
import Seo, { breadcrumbJsonLd } from "../components/public/Seo";
import {
  buildWhatsAppUrl,
  usePublicWebsiteContact,
} from "../hooks/usePublicWebsiteContact";

const defaultContact = {
  email: "hello@klikpesantren.com",
  instagram: "https://instagram.com/klikpesantren",
};
const privacyContact = {
  controller:
    import.meta.env.VITE_PRIVACY_CONTROLLER_NAME || "Pengelola KlikPesantren",
  address:
    import.meta.env.VITE_PRIVACY_ADDRESS || "Alamat pengelola akan dicantumkan sebelum publikasi final.",
  email:
    import.meta.env.VITE_PRIVACY_EMAIL || defaultContact.email,
};
const configuredDeletionUrl = import.meta.env.VITE_ACCOUNT_DELETION_URL || "";
const accountDeletionUrl = configuredDeletionUrl.startsWith("https://")
  ? configuredDeletionUrl
  : null;

const features = [
  {
    icon: <FaGraduationCap />,
    title: "Administrasi Santri",
    summary: "Pusat data santri, wali, kelas, status, dan riwayat penting.",
    points: [
      "Profil santri dan wali dalam satu tempat",
      "Data kelas, status, dan informasi operasional",
      "Fondasi data untuk modul pembayaran, izin, dan laporan",
    ],
  },
  {
    icon: <FaCreditCard />,
    title: "Keuangan Pesantren",
    summary: "Kelola tagihan, sahriyah, pembayaran, buku kas, dan laporan.",
    points: [
      "Tagihan dan pembayaran lebih mudah dilacak",
      "Kwitansi dan histori pembayaran digital",
      "Buku kas dan ringkasan keuangan untuk pengurus",
    ],
  },
  {
    icon: <FaShieldAlt />,
    title: "RFID",
    summary: "Transaksi kartu santri, saldo, limit, merchant, dan audit mutasi.",
    points: [
      "Topup, refund, dan mutasi saldo RFID",
      "Kontrol limit dan riwayat transaksi santri",
      "Monitoring perangkat dan merchant RFID",
    ],
  },
  {
    icon: <FaMobileAlt />,
    title: "Wali Santri App",
    summary: "Aplikasi wali untuk informasi anak, tagihan, dan pengumuman.",
    points: [
      "Informasi anak terhubung dari sistem pesantren",
      "Pengumuman dan notifikasi penting",
      "Akses tagihan dan riwayat pembayaran",
    ],
  },
  {
    icon: <FaUserCheck />,
    title: "Perizinan",
    summary: "Alur pengajuan, approval, dan monitoring izin santri.",
    points: [
      "Status izin lebih jelas untuk pengurus",
      "Riwayat izin santri terdokumentasi",
      "Membantu kontrol keluar masuk santri",
    ],
  },
  {
    icon: <FaClipboardCheck />,
    title: "Pelanggaran",
    summary: "Catatan kedisiplinan, pembinaan, dan rekap pelanggaran.",
    points: [
      "Riwayat pelanggaran santri per periode",
      "Data pembinaan lebih mudah ditinjau",
      "Rekap untuk pengurus dan pimpinan",
    ],
  },
  {
    icon: <FaChartLine />,
    title: "Dashboard",
    summary: "Ringkasan operasional untuk operator, pengurus, dan pimpinan.",
    points: [
      "Pantauan data penting dalam satu tampilan",
      "Ringkasan operasional dan keuangan",
      "Membantu keputusan lebih cepat",
    ],
  },
  {
    icon: <FaLayerGroup />,
    title: "Multi Tenant",
    summary: "Arsitektur SaaS untuk banyak pesantren dengan data terpisah.",
    points: [
      "Data dan akses dipisahkan per pesantren",
      "Fitur dapat diaktifkan sesuai paket",
      "Siap untuk pengelolaan banyak tenant",
    ],
  },
];

const pricingPlans = [
  {
    name: "Basic",
    label: "Operasional dasar",
    text: "Untuk pesantren yang ingin merapikan data inti dan komunikasi awal.",
    features: [
      "Dashboard",
      "Profil pesantren",
      "Administrasi santri",
      "Guru, kelas, wali",
      "Pembayaran dasar",
      "Pengumuman",
    ],
  },
  {
    name: "Standard",
    label: "Administrasi terhubung",
    text: "Untuk tim yang ingin mengelola administrasi dan pengawasan harian lebih rapi.",
    features: [
      "Semua fitur Basic",
      "Perizinan",
      "Pelanggaran",
      "Sahriyah",
      "Rekap operasional",
    ],
  },
  {
    name: "Premium",
    label: "Ekosistem penuh",
    text: "Untuk pesantren yang membutuhkan RFID, app wali, dan kontrol operasional lebih lengkap.",
    features: [
      "Semua fitur Standard",
      "RFID",
      "Wali Santri App",
      "Kas instansi",
      "Audit",
      "Program unit",
    ],
    featured: true,
  },
  {
    name: "Custom",
    label: "Kebutuhan khusus",
    text: "Untuk pesantren atau jaringan lembaga yang membutuhkan konfigurasi fitur khusus.",
    features: [
      "Pilihan fitur manual",
      "Kebutuhan multi unit",
      "Pendampingan scope",
      "Roadmap implementasi khusus",
    ],
  },
];

const blogPosts = [
  {
    title: "Checklist Digitalisasi Administrasi Pesantren",
    category: "Administrasi",
    text: "Tahapan awal merapikan data santri, wali, kelas, dan alur operasional sebelum masuk ke modul lanjutan.",
  },
  {
    title: "Mengapa Keuangan Pesantren Perlu Sistem Terpusat",
    category: "Keuangan",
    text: "Cara melihat tagihan, pembayaran, dan laporan agar bendahara dan pimpinan punya data yang sama.",
  },
  {
    title: "Peran Wali Santri App dalam Komunikasi Pesantren",
    category: "Wali Santri",
    text: "Bagaimana aplikasi wali membantu pengumuman, tagihan, dan informasi anak sampai lebih cepat.",
  },
];

function PublicPageStyles() {
  return (
    <style>{`
      .kp-page {
        background: #ffffff;
      }

      .kp-page-hero {
        padding: 82px 0 62px;
        background:
          linear-gradient(180deg, rgba(236, 253, 245, 0.82) 0%, rgba(255, 255, 255, 0) 58%),
          #ffffff;
      }

      .kp-page-hero.narrow {
        padding-bottom: 46px;
      }

      .kp-page-kicker {
        display: inline-flex;
        width: fit-content;
        align-items: center;
        gap: 9px;
        border: 1px solid rgba(11, 93, 58, 0.14);
        border-radius: 999px;
        background: #ffffff;
        color: #0b5d3a;
        padding: 8px 12px;
        font-size: 13px;
        font-weight: 850;
      }

      .kp-page h1,
      .kp-page h2,
      .kp-page h3 {
        margin: 0;
        color: #0f172a;
        letter-spacing: 0;
      }

      .kp-page h1 {
        max-width: 840px;
        margin-top: 18px;
        font-size: clamp(40px, 6vw, 70px);
        line-height: 1;
        font-weight: 950;
      }

      .kp-page-lead {
        max-width: 740px;
        margin: 20px 0 0;
        color: #475569;
        font-size: 18px;
        line-height: 1.76;
      }

      .kp-page-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 13px;
        margin-top: 28px;
      }

      .kp-page-section {
        padding: 72px 0;
      }

      .kp-page-section.muted {
        background: #f8fafc;
      }

      .kp-page-section-head {
        max-width: 760px;
        margin-bottom: 34px;
      }

      .kp-page-section-head.center {
        margin-left: auto;
        margin-right: auto;
        text-align: center;
      }

      .kp-page-section-head h2 {
        font-size: clamp(30px, 4vw, 48px);
        line-height: 1.08;
        font-weight: 950;
      }

      .kp-page-section-head p {
        margin: 15px 0 0;
        color: #64748b;
        font-size: 16px;
        line-height: 1.74;
      }

      .kp-feature-detail-grid,
      .kp-price-grid,
      .kp-contact-grid,
      .kp-about-grid {
        display: grid;
        gap: 18px;
      }

      .kp-feature-detail-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .kp-feature-detail-card,
      .kp-price-card,
      .kp-contact-card,
      .kp-story-card,
      .kp-demo-panel,
      .kp-form-card {
        border: 1px solid rgba(15, 23, 42, 0.09);
        border-radius: 22px;
        background: #ffffff;
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.045);
      }

      .kp-feature-detail-card {
        display: grid;
        grid-template-columns: 56px minmax(0, 1fr);
        gap: 18px;
        padding: 24px;
      }

      .kp-feature-detail-icon {
        width: 52px;
        height: 52px;
        display: grid;
        place-items: center;
        border-radius: 17px;
        background: #ecfdf5;
        color: #0b5d3a;
        font-size: 21px;
      }

      .kp-feature-detail-card h3,
      .kp-price-card h3,
      .kp-contact-card h3,
      .kp-story-card h3 {
        font-size: 21px;
        line-height: 1.2;
      }

      .kp-feature-detail-card p,
      .kp-price-card p,
      .kp-contact-card p,
      .kp-story-card p,
      .kp-demo-panel p {
        margin: 10px 0 0;
        color: #64748b;
        line-height: 1.68;
      }

      .kp-check-list {
        display: grid;
        gap: 10px;
        margin-top: 17px;
      }

      .kp-check-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        color: #475569;
        font-size: 14px;
        font-weight: 730;
        line-height: 1.55;
      }

      .kp-check-row svg {
        margin-top: 3px;
        color: #0b5d3a;
        flex: 0 0 auto;
      }

      .kp-price-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .kp-price-card {
        display: flex;
        min-height: 100%;
        flex-direction: column;
        padding: 24px;
      }

      .kp-price-card.featured {
        background: #0b1220;
        color: #ffffff;
        border-color: transparent;
        box-shadow: 0 26px 70px rgba(15, 23, 42, 0.22);
      }

      .kp-price-card.featured h3,
      .kp-price-card.featured .kp-price-label {
        color: #ffffff;
      }

      .kp-price-card.featured p,
      .kp-price-card.featured .kp-check-row {
        color: rgba(255, 255, 255, 0.76);
      }

      .kp-price-label {
        margin-top: 8px;
        color: #0b5d3a;
        font-size: 13px;
        font-weight: 850;
      }

      .kp-price-note {
        margin: 18px 0 0;
        border-radius: 16px;
        background: #f8fafc;
        padding: 14px;
        color: #475569;
        font-size: 13px;
        font-weight: 750;
        line-height: 1.55;
      }

      .kp-price-card.featured .kp-price-note {
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.82);
      }

      .kp-price-action {
        margin-top: auto;
        padding-top: 24px;
      }

      .kp-partner-banner {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 20px;
        align-items: center;
        border-radius: 24px;
        background: #0b5d3a;
        color: #ffffff;
        padding: 28px;
      }

      .kp-partner-banner h2 {
        color: #ffffff;
        font-size: clamp(26px, 3vw, 38px);
      }

      .kp-partner-banner p {
        margin: 10px 0 0;
        color: rgba(255, 255, 255, 0.78);
        line-height: 1.7;
      }

      .kp-demo-grid {
        display: grid;
        grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.18fr);
        gap: 24px;
        align-items: start;
      }

      .kp-demo-panel,
      .kp-form-card {
        padding: 26px;
      }

      .kp-demo-panel {
        background: #0b1220;
        color: #ffffff;
      }

      .kp-demo-panel h2,
      .kp-demo-panel h3 {
        color: #ffffff;
      }

      .kp-demo-panel p {
        color: rgba(255, 255, 255, 0.72);
      }

      .kp-form-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }

      .kp-field {
        display: grid;
        gap: 7px;
      }

      .kp-field.full {
        grid-column: 1 / -1;
      }

      .kp-field label {
        color: #334155;
        font-size: 13px;
        font-weight: 850;
      }

      .kp-field input,
      .kp-field select,
      .kp-field textarea {
        width: 100%;
        min-height: 46px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 14px;
        background: #ffffff;
        color: #0f172a;
        font: inherit;
        padding: 11px 13px;
        outline: none;
      }

      .kp-field textarea {
        min-height: 116px;
        resize: vertical;
      }

      .kp-field input:focus,
      .kp-field select:focus,
      .kp-field textarea:focus {
        border-color: rgba(11, 93, 58, 0.52);
        box-shadow: 0 0 0 4px rgba(11, 93, 58, 0.1);
      }

      .kp-form-help {
        margin-top: 14px;
        color: #64748b;
        font-size: 13px;
        line-height: 1.6;
      }

      .kp-about-grid {
        grid-template-columns: 0.95fr 1.05fr;
        align-items: start;
      }

      .kp-story-card {
        padding: 26px;
      }

      .kp-principles {
        display: grid;
        gap: 12px;
      }

      .kp-principle {
        border: 1px solid rgba(15, 23, 42, 0.09);
        border-radius: 18px;
        background: #ffffff;
        padding: 18px;
      }

      .kp-principle strong {
        display: block;
        color: #0f172a;
      }

      .kp-principle span {
        display: block;
        margin-top: 7px;
        color: #64748b;
        line-height: 1.62;
      }

      .kp-contact-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .kp-blog-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
      }

      .kp-contact-card {
        padding: 24px;
      }

      .kp-blog-card {
        border: 1px solid rgba(15, 23, 42, 0.09);
        border-radius: 22px;
        background: #ffffff;
        padding: 24px;
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.045);
      }

      .kp-blog-category {
        display: inline-flex;
        border-radius: 999px;
        background: #ecfdf5;
        color: #0b5d3a;
        padding: 7px 10px;
        font-size: 12px;
        font-weight: 850;
      }

      .kp-blog-card h3 {
        margin-top: 16px;
      }

      .kp-blog-card p {
        margin: 10px 0 0;
        color: #64748b;
        line-height: 1.68;
      }

      .kp-legal-content {
        max-width: 820px;
      }

      .kp-legal-content h2 {
        margin-top: 34px;
        font-size: 26px;
      }

      .kp-legal-content p,
      .kp-legal-content li {
        color: #475569;
        line-height: 1.75;
      }

      .kp-contact-icon {
        width: 46px;
        height: 46px;
        display: grid;
        place-items: center;
        border-radius: 15px;
        background: #ecfdf5;
        color: #0b5d3a;
        font-size: 19px;
        margin-bottom: 16px;
      }

      .kp-contact-link {
        display: inline-flex;
        margin-top: 16px;
        color: #0b5d3a;
        font-weight: 850;
        text-decoration: none;
      }

      @media (max-width: 1080px) {
        .kp-price-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 900px) {
        .kp-feature-detail-grid,
        .kp-demo-grid,
        .kp-about-grid,
        .kp-contact-grid,
        .kp-blog-grid,
        .kp-partner-banner {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 640px) {
        .kp-page-hero {
          padding: 54px 0 42px;
        }

        .kp-page h1 {
          font-size: 40px;
        }

        .kp-page-lead {
          font-size: 16px;
        }

        .kp-page-section {
          padding: 54px 0;
        }

        .kp-page-actions .kp-btn,
        .kp-partner-banner .kp-btn,
        .kp-price-action .kp-btn,
        .kp-form-card .kp-btn {
          width: 100%;
        }

        .kp-feature-detail-card {
          grid-template-columns: 1fr;
        }

        .kp-price-grid,
        .kp-form-grid {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}

function PageHero({ eyebrow, title, text, children, icon }) {
  return (
    <section className="kp-page-hero">
      <div className="kp-shell">
        <div className="kp-page-kicker">
          {icon}
          {eyebrow}
        </div>
        <h1>{title}</h1>
        <p className="kp-page-lead">{text}</p>
        {children}
      </div>
    </section>
  );
}

function CheckList({ items }) {
  return (
    <div className="kp-check-list">
      {items.map((item) => (
        <div className="kp-check-row" key={item}>
          <FaCheck />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function PublicPageShell({ children }) {
  return (
    <PublicLayout>
      <main className="kp-page">
        <PublicPageStyles />
        {children}
      </main>
    </PublicLayout>
  );
}

export function FeaturesPage() {
  return (
    <PublicPageShell>
      <Seo
        title="Fitur KlikPesantren | Administrasi, Keuangan, RFID, Wali App"
        description="Lihat fitur KlikPesantren untuk administrasi santri, keuangan pesantren, RFID, Wali Santri App, perizinan, pelanggaran, dashboard, dan multi tenant."
        path="/fitur"
        jsonLd={breadcrumbJsonLd([
          { name: "Beranda", path: "/" },
          { name: "Fitur", path: "/fitur" },
        ])}
      />
      <PageHero
        eyebrow="Fitur"
        icon={<FaLayerGroup />}
        title="Fitur lengkap untuk operasional pesantren modern."
        text="KlikPesantren menyatukan administrasi santri, keuangan, komunikasi wali, RFID, perizinan, pelanggaran, dashboard, dan multi tenant dalam satu platform SaaS."
      >
        <div className="kp-page-actions">
          <Link className="kp-btn kp-btn-primary" to="/demo">
            Minta Demo <FaArrowRight />
          </Link>
          <Link className="kp-btn kp-btn-secondary" to="/harga">
            Lihat Paket
          </Link>
        </div>
      </PageHero>

      <section className="kp-page-section">
        <div className="kp-shell">
          <div className="kp-feature-detail-grid">
            {features.map((feature) => (
              <article className="kp-feature-detail-card" key={feature.title}>
                <div className="kp-feature-detail-icon">{feature.icon}</div>
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.summary}</p>
                  <CheckList items={feature.points} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="kp-page-section muted">
        <div className="kp-shell kp-partner-banner">
          <div>
            <h2>Ingin mulai dari kebutuhan paling mendesak?</h2>
            <p>
              Jadwalkan demo agar tim KlikPesantren bisa memetakan modul mana
              yang paling relevan untuk tahap awal pesantren Anda.
            </p>
          </div>
          <Link className="kp-btn kp-btn-secondary" to="/demo">
            Minta Demo
          </Link>
        </div>
      </section>
    </PublicPageShell>
  );
}

export function PricingPage() {
  return (
    <PublicPageShell>
      <Seo
        title="Harga KlikPesantren | Paket Basic, Standard, Premium, Custom"
        description="Paket KlikPesantren dibuat bertahap untuk pesantren: Basic, Standard, Premium, dan Custom. Jadwalkan demo untuk scope dan harga final."
        path="/harga"
        jsonLd={breadcrumbJsonLd([
          { name: "Beranda", path: "/" },
          { name: "Harga", path: "/harga" },
        ])}
      />
      <PageHero
        eyebrow="Harga"
        icon={<FaCreditCard />}
        title="Paket bertahap sesuai kesiapan operasional pesantren."
        text="Harga final disesuaikan setelah sesi demo dan pemetaan kebutuhan. Struktur paket dibuat agar pesantren dapat memulai dari modul inti lalu berkembang secara bertahap."
      >
        <div className="kp-page-actions">
          <Link className="kp-btn kp-btn-primary" to="/demo">
            Minta Demo <FaArrowRight />
          </Link>
          <Link className="kp-btn kp-btn-secondary" to="/founding-partner">
            Founding Partner
          </Link>
        </div>
      </PageHero>

      <section className="kp-page-section">
        <div className="kp-shell">
          <div className="kp-price-grid">
            {pricingPlans.map((plan) => (
              <article
                className={`kp-price-card ${plan.featured ? "featured" : ""}`}
                key={plan.name}
              >
                <h3>{plan.name}</h3>
                <div className="kp-price-label">{plan.label}</div>
                <p>{plan.text}</p>
                <div className="kp-price-note">Harga menunggu scope demo.</div>
                <CheckList items={plan.features} />
                <div className="kp-price-action">
                  <Link
                    className={`kp-btn ${plan.featured ? "kp-btn-secondary" : "kp-btn-primary"}`}
                    to="/demo"
                  >
                    Minta Demo
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="kp-page-section muted">
        <div className="kp-shell kp-partner-banner">
          <div>
            <h2>Slot Founding Partner masih menjadi jalur khusus.</h2>
            <p>
              Untuk pesantren yang ingin ikut fase awal, campaign Founding
              Partner tetap tersedia dengan pendampingan prioritas.
            </p>
          </div>
          <Link className="kp-btn kp-btn-secondary" to="/founding-partner">
            Lihat Founding Partner
          </Link>
        </div>
      </section>
    </PublicPageShell>
  );
}

export function DemoPage() {
  const contact = usePublicWebsiteContact();
  const [form, setForm] = useState({
    nama: "",
    pesantren: "",
    jabatan: "",
    whatsapp: "",
    jumlahSantri: "",
    kebutuhan: "",
  });

  const whatsappUrl = useMemo(() => {
    const whatsappBaseUrl = buildWhatsAppUrl(contact.whatsapp);
    if (!whatsappBaseUrl) return "";

    const message = [
      "Assalamu'alaikum, saya ingin minta demo KlikPesantren.",
      "",
      `Nama: ${form.nama || "-"}`,
      `Nama pesantren: ${form.pesantren || "-"}`,
      `Jabatan: ${form.jabatan || "-"}`,
      `WhatsApp: ${form.whatsapp || "-"}`,
      `Jumlah santri: ${form.jumlahSantri || "-"}`,
      `Kebutuhan utama: ${form.kebutuhan || "-"}`,
    ].join("\n");

    return `${whatsappBaseUrl}?text=${encodeURIComponent(message)}`;
  }, [contact.whatsapp, form]);

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const submitDemo = (event) => {
    event.preventDefault();
    if (!whatsappUrl) return;
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <PublicPageShell>
      <Seo
        title="Minta Demo KlikPesantren | Konsultasi Platform Pesantren"
        description="Jadwalkan demo KlikPesantren untuk melihat alur administrasi santri, keuangan, RFID, Wali Santri App, dan dashboard operasional."
        path="/demo"
        jsonLd={breadcrumbJsonLd([
          { name: "Beranda", path: "/" },
          { name: "Demo", path: "/demo" },
        ])}
      />
      <PageHero
        eyebrow="Minta Demo"
        icon={<FaRegBell />}
        title="Lihat bagaimana KlikPesantren bekerja untuk pesantren Anda."
        text="Isi form singkat ini. Untuk sementara, permintaan demo akan diarahkan ke WhatsApp dengan pesan yang sudah terformat."
      />

      <section className="kp-page-section">
        <div className="kp-shell kp-demo-grid">
          <aside className="kp-demo-panel">
            <h2>Yang akan dibahas saat demo</h2>
            <p>
              Tim KlikPesantren akan membantu memetakan kondisi operasional,
              modul prioritas, dan tahap implementasi yang paling realistis.
            </p>
            <CheckList
              items={[
                "Kebutuhan administrasi santri dan wali",
                "Alur pembayaran dan laporan keuangan",
                "Kesiapan RFID, app wali, dan dashboard",
                "Rekomendasi paket awal",
              ]}
            />
          </aside>

          <form className="kp-form-card" onSubmit={submitDemo}>
            <div className="kp-form-grid">
              <div className="kp-field">
                <label htmlFor="nama">Nama</label>
                <input
                  id="nama"
                  name="nama"
                  value={form.nama}
                  onChange={updateField}
                  placeholder="Nama lengkap"
                />
              </div>
              <div className="kp-field">
                <label htmlFor="pesantren">Nama pesantren</label>
                <input
                  id="pesantren"
                  name="pesantren"
                  value={form.pesantren}
                  onChange={updateField}
                  placeholder="Contoh: Pondok Pesantren ..."
                />
              </div>
              <div className="kp-field">
                <label htmlFor="jabatan">Jabatan</label>
                <input
                  id="jabatan"
                  name="jabatan"
                  value={form.jabatan}
                  onChange={updateField}
                  placeholder="Pimpinan, bendahara, operator"
                />
              </div>
              <div className="kp-field">
                <label htmlFor="whatsapp">WhatsApp</label>
                <input
                  id="whatsapp"
                  name="whatsapp"
                  value={form.whatsapp}
                  onChange={updateField}
                  placeholder="08xxxxxxxxxx"
                />
              </div>
              <div className="kp-field">
                <label htmlFor="jumlahSantri">Jumlah santri</label>
                <select
                  id="jumlahSantri"
                  name="jumlahSantri"
                  value={form.jumlahSantri}
                  onChange={updateField}
                >
                  <option value="">Pilih rentang</option>
                  <option value="< 100 santri">&lt; 100 santri</option>
                  <option value="100 - 300 santri">100 - 300 santri</option>
                  <option value="301 - 700 santri">301 - 700 santri</option>
                  <option value="> 700 santri">&gt; 700 santri</option>
                </select>
              </div>
              <div className="kp-field full">
                <label htmlFor="kebutuhan">Kebutuhan utama</label>
                <textarea
                  id="kebutuhan"
                  name="kebutuhan"
                  value={form.kebutuhan}
                  onChange={updateField}
                  placeholder="Ceritakan modul atau masalah operasional yang paling ingin dibenahi."
                />
              </div>
            </div>

            <div className="kp-page-actions">
              <button className="kp-btn kp-btn-primary" type="submit" disabled={!whatsappUrl}>
                Kirim via WhatsApp <FaWhatsapp />
              </button>
            </div>
            <div className="kp-form-help">
              Form ini belum menyimpan data ke backend. Pesan akan dibuka di
              WhatsApp agar tim bisa menindaklanjuti demo.
            </div>
          </form>
        </div>
      </section>
    </PublicPageShell>
  );
}

export function AboutPage() {
  return (
    <PublicPageShell>
      <Seo
        title="Tentang KlikPesantren | Platform Digitalisasi Pesantren"
        description="KlikPesantren adalah platform SaaS digitalisasi pesantren yang membantu operasional administrasi, keuangan, komunikasi wali, RFID, dan dashboard."
        path="/tentang"
        jsonLd={breadcrumbJsonLd([
          { name: "Beranda", path: "/" },
          { name: "Tentang", path: "/tentang" },
        ])}
      />
      <PageHero
        eyebrow="Tentang KlikPesantren"
        icon={<FaLayerGroup />}
        title="Platform digitalisasi pesantren yang lahir dari kebutuhan operasional nyata."
        text="KlikPesantren dibangun untuk membantu pesantren bekerja lebih rapi, cepat, dan terukur tanpa mengubah karakter utama pesantren sebagai lembaga pendidikan dan pembinaan."
      >
        <div className="kp-page-actions">
          <Link className="kp-btn kp-btn-primary" to="/demo">
            Minta Demo <FaArrowRight />
          </Link>
          <Link className="kp-btn kp-btn-secondary" to="/fitur">
            Lihat Fitur
          </Link>
        </div>
      </PageHero>

      <section className="kp-page-section">
        <div className="kp-shell kp-about-grid">
          <article className="kp-story-card">
            <h2>Cerita produk</h2>
            <p>
              Banyak pesantren telah berkembang cepat, tetapi pekerjaan
              administrasi masih sering bergantung pada buku, spreadsheet, grup
              chat, dan proses manual. Dampaknya terasa pada pembayaran,
              komunikasi wali, monitoring izin, pencatatan pelanggaran, dan
              laporan pimpinan.
            </p>
            <p>
              KlikPesantren hadir sebagai platform SaaS yang menyatukan
              pekerjaan tersebut dalam satu ekosistem. Fokusnya bukan membuat
              profil sekolah atau website yayasan, tetapi menyediakan alat kerja
              operasional yang bisa dipakai setiap hari oleh tim pesantren.
            </p>
          </article>

          <div className="kp-principles">
            <div className="kp-principle">
              <strong>Visi</strong>
              <span>
                Membantu pesantren memiliki sistem operasional digital yang
                rapi, aman, dan mudah berkembang.
              </span>
            </div>
            <div className="kp-principle">
              <strong>Misi</strong>
              <span>
                Menyediakan modul administrasi, keuangan, komunikasi wali, RFID,
                dan dashboard yang dapat diimplementasikan bertahap.
              </span>
            </div>
            <div className="kp-principle">
              <strong>Prinsip produk</strong>
              <span>
                Modular, mudah digunakan operator, siap multi tenant, dan
                berorientasi pada kebutuhan lapangan pesantren.
              </span>
            </div>
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}

export function ContactPage() {
  const contact = usePublicWebsiteContact();
  const contactWhatsappUrl = buildWhatsAppUrl(contact.whatsapp);

  return (
    <PublicPageShell>
      <Seo
        title="Kontak KlikPesantren | WhatsApp, Email, dan Demo"
        description="Hubungi KlikPesantren melalui WhatsApp, email hello@klikpesantren.com, Instagram, atau jadwalkan demo platform operasional pesantren."
        path="/kontak"
        jsonLd={breadcrumbJsonLd([
          { name: "Beranda", path: "/" },
          { name: "Kontak", path: "/kontak" },
        ])}
      />
      <PageHero
        eyebrow="Kontak"
        icon={<FaPhoneAlt />}
        title="Hubungi tim KlikPesantren."
        text="Pilih jalur komunikasi yang paling nyaman untuk demo, pertanyaan produk, atau diskusi kebutuhan implementasi pesantren."
      >
        <div className="kp-page-actions">
          <Link className="kp-btn kp-btn-primary" to="/demo">
            Minta Demo <FaArrowRight />
          </Link>
        </div>
      </PageHero>

      <section className="kp-page-section">
        <div className="kp-shell kp-contact-grid">
          <article className="kp-contact-card">
            <div className="kp-contact-icon">
              <FaWhatsapp />
            </div>
            <h3>WhatsApp</h3>
            <p>
              Jalur tercepat untuk bertanya, menjadwalkan demo, atau membahas
              kebutuhan awal.
            </p>
            <a
              className="kp-contact-link"
              href={contactWhatsappUrl || undefined}
              aria-disabled={!contactWhatsappUrl}
              target="_blank"
              rel="noreferrer"
            >
              Chat WhatsApp
            </a>
          </article>

          <article className="kp-contact-card">
            <div className="kp-contact-icon">
              <FaEnvelope />
            </div>
            <h3>Email</h3>
            <p>
              Gunakan email untuk kebutuhan resmi, proposal, atau komunikasi
              tertulis.
            </p>
            <a className="kp-contact-link" href={`mailto:${contact.email || defaultContact.email}`}>
              {contact.email || defaultContact.email}
            </a>
          </article>

          <article className="kp-contact-card">
            <div className="kp-contact-icon">
              <FaInstagram />
            </div>
            <h3>Instagram</h3>
            <p>
              Kanal sosial untuk update produk, edukasi digitalisasi pesantren,
              dan informasi campaign.
            </p>
            <a className="kp-contact-link" href={contact.instagram || defaultContact.instagram} target="_blank" rel="noreferrer">
              {String(contact.instagram || defaultContact.instagram).replace("https://instagram.com/", "@")}
            </a>
          </article>
        </div>
      </section>

      <section className="kp-page-section muted">
        <div className="kp-shell kp-partner-banner">
          <div>
            <h2>Butuh arahan paket yang cocok?</h2>
            <p>
              Mulai dari demo singkat. Tim KlikPesantren akan membantu memetakan
              kebutuhan fitur dan tahap implementasi.
            </p>
          </div>
          <Link className="kp-btn kp-btn-secondary" to="/demo">
            Minta Demo
          </Link>
        </div>
      </section>
    </PublicPageShell>
  );
}

export function BlogPage() {
  return (
    <PublicPageShell>
      <Seo
        title="Blog KlikPesantren | Digitalisasi Administrasi Pesantren"
        description="Artikel KlikPesantren tentang digitalisasi administrasi santri, keuangan pesantren, RFID, Wali Santri App, dan operasional pesantren modern."
        path="/blog"
        jsonLd={breadcrumbJsonLd([
          { name: "Beranda", path: "/" },
          { name: "Blog", path: "/blog" },
        ])}
      />
      <PageHero
        eyebrow="Blog"
        icon={<FaRegBell />}
        title="Insight digitalisasi pesantren."
        text="Struktur blog awal untuk edukasi administrasi, keuangan, komunikasi wali, RFID, dan operasional pesantren. CMS belum diaktifkan pada sprint ini."
      />
      <section className="kp-page-section">
        <div className="kp-shell kp-blog-grid">
          {blogPosts.map((post) => (
            <article className="kp-blog-card" key={post.title}>
              <div className="kp-blog-category">{post.category}</div>
              <h3>{post.title}</h3>
              <p>{post.text}</p>
            </article>
          ))}
        </div>
      </section>
    </PublicPageShell>
  );
}

function PrivacyPolicyDocument({
  title = "Kebijakan Privasi KlikPesantren",
  seoTitle = "Privacy Policy KlikPesantren",
  path = "/privacy-policy",
  lastUpdated = "13 Juli 2026",
  dateLabel = "Tanggal berlaku",
}) {
  return (
    <PublicPageShell>
      <Seo
        title={seoTitle}
        description="Kebijakan privasi KlikPesantren terkait pengelolaan informasi untuk layanan administrasi pesantren digital."
        path={path}
        jsonLd={breadcrumbJsonLd([
          { name: "Beranda", path: "/" },
          { name: title, path },
        ])}
      />
      <PageHero
        eyebrow="Legal"
        icon={<FaShieldAlt />}
        title={title}
        text="Penjelasan pemrosesan data pada platform KlikPesantren dan aplikasi Wali Santri."
      />
      <section className="kp-page-section">
        <div className="kp-shell kp-legal-content">
          <p><strong>{dateLabel}:</strong> {lastUpdated}</p>

          <h2>1. Pengelola dan ruang lingkup</h2>
          <p>
            Kebijakan ini berlaku untuk layanan KlikPesantren, termasuk aplikasi
            Wali Santri. {privacyContact.controller} menyediakan teknologi,
            sedangkan pesantren mengelola akun wali dan sebagian besar catatan
            administrasi santri sesuai perjanjian serta kewenangannya.
          </p>

          <h2>2. Data yang diproses</h2>
          <p>
            Data dapat mencakup nama dan nomor HP wali; identitas, profil, kelas,
            absensi, nilai, hafalan, perizinan, pelanggaran, dan catatan kesehatan
            santri; tagihan, sahriyah, pembayaran, saldo, serta riwayat transaksi;
            pengumuman; token notifikasi; alamat IP; user-agent; dan data teknis
            yang diperlukan untuk keamanan serta dukungan layanan.
          </p>

          <h2>3. Tujuan pemrosesan</h2>
          <p>
            Data digunakan untuk autentikasi, menampilkan layanan pesantren kepada
            wali, mengelola administrasi santri, menyampaikan pengumuman dan
            notifikasi, menjaga keamanan akun, mencegah penyalahgunaan, menangani
            dukungan, serta memenuhi kebutuhan operasional dan hukum yang berlaku.
          </p>

          <h2>4. Notifikasi, Firebase, dan penyedia layanan</h2>
          <p>
            Jika pengguna memberi izin, aplikasi memproses token perangkat untuk
            mengirim notifikasi melalui Expo dan Firebase Cloud Messaging.
            Penyedia hosting, penyimpanan, dan layanan teknis lain dapat memproses
            data terbatas untuk menjalankan layanan. Daftar serta perjanjian vendor
            wajib diverifikasi pengelola sebelum publikasi final.
          </p>

          <h2>5. Penyimpanan, keamanan, dan retensi</h2>
          <p>
            Komunikasi aplikasi production menggunakan HTTPS dan token sesi pada
            perangkat disimpan menggunakan penyimpanan aman. Kebijakan ini tidak
            mengklaim seluruh data server terenkripsi saat disimpan sebelum bukti
            infrastrukturnya diverifikasi. Masa retensi mengikuti kebutuhan
            administrasi pesantren, perjanjian layanan, keamanan, kewajiban hukum,
            dan penyelesaian sengketa. Data tidak dijanjikan langsung terhapus
            ketika akses wali dihentikan.
          </p>

          <h2>6. Koreksi dan penghapusan akun/data</h2>
          <p>
            Aplikasi Wali Santri tidak menyediakan pendaftaran akun mandiri.
            Wali dapat meminta koreksi data kontak, penonaktifan atau penghapusan
            akun login, dan penghapusan token notifikasi melalui admin pesantren
            atau kanal resmi pengelola. Penghapusan akun wali tidak otomatis
            menghapus data akademik, kesehatan, pelanggaran, perizinan, keuangan,
            atau arsip administrasi santri yang dikelola pesantren.
          </p>
          <p>
            {accountDeletionUrl ? (
              <a href={accountDeletionUrl}>Ajukan permintaan penghapusan akun</a>
            ) : (
              <>Kanal online sedang disiapkan. Hubungi admin pesantren atau email privasi di bawah.</>
            )}
          </p>

          <h2>7. Hak pengguna dan data santri</h2>
          <p>
            Pengguna dapat meminta akses, koreksi, pembatasan, atau penghapusan
            sesuai ketentuan yang berlaku. Permintaan perlu diverifikasi dan dapat
            melibatkan pesantren. Data santri diperlakukan sebagai data yang perlu
            perlindungan khusus dan hanya ditampilkan kepada akun yang terhubung.
          </p>

          <h2>8. Kontak</h2>
          <p>
            Pengelola: {privacyContact.controller}<br />
            Alamat: {privacyContact.address}<br />
            Email: <a href={`mailto:${privacyContact.email}`}>{privacyContact.email}</a>
          </p>

          <h2>9. Perubahan kebijakan</h2>
          <p>
            Kebijakan dapat diperbarui mengikuti perubahan layanan atau ketentuan.
            Tanggal berlaku pada halaman ini akan diperbarui ketika revisi efektif.
          </p>
        </div>
      </section>
    </PublicPageShell>
  );
}

export function PrivacyPolicyPage() {
  return <PrivacyPolicyDocument />;
}

export function WaliSantriPrivacyPolicyPage() {
  return (
    <PrivacyPolicyDocument
      title="Kebijakan Privasi WaliSantri"
      seoTitle="Kebijakan Privasi WaliSantri"
      path="/privacy/walisantri"
      lastUpdated="24 September 2026"
      dateLabel="Terakhir diperbarui"
    />
  );
}

export function TermsOfServicePage() {
  return (
    <PublicPageShell>
      <Seo
        title="Terms of Service KlikPesantren"
        description="Ketentuan layanan awal KlikPesantren untuk penggunaan platform SaaS administrasi pesantren."
        path="/terms-of-service"
        jsonLd={breadcrumbJsonLd([
          { name: "Beranda", path: "/" },
          { name: "Terms of Service", path: "/terms-of-service" },
        ])}
      />
      <PageHero
        eyebrow="Legal"
        icon={<FaClipboardCheck />}
        title="Terms of Service"
        text="Ketentuan layanan awal untuk penggunaan website dan komunikasi demo KlikPesantren."
      />
      <section className="kp-page-section">
        <div className="kp-shell kp-legal-content">
          <h2>Penggunaan website</h2>
          <p>
            Website KlikPesantren menyediakan informasi produk, fitur, paket,
            demo, dan campaign Founding Partner untuk calon pengguna.
          </p>
          <h2>Layanan produk</h2>
          <p>
            Detail fitur, harga, implementasi, dan dukungan akan disepakati
            berdasarkan kebutuhan pesantren dan cakupan layanan yang dipilih.
          </p>
          <h2>Kontak</h2>
          <p>
            Pertanyaan terkait ketentuan layanan dapat dikirim ke
            hello@klikpesantren.com.
          </p>
        </div>
      </section>
    </PublicPageShell>
  );
}
