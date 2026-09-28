import { useState } from "react";
import { FaBars, FaTimes } from "react-icons/fa";
import { Link, NavLink } from "react-router-dom";
import { useWebsiteContent } from "../../context/WebsiteContentContext";

const navItems = [
  { label: "Fitur", to: "/fitur" },
  { label: "Harga", to: "/harga" },
  { label: "Demo", to: "/demo" },
  { label: "Founding Partner", to: "/founding-partner" },
  { label: "Tentang", to: "/tentang" },
  { label: "Blog", to: "/blog" },
  { label: "Kontak", to: "/kontak" },
];

function PublicStyles() {
  return (
    <style>{`
      .kp-public {
        min-height: 100vh;
        background: #ffffff;
        color: #102033;
        font-family: "Plus Jakarta Sans", system-ui, sans-serif;
      }

      .kp-shell {
        width: min(1160px, calc(100% - 40px));
        margin: 0 auto;
      }

      .kp-header {
        position: sticky;
        top: 0;
        z-index: 50;
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(18px);
      }

      .kp-header-inner {
        height: 76px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
      }

      .kp-brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        color: #0f172a;
        text-decoration: none;
        font-size: 17px;
        font-weight: 900;
        letter-spacing: 0;
      }

      .kp-brand-mark {
        width: 42px;
        height: 42px;
        border-radius: 14px;
        display: grid;
        place-items: center;
        background: #0b5d3a;
        box-shadow: 0 14px 32px rgba(11, 93, 58, 0.2);
      }

      .kp-brand-mark img {
        width: 30px;
        height: 30px;
        object-fit: contain;
      }

      .kp-nav {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .kp-nav a {
        display: inline-flex;
        min-height: 38px;
        align-items: center;
        border-radius: 999px;
        padding: 0 13px;
        color: #64748b;
        text-decoration: none;
        font-size: 14px;
        font-weight: 750;
      }

      .kp-nav a.active {
        background: #ecfdf5;
        color: #0b5d3a;
      }

      .kp-header-actions {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .kp-btn {
        display: inline-flex;
        min-height: 44px;
        align-items: center;
        justify-content: center;
        gap: 9px;
        border-radius: 999px;
        border: 1px solid transparent;
        padding: 0 17px;
        font-size: 14px;
        font-weight: 850;
        line-height: 1;
        text-decoration: none;
        cursor: pointer;
      }

      .kp-btn-primary {
        background: #0b5d3a;
        color: #ffffff;
        box-shadow: 0 16px 36px rgba(11, 93, 58, 0.22);
      }

      .kp-btn-secondary {
        background: #ffffff;
        color: #0f172a;
        border-color: rgba(15, 23, 42, 0.12);
      }

      .kp-mobile-toggle {
        display: none;
        width: 44px;
        height: 44px;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 999px;
        background: #ffffff;
        color: #0f172a;
      }

      .kp-mobile-panel {
        display: none;
        border-top: 1px solid rgba(15, 23, 42, 0.08);
        background: #ffffff;
      }

      .kp-mobile-panel.open {
        display: block;
      }

      .kp-mobile-links {
        display: grid;
        gap: 6px;
        padding: 12px 0 18px;
      }

      .kp-mobile-links a {
        border-radius: 14px;
        padding: 13px 14px;
        color: #334155;
        text-decoration: none;
        font-weight: 800;
      }

      .kp-mobile-links a.active {
        background: #ecfdf5;
        color: #0b5d3a;
      }

      .kp-footer {
        border-top: 1px solid rgba(15, 23, 42, 0.08);
        background: #0b1220;
        color: rgba(255, 255, 255, 0.72);
      }

      .kp-footer-inner {
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
        gap: 38px;
        padding: 46px 0;
      }

      .kp-footer-brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        color: #ffffff;
        font-weight: 900;
      }

      .kp-footer-brand .kp-brand-mark {
        width: 38px;
        height: 38px;
        border-radius: 13px;
      }

      .kp-footer-brand img {
        width: 27px;
        height: 27px;
      }

      .kp-footer p {
        max-width: 480px;
        margin: 14px 0 0;
        color: rgba(255, 255, 255, 0.68);
        line-height: 1.7;
      }

      .kp-footer-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
      }

      .kp-footer h3 {
        margin: 0 0 12px;
        color: #ffffff;
        font-size: 14px;
      }

      .kp-footer a {
        display: block;
        width: fit-content;
        margin-top: 10px;
        color: rgba(255, 255, 255, 0.72);
        text-decoration: none;
        font-size: 14px;
        font-weight: 700;
      }

      .kp-footer-bottom {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding: 18px 0;
        color: rgba(255, 255, 255, 0.55);
        font-size: 13px;
      }

      @media (max-width: 980px) {
        .kp-nav,
        .kp-header-actions {
          display: none;
        }

        .kp-mobile-toggle {
          display: inline-flex;
        }

        .kp-footer-inner {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 640px) {
        .kp-shell {
          width: min(100% - 28px, 1160px);
        }

        .kp-header-inner {
          height: 68px;
        }

        .kp-brand {
          font-size: 15px;
        }

        .kp-brand-mark {
          width: 38px;
          height: 38px;
          border-radius: 13px;
        }

        .kp-brand-mark img {
          width: 27px;
          height: 27px;
        }

        .kp-footer-grid {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}

export default function PublicLayout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const content = useWebsiteContent();
  const campaignEnabled = content.campaign?.enabled !== false;
  const items = Array.isArray(content.navigation?.items)
    ? content.navigation.items
    : navItems;
  const visibleNavItems = items.filter(
    (item) => item.enabled !== false && (!item.campaign || campaignEnabled)
  );
  const brandName = content.brand?.website_name || "KlikPesantren";
  const logoUrl = content.brand?.logo_url || "/landing/logo.png";

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="kp-public">
      <PublicStyles />
      <header className="kp-header">
        <div className="kp-shell kp-header-inner">
          <Link className="kp-brand" to="/" aria-label="KlikPesantren">
            <span className="kp-brand-mark">
              <img src={logoUrl} alt="" />
            </span>
            <span>{brandName}</span>
          </Link>

          <nav className="kp-nav" aria-label="Navigasi utama">
            {visibleNavItems.map((item) => (
              <NavLink key={item.to} to={item.to}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="kp-header-actions">
            {campaignEnabled ? <Link className="kp-btn kp-btn-secondary" to={content.navigation?.campaign_cta_url || "/founding-partner"}>
              {content.navigation?.campaign_cta_label || "Founding Partner"}
            </Link> : null}
            <Link className="kp-btn kp-btn-primary" to={content.navigation?.primary_cta_url || "/demo"}>
              {content.navigation?.primary_cta_label || "Minta Demo"}
            </Link>
          </div>

          <button
            className="kp-mobile-toggle"
            type="button"
            aria-label={menuOpen ? "Tutup menu" : "Buka menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <FaTimes /> : <FaBars />}
          </button>
        </div>

        <div className={`kp-mobile-panel ${menuOpen ? "open" : ""}`}>
          <div className="kp-shell kp-mobile-links">
            {visibleNavItems.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={closeMenu}>
                {item.label}
              </NavLink>
            ))}
            <Link className="kp-btn kp-btn-primary" to={content.navigation?.primary_cta_url || "/demo"} onClick={closeMenu}>
              {content.navigation?.primary_cta_label || "Minta Demo"}
            </Link>
          </div>
        </div>
      </header>

      {children}

      <footer className="kp-footer">
        <div className="kp-shell kp-footer-inner">
          <div>
            <div className="kp-footer-brand">
              <span className="kp-brand-mark">
                <img src={logoUrl} alt="" />
              </span>
              <span>{brandName}</span>
            </div>
            <p>
              {content.footer?.description || "Platform SaaS untuk membantu pesantren mengelola administrasi, keuangan, komunikasi wali, dan operasional harian dalam satu sistem terintegrasi."}
            </p>
          </div>

          <div className="kp-footer-grid">
            <div>
              <h3>{content.footer?.product_title || "Produk"}</h3>
              <Link to="/fitur">Fitur</Link>
              <Link to="/harga">Harga</Link>
              <Link to="/demo">Minta Demo</Link>
            </div>
            <div>
              <h3>{content.footer?.company_title || "Perusahaan"}</h3>
              <Link to="/tentang">Tentang</Link>
              <Link to="/blog">Blog</Link>
              {campaignEnabled ? <Link to="/founding-partner">{content.campaign?.nav_label || "Founding Partner"}</Link> : null}
              <Link to="/kontak">Kontak</Link>
              <Link to="/privacy-policy">Privacy Policy</Link>
              <Link to="/terms-of-service">Terms of Service</Link>
            </div>
          </div>
        </div>
        <div className="kp-footer-bottom">
          <div className="kp-shell">
            {content.footer?.copyright || "© 2026 KlikPesantren. Platform administrasi pesantren modern."}
          </div>
        </div>
      </footer>
    </div>
  );
}
