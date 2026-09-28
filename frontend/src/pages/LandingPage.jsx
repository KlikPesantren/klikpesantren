import {
  FaArrowRight,
  FaChartLine,
  FaCheck,
  FaClipboardCheck,
  FaCreditCard,
  FaGraduationCap,
  FaLayerGroup,
  FaMobileAlt,
  FaRegBell,
  FaShieldAlt,
  FaUserCheck,
} from "react-icons/fa";
import { Link } from "react-router-dom";
import PublicLayout from "../components/public/PublicLayout";
import Seo, { homepageJsonLd } from "../components/public/Seo";
import { useWebsiteContent } from "../context/WebsiteContentContext";

const STATIC_WEBSITE_CONTENT = {
  brand: {
    website_name: "KlikPesantren",
    tagline: "Platform administrasi pesantren modern",
  },
  seo: {
    default_title: "KlikPesantren | Platform SaaS Operasional Pesantren Modern",
    default_description:
      "KlikPesantren membantu pesantren mengelola administrasi santri, keuangan, Wali Santri App, RFID, perizinan, pelanggaran, dan dashboard operasional.",
  },
  homepage: {
    hero_title: "Platform SaaS untuk Operasional Pesantren Modern",
    hero_subtitle:
      "KlikPesantren membantu pesantren mengelola administrasi santri, keuangan, wali santri, RFID, perizinan, pelanggaran, dan dashboard operasional dalam satu sistem terintegrasi.",
    primary_cta_label: "Minta Demo",
    primary_cta_url: "/demo",
    secondary_cta_label: "Daftar Founding Partner",
    secondary_cta_url: "/founding-partner",
  },
  contact: {
    whatsapp: "6281383919797",
    email: "hello@klikpesantren.com",
    instagram: "https://instagram.com/klikpesantren",
  },
};

const productProof = [
  {
    title: "Web Admin",
    text: "Pusat kerja operator dan pengurus untuk data, tagihan, laporan, dan kontrol operasional.",
  },
  {
    title: "Wali Santri App",
    text: "Akses informasi anak, pengumuman, tagihan, dan notifikasi penting untuk wali santri.",
  },
  {
    title: "RFID",
    text: "Kartu santri, saldo, limit harian, topup, refund, dan riwayat transaksi yang terpantau.",
  },
  {
    title: "Multi Tenant",
    text: "Satu platform untuk banyak pesantren dengan data, fitur, dan akses yang terpisah.",
  },
];

const problems = [
  "Data santri, wali, kelas, dan status administrasi masih tersebar di banyak tempat.",
  "Pembayaran, perizinan, pelanggaran, dan RFID sulit dipantau secara cepat.",
  "Wali santri menunggu informasi karena komunikasi belum terhubung ke sistem.",
  "Pimpinan membutuhkan ringkasan operasional tanpa menambah beban operator.",
];

const features = [
  {
    icon: <FaGraduationCap />,
    title: "Administrasi Santri",
    text: "Data santri, wali, kelas, status, dan riwayat penting dalam satu pusat data.",
  },
  {
    icon: <FaCreditCard />,
    title: "Keuangan Pesantren",
    text: "Tagihan, pembayaran, sahriyah, buku kas, kwitansi, dan laporan keuangan.",
  },
  {
    icon: <FaShieldAlt />,
    title: "RFID",
    text: "Transaksi kartu santri, merchant, topup, refund, limit, dan audit mutasi.",
  },
  {
    icon: <FaMobileAlt />,
    title: "Wali Santri App",
    text: "Aplikasi wali untuk memantau kabar anak, tagihan, pengumuman, dan notifikasi.",
  },
  {
    icon: <FaUserCheck />,
    title: "Perizinan",
    text: "Pengajuan, approval, dan monitoring izin santri dengan status yang jelas.",
  },
  {
    icon: <FaClipboardCheck />,
    title: "Pelanggaran",
    text: "Catatan kedisiplinan, pembinaan, dan rekap pelanggaran per periode.",
  },
  {
    icon: <FaChartLine />,
    title: "Dashboard",
    text: "Ringkasan operasional, keuangan, akademik, dan kedisiplinan untuk pimpinan.",
  },
  {
    icon: <FaLayerGroup />,
    title: "Multi Tenant",
    text: "Arsitektur SaaS untuk banyak pesantren dengan ruang data yang terpisah.",
  },
];

const reasons = [
  "Modular, sehingga pesantren bisa mulai dari kebutuhan paling mendesak.",
  "Dirancang untuk kerja harian operator, pengurus, bendahara, dan pimpinan.",
  "Menghubungkan web admin, app wali, RFID, dan dashboard dalam satu ekosistem.",
  "Siap berkembang dari satu unit operasional menuju banyak tenant dan unit.",
];

function mergeWebsiteContent(content = {}) {
  return {
    ...STATIC_WEBSITE_CONTENT,
    ...content,
    brand: { ...STATIC_WEBSITE_CONTENT.brand, ...(content.brand || {}) },
    seo: { ...STATIC_WEBSITE_CONTENT.seo, ...(content.seo || {}) },
    homepage: {
      ...STATIC_WEBSITE_CONTENT.homepage,
      ...(content.homepage || {}),
    },
    contact: { ...STATIC_WEBSITE_CONTENT.contact, ...(content.contact || {}) },
  };
}

function HomepageStyles() {
  return (
    <style>{`
      .kp-home {
        background: #ffffff;
      }

      .kp-home-hero {
        position: relative;
        overflow: hidden;
        padding: 86px 0 70px;
        background:
          linear-gradient(180deg, rgba(236, 253, 245, 0.78) 0%, rgba(255, 255, 255, 0) 54%),
          #ffffff;
      }

      .kp-hero-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(360px, 0.9fr);
        align-items: center;
        gap: 56px;
      }

      .kp-eyebrow {
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

      .kp-home h1,
      .kp-home h2,
      .kp-home h3 {
        margin: 0;
        color: #0f172a;
        letter-spacing: 0;
      }

      .kp-home h1 {
        max-width: 760px;
        margin-top: 18px;
        font-size: clamp(42px, 6vw, 76px);
        line-height: 0.98;
        font-weight: 950;
      }

      .kp-hero-copy {
        max-width: 670px;
        margin: 24px 0 0;
        color: #475569;
        font-size: 18px;
        line-height: 1.75;
      }

      .kp-hero-actions,
      .kp-section-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 13px;
        margin-top: 30px;
      }

      .kp-hero-trust {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 34px;
      }

      .kp-hero-trust span {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.78);
        padding: 13px 14px;
        color: #334155;
        font-size: 13px;
        font-weight: 800;
      }

      .kp-hero-trust svg {
        color: #0b5d3a;
      }

      .kp-hero-visual {
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 28px;
        background: #0b1220;
        padding: 16px;
        box-shadow: 0 34px 80px rgba(15, 23, 42, 0.2);
      }

      .kp-hero-visual img,
      .kp-preview-window img,
      .kp-phone-frame img {
        display: block;
        width: 100%;
        height: auto;
      }

      .kp-hero-visual img {
        border-radius: 20px;
      }

      .kp-section {
        padding: 76px 0;
      }

      .kp-section-muted {
        background: #f8fafc;
      }

      .kp-section-head {
        max-width: 760px;
        margin-bottom: 34px;
      }

      .kp-section-head.center {
        margin-left: auto;
        margin-right: auto;
        text-align: center;
      }

      .kp-section-head h2 {
        font-size: clamp(30px, 4vw, 48px);
        line-height: 1.08;
        font-weight: 950;
      }

      .kp-section-head p {
        margin: 16px 0 0;
        color: #64748b;
        font-size: 16px;
        line-height: 1.75;
      }

      .kp-proof-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
      }

      .kp-proof-card,
      .kp-feature-card,
      .kp-reason-card,
      .kp-teaser-card {
        border: 1px solid rgba(15, 23, 42, 0.09);
        border-radius: 20px;
        background: #ffffff;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.04);
      }

      .kp-proof-card {
        padding: 22px;
      }

      .kp-proof-card strong {
        display: block;
        color: #0f172a;
        font-size: 17px;
      }

      .kp-proof-card p {
        margin: 10px 0 0;
        color: #64748b;
        font-size: 14px;
        line-height: 1.65;
      }

      .kp-two-col {
        display: grid;
        grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
        align-items: start;
        gap: 38px;
      }

      .kp-list {
        display: grid;
        gap: 12px;
      }

      .kp-list-item {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        border: 1px solid rgba(15, 23, 42, 0.09);
        border-radius: 18px;
        background: #ffffff;
        padding: 17px 18px;
        color: #475569;
        font-weight: 700;
        line-height: 1.6;
      }

      .kp-list-icon {
        width: 28px;
        height: 28px;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        border-radius: 999px;
        background: #ecfdf5;
        color: #0b5d3a;
      }

      .kp-solution-panel {
        border-radius: 28px;
        background: #0b1220;
        color: #ffffff;
        padding: 30px;
      }

      .kp-solution-panel h3 {
        color: #ffffff;
        font-size: 28px;
        line-height: 1.2;
      }

      .kp-solution-panel p {
        margin: 16px 0 0;
        color: rgba(255, 255, 255, 0.72);
        line-height: 1.75;
      }

      .kp-solution-steps {
        display: grid;
        gap: 12px;
        margin-top: 24px;
      }

      .kp-solution-steps div {
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.08);
        padding: 14px 16px;
        font-weight: 800;
      }

      .kp-feature-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
      }

      .kp-feature-card {
        padding: 22px;
      }

      .kp-feature-icon {
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

      .kp-feature-card h3 {
        font-size: 18px;
        line-height: 1.25;
      }

      .kp-feature-card p {
        margin: 10px 0 0;
        color: #64748b;
        font-size: 14px;
        line-height: 1.65;
      }

      .kp-preview {
        border-radius: 30px;
        background: #0b1220;
        padding: 18px;
        box-shadow: 0 30px 72px rgba(15, 23, 42, 0.2);
      }

      .kp-preview-grid {
        display: grid;
        grid-template-columns: 1.1fr 0.55fr;
        gap: 18px;
        align-items: center;
      }

      .kp-preview-window {
        overflow: hidden;
        border-radius: 22px;
        background: #ffffff;
      }

      .kp-phone-frame {
        width: min(230px, 100%);
        justify-self: center;
        border-radius: 34px;
        background: #111827;
        padding: 11px;
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28);
      }

      .kp-phone-frame img {
        border-radius: 25px;
      }

      .kp-reason-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
      }

      .kp-reason-card {
        padding: 20px;
        color: #475569;
        font-weight: 750;
        line-height: 1.6;
      }

      .kp-teaser-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 18px;
      }

      .kp-teaser-card {
        padding: 28px;
      }

      .kp-teaser-card.accent {
        background: #0b5d3a;
        color: #ffffff;
        border-color: transparent;
      }

      .kp-teaser-card h3 {
        font-size: 25px;
        line-height: 1.2;
      }

      .kp-teaser-card.accent h3 {
        color: #ffffff;
      }

      .kp-teaser-card p {
        margin: 14px 0 0;
        color: #64748b;
        line-height: 1.7;
      }

      .kp-teaser-card.accent p {
        color: rgba(255, 255, 255, 0.78);
      }

      .kp-final-cta {
        padding: 78px 0;
        background: #0b1220;
        color: #ffffff;
        text-align: center;
      }

      .kp-final-cta h2 {
        max-width: 800px;
        margin: 0 auto;
        color: #ffffff;
        font-size: clamp(34px, 5vw, 58px);
        line-height: 1.06;
        font-weight: 950;
      }

      .kp-final-cta p {
        max-width: 660px;
        margin: 18px auto 0;
        color: rgba(255, 255, 255, 0.72);
        line-height: 1.75;
      }

      .kp-final-actions {
        display: flex;
        justify-content: center;
        flex-wrap: wrap;
        gap: 13px;
        margin-top: 30px;
      }

      @media (max-width: 980px) {
        .kp-hero-grid,
        .kp-two-col,
        .kp-preview-grid,
        .kp-teaser-grid {
          grid-template-columns: 1fr;
        }

        .kp-proof-grid,
        .kp-feature-grid,
        .kp-reason-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .kp-hero-visual {
          max-width: 720px;
          margin: 0 auto;
        }
      }

      @media (max-width: 640px) {
        .kp-home-hero {
          padding: 52px 0 48px;
        }

        .kp-home h1 {
          font-size: 42px;
        }

        .kp-hero-copy {
          font-size: 16px;
        }

        .kp-hero-actions .kp-btn,
        .kp-section-actions .kp-btn,
        .kp-final-actions .kp-btn {
          width: 100%;
        }

        .kp-hero-trust,
        .kp-proof-grid,
        .kp-feature-grid,
        .kp-reason-grid {
          grid-template-columns: 1fr;
        }

        .kp-section {
          padding: 56px 0;
        }

        .kp-preview,
        .kp-solution-panel,
        .kp-teaser-card {
          border-radius: 24px;
          padding: 22px;
        }
      }
    `}</style>
  );
}

function CheckItem({ children }) {
  return (
    <div className="kp-list-item">
      <span className="kp-list-icon">
        <FaCheck size={12} />
      </span>
      <span>{children}</span>
    </div>
  );
}

export default function LandingPage() {
  const websiteContent = mergeWebsiteContent(useWebsiteContent());
  const homepage = websiteContent.homepage;
  const hero = { ...homepage, ...(homepage.hero || {}) };
  const campaignEnabled = websiteContent.campaign?.enabled !== false;
  const homepageSections = homepage.sections || {};
  const proofSection = homepageSections.proof || {};
  const problemSection = homepageSections.problems || {};
  const solutionSection = homepageSections.solution || {};
  const featureSection = homepageSections.features || {};
  const previewSection = homepageSections.preview || {};
  const reasonSection = homepageSections.reasons || {};
  const pricingTeaser = homepageSections.pricing_teaser || {};
  const campaignTeaser = homepageSections.campaign_teaser || {};
  const finalCta = homepageSections.final_cta || {};

  return (
    <PublicLayout>
      <Seo
        title={websiteContent.seo.default_title}
        description={websiteContent.seo.default_description}
        image={websiteContent.seo.og_image_url}
        canonicalBaseUrl={websiteContent.seo.canonical_base_url}
        path="/"
        jsonLd={homepageJsonLd}
      />
      <main className="kp-home">
        <HomepageStyles />

        <section className="kp-home-hero">
          <div className="kp-shell kp-hero-grid">
            <div>
              <div className="kp-eyebrow">
                <FaRegBell /> {hero.eyebrow || "SaaS operasional pesantren"}
              </div>
              <h1>{hero.title || hero.hero_title}</h1>
              <p className="kp-hero-copy">
                {hero.subtitle || hero.hero_subtitle}
              </p>
              <div className="kp-hero-actions">
                <Link className="kp-btn kp-btn-primary" to={hero.primary_cta_url || "/demo"}>
                  {hero.primary_cta_label} <FaArrowRight />
                </Link>
                {campaignEnabled && hero.secondary_cta_enabled !== false ? (
                  <Link className="kp-btn kp-btn-secondary" to={hero.secondary_cta_url || "/founding-partner"}>
                    {hero.secondary_cta_label}
                  </Link>
                ) : null}
              </div>
              <div className="kp-hero-trust">
                <span><FaCheck /> Web Admin</span>
                <span><FaCheck /> Wali Santri App</span>
                <span><FaCheck /> RFID & Multi Tenant</span>
              </div>
            </div>

            <div className="kp-hero-visual" aria-label="Dashboard KlikPesantren">
              <img
                src={hero.image_url || "/landing/dashboard-admin.png"}
                alt="Dashboard admin KlikPesantren"
                fetchPriority="high"
              />
            </div>
          </div>
        </section>

        {homepageSections.proof?.enabled !== false ? <section className="kp-section">
          <div className="kp-shell">
            <div className="kp-section-head center">
              <div className="kp-eyebrow">{proofSection.eyebrow || "Product Proof"}</div>
              <h2>{proofSection.title || "Satu ekosistem untuk kerja harian pesantren."}</h2>
              <p>
                {proofSection.description || "KlikPesantren menghubungkan tim internal pesantren, wali santri, dan perangkat operasional dalam alur yang lebih rapi."}
              </p>
            </div>
            <div className="kp-proof-grid">
              {(proofSection.items || productProof).map((item) => (
                <article className="kp-proof-card" key={item.title}>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section> : null}

        {homepageSections.problems?.enabled !== false ? <section className="kp-section kp-section-muted">
          <div className="kp-shell kp-two-col">
            <div className="kp-section-head">
              <div className="kp-eyebrow">{problemSection.eyebrow || "Problem"}</div>
              <h2>{problemSection.title || "Operasional pesantren sering berat karena informasi tersebar."}</h2>
              <p>
                {problemSection.description || "Banyak pekerjaan penting berjalan paralel setiap hari. Ketika data, transaksi, dan komunikasi tidak berada di satu sistem, keputusan menjadi lebih lambat."}
              </p>
            </div>
            <div className="kp-list">
              {(problemSection.items || problems).map((item) => (
                <CheckItem key={item}>{item}</CheckItem>
              ))}
            </div>
          </div>
        </section> : null}

        {solutionSection.enabled !== false ? <section className="kp-section">
          <div className="kp-shell kp-two-col">
            <div className="kp-solution-panel">
              <h3>{solutionSection.panel_title || "Dari pencatatan tersebar menjadi sistem kerja terintegrasi."}</h3>
              <p>
                {solutionSection.panel_description || "KlikPesantren membantu pesantren memulai digitalisasi secara bertahap, dari data santri dan pembayaran sampai app wali, RFID, dan dashboard pimpinan."}
              </p>
              <div className="kp-solution-steps">
                <div>1. Rapikan data inti santri dan wali.</div>
                <div>2. Hubungkan pembayaran, izin, dan kedisiplinan.</div>
                <div>3. Pantau operasional lewat dashboard dan app wali.</div>
              </div>
            </div>
            <div className="kp-section-head">
              <div className="kp-eyebrow">{solutionSection.eyebrow || "Solution"}</div>
              <h2>{solutionSection.title || "Platform SaaS yang mengikuti cara kerja pesantren."}</h2>
              <p>
                {solutionSection.description || "Bukan website sekolah dan bukan profil yayasan. KlikPesantren adalah produk operasional untuk pengurus, operator, bendahara, pimpinan, dan wali santri."}
              </p>
              <div className="kp-section-actions">
                <Link className="kp-btn kp-btn-primary" to={solutionSection.cta_url || "/fitur"}>
                  {solutionSection.cta_label || "Lihat Fitur"} <FaArrowRight />
                </Link>
              </div>
            </div>
          </div>
        </section> : null}

        {homepageSections.features?.enabled !== false ? <section className="kp-section kp-section-muted">
          <div className="kp-shell">
            <div className="kp-section-head center">
              <div className="kp-eyebrow">{featureSection.eyebrow || "Fitur Utama"}</div>
              <h2>{featureSection.title || "Modul inti untuk operasional pesantren modern."}</h2>
              <p>
                {featureSection.description || "Fitur disusun dari kebutuhan produk yang sudah ada agar pesantren bisa mulai dari administrasi dasar dan berkembang bertahap."}
              </p>
            </div>
            <div className="kp-feature-grid">
              {features.map((feature, index) => {
                const configuredFeature = featureSection.items?.[index] || {};
                return (
                <article className="kp-feature-card" key={feature.title}>
                  <div className="kp-feature-icon">{feature.icon}</div>
                  <h3>{configuredFeature.title || feature.title}</h3>
                  <p>{configuredFeature.text || feature.text}</p>
                </article>
                );
              })}
            </div>
          </div>
        </section> : null}

        {homepageSections.preview?.enabled !== false ? <section className="kp-section">
          <div className="kp-shell">
            <div className="kp-section-head center">
              <div className="kp-eyebrow">{previewSection.eyebrow || "Product Preview"}</div>
              <h2>{previewSection.title || "Web admin dan aplikasi wali dalam satu alur operasional."}</h2>
              <p>
                {previewSection.description || "Dashboard membantu tim internal memantau pekerjaan, sementara aplikasi wali menjaga informasi tetap sampai ke orang tua."}
              </p>
            </div>
            <div className="kp-preview">
              <div className="kp-preview-grid">
                <div className="kp-preview-window">
                  <img
                    src={previewSection.admin_image_url || "/landing/dashboard-admin.png"}
                    alt="Preview web admin KlikPesantren"
                    loading="lazy"
                  />
                </div>
                <div className="kp-phone-frame">
                  <img
                    src={previewSection.wali_image_url || "/landing/wali-app.png"}
                    alt="Preview Wali Santri App KlikPesantren"
                    loading="lazy"
                  />
                </div>
              </div>
            </div>
          </div>
        </section> : null}

        {homepageSections.reasons?.enabled !== false ? <section className="kp-section kp-section-muted">
          <div className="kp-shell">
            <div className="kp-section-head center">
              <div className="kp-eyebrow">{reasonSection.eyebrow || "Why KlikPesantren"}</div>
              <h2>{reasonSection.title || "Dibangun sebagai produk SaaS, bukan sekadar halaman profil."}</h2>
            </div>
            <div className="kp-reason-grid">
              {(reasonSection.items || reasons).map((item) => (
                <div className="kp-reason-card" key={item}>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section> : null}

        <section className="kp-section">
          <div className="kp-shell kp-teaser-grid">
            {pricingTeaser.enabled !== false ? <article className="kp-teaser-card">
              <h3>{pricingTeaser.title || "Paket dibuat bertahap sesuai kebutuhan pesantren."}</h3>
              <p>
                {pricingTeaser.description || "Mulai dari modul dasar, lalu berkembang ke perizinan, pelanggaran, sahriyah, RFID, Wali App, dan kebutuhan custom."}
              </p>
              <div className="kp-section-actions">
                <Link className="kp-btn kp-btn-secondary" to={pricingTeaser.cta_url || "/harga"}>
                  {pricingTeaser.cta_label || "Lihat Harga"}
                </Link>
              </div>
            </article> : null}
            {campaignEnabled && homepageSections.campaign_teaser?.enabled !== false ? <article className="kp-teaser-card accent">
              <h3>{campaignTeaser.title || "Program Founding Partner tetap tersedia."}</h3>
              <p>
                {campaignTeaser.description || "Campaign lama dipertahankan untuk pesantren yang ingin ikut fase awal dan mendapatkan pendampingan prioritas."}
              </p>
              <div className="kp-section-actions">
                <Link className="kp-btn kp-btn-secondary" to={campaignTeaser.cta_url || "/founding-partner"}>
                  {campaignTeaser.cta_label || "Daftar Founding Partner"}
                </Link>
              </div>
            </article> : null}
          </div>
        </section>

        {finalCta.enabled !== false ? <section className="kp-final-cta">
          <div className="kp-shell">
            <h2>{finalCta.title || "Siap melihat bagaimana KlikPesantren bekerja untuk operasional harian?"}</h2>
            <p>
              {finalCta.description || "Jadwalkan demo untuk melihat alur admin, keuangan, RFID, app wali, dan dashboard sesuai kebutuhan pesantren."}
            </p>
            <div className="kp-final-actions">
              <Link className="kp-btn kp-btn-primary" to={finalCta.primary_url || "/demo"}>
                {finalCta.primary_label || "Minta Demo"} <FaArrowRight />
              </Link>
              {campaignEnabled ? <Link className="kp-btn kp-btn-secondary" to={finalCta.secondary_url || "/founding-partner"}>
                {finalCta.secondary_label || "Daftar Founding Partner"}
              </Link> : null}
            </div>
          </div>
        </section> : null}
      </main>
    </PublicLayout>
  );
}
