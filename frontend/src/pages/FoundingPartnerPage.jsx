import {
  FaArrowRight,
  FaChartLine,
  FaCheck,
  FaChevronDown,
  FaClipboardCheck,
  FaCreditCard,
  FaGraduationCap,
  FaLayerGroup,
  FaRegBell,
  FaShieldAlt,
  FaUserCheck,
  FaWhatsapp,
} from "react-icons/fa";
import Seo, { breadcrumbJsonLd } from "../components/public/Seo";
import {
  buildWhatsAppUrl,
  usePublicWebsiteContact,
} from "../hooks/usePublicWebsiteContact";

const problemItems = [
  "Data santri tersebar di buku, Excel, dan grup chat.",
  "Pembayaran, izin, kesehatan, dan pelanggaran sulit dipantau real-time.",
  "Wali santri sering menunggu kabar karena informasi belum terpusat.",
  "Pimpinan pesantren butuh laporan cepat tanpa membebani operator.",
];

const modules = [
  {
    icon: <FaGraduationCap />,
    title: "Administrasi Santri",
    text: "Profil santri, kelas, wali, status, dan riwayat penting tersusun dalam satu pusat data.",
  },
  {
    icon: <FaRegBell />,
    title: "Wali Santri App",
    text: "APK wali untuk pengumuman, kabar anak, tagihan, dan notifikasi penting dari pesantren.",
  },
  {
    icon: <FaShieldAlt />,
    title: "RFID",
    text: "Kartu santri, saldo, limit harian, topup, refund, dan riwayat transaksi RFID.",
  },
  {
    icon: <FaCreditCard />,
    title: "Keuangan",
    text: "Sahriyah, tagihan, kwitansi digital, buku kas, dan laporan pembayaran yang mudah dilacak.",
  },
  {
    icon: <FaUserCheck />,
    title: "Perizinan",
    text: "Pengajuan dan monitoring izin santri agar status keluar-masuk lebih jelas.",
  },
  {
    icon: <FaClipboardCheck />,
    title: "Pelanggaran",
    text: "Catatan kedisiplinan, riwayat pembinaan, dan rekap pelanggaran santri per periode.",
  },
  {
    icon: <FaChartLine />,
    title: "Dashboard",
    text: "Ringkasan operasional, keuangan, akademik, dan kedisiplinan untuk pimpinan pesantren.",
  },
  {
    icon: <FaLayerGroup />,
    title: "Multi Tenant",
    text: "Satu platform untuk banyak pesantren dengan ruang data, fitur, dan akses yang terpisah.",
  },
];

const benefits = [
  "Harga khusus Founding Partner selama periode awal.",
  "Prioritas onboarding dan pendampingan setup data.",
  "Masukan pesantren ikut membentuk roadmap produk KlikPesantren.",
  "Akses lebih awal ke modul baru yang relevan.",
  "Badge Founding Partner untuk profil pesantren.",
];

const faqs = [
  {
    question: "Apakah KlikPesantren cocok untuk pesantren kecil?",
    answer:
      "Cocok. Sistem dibuat bertahap, jadi pesantren bisa mulai dari data santri, pembayaran, dan aplikasi wali dulu.",
  },
  {
    question: "Apakah harus langsung memakai semua modul?",
    answer:
      "Tidak. Modul bisa diaktifkan sesuai kebutuhan operasional pesantren.",
  },
  {
    question: "Apakah data pesantren dipisah antar lembaga?",
    answer:
      "Ya. KlikPesantren dirancang multi-tenant sehingga setiap pesantren memiliki ruang data masing-masing.",
  },
  {
    question: "Bagaimana cara daftar Founding Partner?",
    answer:
      "Klik tombol WhatsApp, lalu tim KlikPesantren akan membantu cek kebutuhan dan jadwal onboarding.",
  },
];

function LandingStyles() {
  return (
    <style>{`
      :root {
        --ks-green: #0b5d3a;
        --ks-green-2: #0f8a53;
        --ks-navy: #071b33;
        --ks-cream: #f7f0df;
        --ks-mint: #e7f5ee;
        --ks-ink: #102033;
        --ks-muted: #607082;
        --ks-line: rgba(7, 27, 51, 0.12);
        --ks-white: #ffffff;
      }

      .ks-landing {
        min-height: 100vh;
        background: var(--ks-white);
        color: var(--ks-ink);
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
        overflow-x: hidden;
      }

      .ks-container {
        width: min(1120px, calc(100% - 40px));
        margin: 0 auto;
      }

      .ks-nav {
        position: sticky;
        top: 0;
        z-index: 20;
        backdrop-filter: blur(18px);
        background: rgba(255, 255, 255, 0.88);
        border-bottom: 1px solid rgba(7, 27, 51, 0.08);
      }

      .ks-nav-inner {
        height: 76px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
      }

      .ks-brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        font-weight: 900;
        color: var(--ks-navy);
        text-decoration: none;
        letter-spacing: 0;
      }

      .ks-brand-mark {
        width: 42px;
        height: 42px;
        border-radius: 14px;
        display: grid;
        place-items: center;
        color: white;
        background: var(--ks-green);
        box-shadow: 0 14px 30px rgba(11, 93, 58, 0.22);
      }

      .ks-brand-logo {
        width: 30px;
        height: 30px;
        object-fit: contain;
        display: block;
      }

      .ks-kicker-logo {
        width: 18px;
        height: 18px;
        object-fit: contain;
        display: block;
      }

      .ks-nav-links {
        display: flex;
        align-items: center;
        gap: 22px;
        font-size: 14px;
        font-weight: 700;
      }

      .ks-nav-links a {
        color: var(--ks-muted);
        text-decoration: none;
      }

      .ks-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        min-height: 46px;
        padding: 0 18px;
        border-radius: 999px;
        border: 1px solid transparent;
        font-weight: 800;
        font-size: 14px;
        text-decoration: none;
        cursor: pointer;
        transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
      }

      .ks-button:hover {
        transform: translateY(-1px);
      }

      .ks-button-primary {
        background: var(--ks-green);
        color: white;
        box-shadow: 0 18px 36px rgba(11, 93, 58, 0.24);
      }

      .ks-button-dark {
        background: var(--ks-navy);
        color: white;
        box-shadow: 0 18px 36px rgba(7, 27, 51, 0.22);
      }

      .ks-button-soft {
        background: var(--ks-mint);
        color: var(--ks-green);
        border-color: rgba(11, 93, 58, 0.12);
      }

      .ks-hero {
        position: relative;
        padding: 72px 0 56px;
        background:
          linear-gradient(180deg, rgba(247, 240, 223, 0.62) 0%, rgba(255, 255, 255, 0) 72%),
          url("/landing/hero-bg.jpg") center top / cover no-repeat,
          var(--ks-white);
      }

      .ks-hero-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(360px, 0.9fr);
        align-items: center;
        gap: 54px;
      }

      .ks-kicker {
        width: fit-content;
        display: inline-flex;
        align-items: center;
        gap: 9px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(11, 93, 58, 0.08);
        color: var(--ks-green);
        font-size: 13px;
        font-weight: 800;
        margin-bottom: 18px;
      }

      .ks-hero h1 {
        margin: 0;
        max-width: 720px;
        color: var(--ks-navy);
        font-size: clamp(42px, 7vw, 76px);
        line-height: 0.98;
        letter-spacing: 0;
        font-weight: 950;
      }

      .ks-hero p {
        margin: 24px 0 0;
        max-width: 600px;
        color: var(--ks-muted);
        font-size: 18px;
        line-height: 1.72;
      }

      .ks-hero-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        margin-top: 32px;
      }

      .ks-trust-row {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        margin-top: 30px;
        color: var(--ks-muted);
        font-size: 13px;
        font-weight: 700;
      }

      .ks-trust-row span {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .ks-hero-visual {
        border-radius: 30px;
        padding: 16px;
        background: var(--ks-navy);
        box-shadow: 0 30px 80px rgba(7, 27, 51, 0.28);
      }

      .ks-dashboard-image,
      .ks-phone-image {
        width: 100%;
        height: auto;
        display: block;
      }

      .ks-dashboard-image {
        border-radius: 22px;
        object-fit: cover;
      }

      .ks-phone-image {
        border-radius: 28px;
        object-fit: contain;
      }

      .ks-app-window {
        overflow: hidden;
        border-radius: 22px;
        background: #f7faf8;
        border: 1px solid rgba(255, 255, 255, 0.18);
      }

      .ks-section {
        padding: 72px 0;
      }

      .ks-section-alt {
        background: #f8faf8;
      }

      .ks-section-cream {
        background: var(--ks-cream);
      }

      .ks-section-head {
        max-width: 720px;
        margin-bottom: 34px;
      }

      .ks-section-head.center {
        text-align: center;
        margin-left: auto;
        margin-right: auto;
      }

      .ks-section-head h2 {
        margin: 0;
        color: var(--ks-navy);
        font-size: clamp(30px, 4vw, 46px);
        line-height: 1.08;
        font-weight: 950;
        letter-spacing: 0;
      }

      .ks-section-head p {
        margin: 16px 0 0;
        color: var(--ks-muted);
        font-size: 16px;
        line-height: 1.72;
      }

      .ks-two-col {
        display: grid;
        grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
        gap: 36px;
        align-items: start;
      }

      .ks-list {
        display: grid;
        gap: 14px;
      }

      .ks-list-item {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 18px;
        border-radius: 18px;
        background: white;
        border: 1px solid var(--ks-line);
        color: var(--ks-muted);
        line-height: 1.58;
        font-weight: 650;
      }

      .ks-list-icon {
        width: 28px;
        height: 28px;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        border-radius: 999px;
        color: var(--ks-green);
        background: var(--ks-mint);
      }

      .ks-solution-panel {
        border-radius: 28px;
        padding: 30px;
        background: var(--ks-navy);
        color: white;
      }

      .ks-solution-panel h3 {
        margin: 0;
        font-size: 26px;
        line-height: 1.2;
      }

      .ks-solution-panel p {
        color: rgba(255, 255, 255, 0.76);
        line-height: 1.72;
      }

      .ks-solution-steps {
        display: grid;
        gap: 12px;
        margin-top: 22px;
      }

      .ks-solution-steps div {
        padding: 14px 16px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.09);
        font-weight: 750;
      }

      .ks-modules {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px;
      }

      .ks-module-card {
        padding: 22px;
        border-radius: 20px;
        background: white;
        border: 1px solid var(--ks-line);
      }

      .ks-module-icon {
        width: 46px;
        height: 46px;
        display: grid;
        place-items: center;
        border-radius: 15px;
        color: var(--ks-green);
        background: var(--ks-mint);
        margin-bottom: 16px;
        font-size: 20px;
      }

      .ks-module-card h3 {
        margin: 0;
        color: var(--ks-navy);
        font-size: 18px;
      }

      .ks-module-card p {
        margin: 10px 0 0;
        color: var(--ks-muted);
        line-height: 1.62;
        font-size: 14px;
      }

      .ks-mockup-band {
        border-radius: 32px;
        padding: 24px;
        background: var(--ks-navy);
        box-shadow: 0 28px 70px rgba(7, 27, 51, 0.24);
      }

      .ks-mockup-grid {
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 18px;
      }

      .ks-phone {
        width: min(250px, 100%);
        justify-self: center;
        border-radius: 34px;
        padding: 12px;
        background: #111827;
        box-shadow: 0 24px 54px rgba(0, 0, 0, 0.28);
      }

      .ks-partner {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 320px;
        gap: 28px;
        align-items: center;
        padding: 34px;
        border-radius: 30px;
        background: var(--ks-navy);
        color: white;
      }

      .ks-partner h2 {
        margin: 0;
        font-size: clamp(30px, 4vw, 48px);
        line-height: 1.08;
      }

      .ks-partner p {
        color: rgba(255, 255, 255, 0.76);
        line-height: 1.7;
      }

      .ks-slots {
        border-radius: 24px;
        background: white;
        color: var(--ks-navy);
        padding: 24px;
      }

      .ks-slots strong {
        display: block;
        font-size: 58px;
        line-height: 1;
      }

      .ks-benefits {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 12px;
      }

      .ks-benefit {
        padding: 18px;
        border-radius: 18px;
        background: white;
        border: 1px solid var(--ks-line);
        color: var(--ks-muted);
        line-height: 1.56;
        font-weight: 700;
      }

      .ks-pricing {
        display: grid;
        grid-template-columns: 0.9fr 1.1fr;
        gap: 20px;
        align-items: stretch;
      }

      .ks-price-card {
        padding: 28px;
        border-radius: 26px;
        border: 1px solid var(--ks-line);
        background: white;
      }

      .ks-price-card.featured {
        background: var(--ks-green);
        color: white;
        border-color: transparent;
      }

      .ks-price-card h3 {
        margin: 0;
        font-size: 24px;
      }

      .ks-price {
        margin: 20px 0;
        font-size: 36px;
        font-weight: 950;
        letter-spacing: 0;
      }

      .ks-price-card p,
      .ks-price-card li {
        line-height: 1.65;
      }

      .ks-price-card:not(.featured) p,
      .ks-price-card:not(.featured) li {
        color: var(--ks-muted);
      }

      .ks-price-card.featured p,
      .ks-price-card.featured li {
        color: rgba(255, 255, 255, 0.82);
      }

      .ks-price-card ul {
        margin: 18px 0 0;
        padding-left: 18px;
      }

      .ks-faq {
        display: grid;
        gap: 12px;
      }

      .ks-faq details {
        border: 1px solid var(--ks-line);
        border-radius: 18px;
        background: white;
        padding: 18px 20px;
      }

      .ks-faq summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        cursor: pointer;
        color: var(--ks-navy);
        font-weight: 850;
        list-style: none;
      }

      .ks-faq summary::-webkit-details-marker {
        display: none;
      }

      .ks-faq p {
        margin: 12px 0 0;
        color: var(--ks-muted);
        line-height: 1.65;
      }

      .ks-cta {
        padding: 72px 0;
        background: var(--ks-navy);
        color: white;
        text-align: center;
      }

      .ks-cta h2 {
        margin: 0 auto;
        max-width: 760px;
        font-size: clamp(34px, 5vw, 58px);
        line-height: 1.05;
        letter-spacing: 0;
      }

      .ks-cta p {
        max-width: 620px;
        margin: 18px auto 28px;
        color: rgba(255, 255, 255, 0.74);
        line-height: 1.7;
      }

      .ks-footer {
        background: #061729;
        color: rgba(255, 255, 255, 0.72);
        padding: 34px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }

      .ks-footer-inner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
      }

      .ks-footer-brand {
        display: flex;
        align-items: center;
        gap: 12px;
        color: #ffffff;
        font-weight: 900;
      }

      .ks-footer-mark {
        width: 38px;
        height: 38px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        background: var(--ks-green);
      }

      .ks-footer-logo {
        width: 27px;
        height: 27px;
        object-fit: contain;
      }

      .ks-footer-tagline {
        margin: 6px 0 0;
        font-weight: 700;
      }

      @media (max-width: 980px) {
        .ks-nav-links {
          display: none;
        }

        .ks-hero-grid,
        .ks-two-col,
        .ks-mockup-grid,
        .ks-partner,
        .ks-pricing {
          grid-template-columns: 1fr;
        }

        .ks-hero-visual {
          max-width: 680px;
          margin: 0 auto;
        }

        .ks-modules {
          grid-template-columns: repeat(2, 1fr);
        }

        .ks-benefits {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @media (max-width: 640px) {
        .ks-container {
          width: min(100% - 28px, 1120px);
        }

        .ks-nav-inner {
          height: 68px;
        }

        .ks-brand span:last-child {
          font-size: 15px;
        }

        .ks-hero {
          padding: 44px 0 42px;
        }

        .ks-hero p {
          font-size: 16px;
        }

        .ks-hero-actions .ks-button {
          width: 100%;
        }

        .ks-modules,
        .ks-benefits {
          grid-template-columns: 1fr;
        }

        .ks-footer-inner {
          align-items: flex-start;
          flex-direction: column;
        }

        .ks-section {
          padding: 52px 0;
        }

        .ks-partner,
        .ks-mockup-band {
          padding: 20px;
          border-radius: 24px;
        }
      }
    `}</style>
  );
}

function CheckItem({ children }) {
  return (
    <div className="ks-list-item">
      <span className="ks-list-icon">
        <FaCheck size={12} />
      </span>
      <span>{children}</span>
    </div>
  );
}

export default function FoundingPartnerPage() {
  const contact = usePublicWebsiteContact();
  const whatsappUrl = buildWhatsAppUrl(contact.whatsapp);

  return (
    <main className="ks-landing">
      <Seo
        title="Founding Partner KlikPesantren | Program 5 Pesantren Awal"
        description="Program Founding Partner KlikPesantren untuk pesantren yang ingin ikut fase awal digitalisasi administrasi santri, keuangan, RFID, dan Wali Santri App."
        path="/founding-partner"
        jsonLd={breadcrumbJsonLd([
          { name: "Beranda", path: "/" },
          { name: "Founding Partner", path: "/founding-partner" },
        ])}
      />
      <LandingStyles />

      <header className="ks-nav">
        <div className="ks-container ks-nav-inner">
          <a className="ks-brand" href="#hero" aria-label="KlikPesantren">
            <span className="ks-brand-mark">
              <img className="ks-brand-logo" src="/landing/logo.png" alt="" />
            </span>
            <span>KlikPesantren</span>
          </a>
          <nav className="ks-nav-links" aria-label="Navigasi landing">
            <a href="#solusi">Solusi</a>
            <a href="#modul">Modul</a>
            <a href="#founding">Founding Partner</a>
            <a href="#harga">Harga</a>
            <a href="#faq">FAQ</a>
          </nav>
          <a className="ks-button ks-button-primary" href={whatsappUrl || undefined} aria-disabled={!whatsappUrl} target="_blank" rel="noreferrer">
            <FaWhatsapp /> Konsultasi
          </a>
        </div>
      </header>

      <section className="ks-hero" id="hero">
        <div className="ks-container ks-hero-grid">
          <div>
            <div className="ks-kicker">
              <img className="ks-kicker-logo" src="/landing/logo.png" alt="" /> Platform administrasi pesantren modern
            </div>
            <h1>Digitalisasi Pesantren Dimulai dari Sini</h1>
            <p>
              KlikPesantren adalah platform administrasi pesantren modern untuk
              mengelola data santri, keuangan, RFID, perizinan, pelanggaran,
              dashboard, dan komunikasi wali dalam satu ekosistem SaaS.
            </p>
            <div className="ks-hero-actions">
              <a className="ks-button ks-button-primary" href={whatsappUrl || undefined} aria-disabled={!whatsappUrl} target="_blank" rel="noreferrer">
                Daftar Founding Partner <FaArrowRight />
              </a>
              <a className="ks-button ks-button-soft" href="#mockup">
                Lihat Gambaran Sistem
              </a>
            </div>
            <div className="ks-trust-row">
              <span><FaCheck /> SaaS untuk operasional pesantren</span>
              <span><FaCheck /> Web admin + Wali Santri App</span>
              <span><FaCheck /> Siap multi tenant</span>
            </div>
          </div>

          <div className="ks-hero-visual" aria-label="Mockup dashboard KlikPesantren">
            <img
              className="ks-dashboard-image"
              src="/landing/dashboard-admin.png"
              alt="Mockup dashboard admin KlikPesantren"
              fetchPriority="high"
            />
          </div>
        </div>
      </section>

      <section className="ks-section ks-section-alt" id="masalah">
        <div className="ks-container ks-two-col">
          <div className="ks-section-head">
            <div className="ks-kicker">Tantangan Operasional</div>
            <h2>Administrasi yang penting sering tersendat karena terlalu banyak tempat kerja.</h2>
            <p>
              Pesantren bergerak cepat setiap hari. Data, pembayaran, izin,
              kesehatan, dan komunikasi wali perlu satu alur yang lebih tenang.
            </p>
          </div>
          <div className="ks-list">
            {problemItems.map((item) => (
              <CheckItem key={item}>{item}</CheckItem>
            ))}
          </div>
        </div>
      </section>

      <section className="ks-section" id="solusi">
        <div className="ks-container ks-two-col">
          <div className="ks-solution-panel">
            <h3>Satu pusat kerja untuk pengurus, operator, unit, dan wali santri.</h3>
            <p>
              KlikPesantren menyatukan administrasi inti pesantren dalam platform
              yang bisa dipakai bertahap, sesuai kesiapan tim dan kebutuhan
              lembaga.
            </p>
            <div className="ks-solution-steps">
              <div>1. Rapikan data santri dan wali</div>
              <div>2. Aktifkan pembayaran dan laporan</div>
              <div>3. Hubungkan informasi ke APK wali</div>
            </div>
          </div>
          <div className="ks-section-head">
            <div className="ks-kicker">Tentang KlikPesantren</div>
            <h2>Startup SaaS untuk pesantren yang ingin bekerja lebih cepat dan terukur.</h2>
            <p>
              KlikPesantren membantu lembaga pendidikan pesantren merapikan
              administrasi, menyambungkan informasi ke wali santri, dan memberi
              pimpinan visibilitas operasional tanpa mengubah budaya kerja yang
              sudah berjalan.
            </p>
            <div className="ks-hero-actions">
              <a className="ks-button ks-button-dark" href={whatsappUrl || undefined} aria-disabled={!whatsappUrl} target="_blank" rel="noreferrer">
                Bicara Kebutuhan Pesantren
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="ks-section ks-section-alt" id="modul">
        <div className="ks-container">
          <div className="ks-section-head center">
            <div className="ks-kicker">Modul Utama</div>
            <h2>Fitur inti untuk operasional pesantren modern.</h2>
            <p>
              Dari administrasi santri sampai multi tenant, semua dirancang
              untuk membantu tim pesantren bekerja lebih rapi, cepat, dan
              transparan.
            </p>
          </div>
          <div className="ks-modules">
            {modules.map((module) => (
              <article className="ks-module-card" key={module.title}>
                <div className="ks-module-icon">{module.icon}</div>
                <h3>{module.title}</h3>
                <p>{module.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="ks-section" id="mockup">
        <div className="ks-container">
          <div className="ks-section-head center">
            <div className="ks-kicker">Produk</div>
            <h2>Tampilan admin dan Wali Santri App yang siap untuk kerja harian.</h2>
            <p>
              Dashboard admin membantu operator dan pimpinan memantau data,
              sementara aplikasi wali menjaga komunikasi tetap cepat dan jelas.
            </p>
          </div>
          <div className="ks-mockup-band">
            <div className="ks-mockup-grid">
              <div className="ks-app-window">
                <img
                  className="ks-dashboard-image"
                  src="/landing/dashboard-admin.png"
                  alt="Screenshot dashboard admin KlikPesantren"
                  loading="lazy"
                />
              </div>
              <div className="ks-phone">
                <img
                  className="ks-phone-image"
                  src="/landing/wali-app.png"
                  alt="Mockup APK Wali Santri KlikPesantren"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="ks-section ks-section-cream" id="founding">
        <div className="ks-container">
          <div className="ks-partner">
            <div>
              <div className="ks-kicker">Program Terbatas</div>
              <h2>Founding Partner KlikPesantren untuk 5 pesantren pertama.</h2>
              <p>
                Kami membuka kolaborasi awal untuk pesantren yang ingin ikut
                membangun sistem administrasi digital yang benar-benar cocok
                dengan kebutuhan lapangan.
              </p>
              <a className="ks-button ks-button-primary" href={whatsappUrl || undefined} aria-disabled={!whatsappUrl} target="_blank" rel="noreferrer">
                Ambil Slot Founding Partner <FaWhatsapp />
              </a>
            </div>
            <div className="ks-slots">
              <strong>5</strong>
              <p>slot pesantren pertama untuk fase Founding Partner.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="ks-section" id="benefit">
        <div className="ks-container">
          <div className="ks-section-head center">
            <div className="ks-kicker">Benefit Founding Partner</div>
            <h2>Lebih dekat dengan tim produk, lebih awal merasakan manfaatnya.</h2>
          </div>
          <div className="ks-benefits">
            {benefits.map((benefit) => (
              <div className="ks-benefit" key={benefit}>{benefit}</div>
            ))}
          </div>
        </div>
      </section>

      <section className="ks-section ks-section-alt" id="harga">
        <div className="ks-container">
          <div className="ks-section-head center">
            <div className="ks-kicker">Paket</div>
            <h2>Mulai sesuai kebutuhan, berkembang bersama operasional pesantren.</h2>
            <p>
              Untuk tahap awal, Founding Partner akan mendapatkan penawaran
              khusus setelah sesi konsultasi kebutuhan.
            </p>
          </div>
          <div className="ks-pricing">
            <article className="ks-price-card">
              <h3>Paket Reguler</h3>
              <div className="ks-price">Segera</div>
              <p>Paket standar untuk pesantren setelah fase awal berjalan.</p>
              <ul>
                <li>Admin web</li>
                <li>Modul inti pesantren</li>
                <li>APK wali santri</li>
              </ul>
            </article>
            <article className="ks-price-card featured">
              <h3>Founding Partner</h3>
              <div className="ks-price">Khusus 5 awal</div>
              <p>Harga dan onboarding khusus untuk pesantren pertama yang ikut membangun KlikPesantren.</p>
              <ul>
                <li>Prioritas setup awal</li>
                <li>Pendampingan implementasi</li>
                <li>Masukan prioritas untuk roadmap</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="ks-section" id="faq">
        <div className="ks-container">
          <div className="ks-section-head center">
            <div className="ks-kicker">FAQ</div>
            <h2>Pertanyaan yang sering muncul sebelum mulai.</h2>
          </div>
          <div className="ks-faq">
            {faqs.map((item) => (
              <details key={item.question}>
                <summary>
                  {item.question}
                  <FaChevronDown />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="ks-cta" id="kontak">
        <div className="ks-container">
          <h2>Siap jadi salah satu dari 5 Founding Partner KlikPesantren?</h2>
          <p>
            Ceritakan kondisi pesantren, modul yang paling dibutuhkan, dan target
            implementasi. Tim KlikPesantren akan bantu susun langkah awalnya.
          </p>
          <a className="ks-button ks-button-primary" href={whatsappUrl || undefined} aria-disabled={!whatsappUrl} target="_blank" rel="noreferrer">
            Hubungi via WhatsApp <FaWhatsapp />
          </a>
        </div>
      </section>

      <footer className="ks-footer">
        <div className="ks-container ks-footer-inner">
          <div>
            <div className="ks-footer-brand">
              <span className="ks-footer-mark">
                <img className="ks-footer-logo" src="/landing/logo.png" alt="" />
              </span>
              <span>KlikPesantren</span>
            </div>
            <p className="ks-footer-tagline">Satu Klik, Semua Terhubung.</p>
          </div>
          <div>Platform administrasi pesantren modern.</div>
        </div>
      </footer>
    </main>
  );
}
