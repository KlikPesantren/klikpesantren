import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaHome,
  FaUsers,
  FaMoneyBill,
  FaMicrochip,
  FaClipboardList,
  FaSchool,
  FaSignOutAlt,
  FaWifi,
  FaUserShield,
  FaChevronRight,
  FaHeartbeat,
} from "react-icons/fa";
import { Link, useLocation } from "react-router-dom";
import { hasAnyPermission } from "../utils/hasPermission";
import { hasFeature } from "../utils/hasFeature";
import { PERMISSIONS_UPDATED_EVENT } from "../utils/storage";
import TenantBrand from "./TenantBrand";
import { useTenantProfile } from "../context/TenantProfileContext";
import { ADMIN_PRODUCT_BRAND, isUniversalAdminHost } from "../constants/adminProductBrand";
import { useActiveUnit } from "../context/ActiveUnitContext";

const SCROLL_KEY = "kliksantri_sidebar_scroll";
const COLLAPSE_KEY = "kliksantri_sidebar_collapsed";

const SIDEBAR = {
  bg: "var(--sidebar-bg)",
  border: "var(--sidebar-border)",
  text: "var(--sidebar-text)",
  textMuted: "var(--sidebar-text-muted)",
  textFaint: "#64748B",
  hoverBg: "rgba(21, 128, 61, 0.12)",
  activeBg: "var(--sidebar-active-bg)",
  activeBorder: "var(--sidebar-active-border)",
  activeText: "var(--sidebar-active-text)",
};

const MENU = [
  { name: "Dashboard", path: "/dashboard", perm: "dashboard.view", feature: "dashboard", icon: <FaHome /> },
  { name: "Santri", path: "/santri", perm: "santri.view", feature: "santri", icon: <FaUsers /> },
  { name: "Alumni", path: "/alumni", perm: "alumni.view", feature: "santri", icon: <FaUsers /> },
  { name: "Wali Santri", path: "/wali", perm: "wali.view", feature: "wali", icon: <FaUsers /> },
  { name: "Guru", path: "/guru", perm: "guru.view", feature: "guru", icon: <FaUsers /> },
  { name: "Kelas", path: "/kelas", perm: "kelas.view", feature: "kelas", icon: <FaSchool /> },
  { name: "Unit Pendidikan", path: "/units", perm: "unit.view", feature: null, icon: <FaSchool /> },
  { name: "Profil Pesantren", path: "/profil-pesantren", perm: "profil.view", feature: "profil", icon: <FaSchool /> },
  { name: "Pengumuman", path: "/pengumuman", perm: "pengumuman.view", feature: "pengumuman", unitFeature: "pengumuman", icon: <FaClipboardList /> },
  { name: "Konten Pesantren", path: "/wali-home-links", perm: "konten_pesantren.view", feature: "pengumuman", icon: <FaClipboardList /> },
  { name: "Nilai", path: "/nilai", perm: "nilai.view", feature: "pendidikan", unitFeature: "nilai", icon: <FaClipboardList /> },
  { name: "Mata Pelajaran", path: "/mata-pelajaran", perm: "nilai.view", feature: "pendidikan", unitFeature: "mata_pelajaran", icon: <FaClipboardList /> },
  { name: "Hafalan", path: "/hafalan", perm: "hafalan.view", feature: "pendidikan", unitFeature: "hafalan", icon: <FaClipboardList /> },
  { name: "Program Unit", path: "/program-unit", perm: "program_unit.view", feature: "program_unit", icon: <FaClipboardList /> },
  { name: "Absensi", path: "/absensi", perm: "absensi.view", feature: "pendidikan", unitFeature: "absensi", icon: <FaClipboardList /> },
  { name: "Absensi Guru", path: "/absensi-guru", perm: "absensi_guru.view", feature: "pendidikan", icon: <FaClipboardList /> },
  { name: "Pembayaran", path: "/pembayaran", perm: "pembayaran.view", feature: "pembayaran", unitFeature: "pembayaran", icon: <FaMoneyBill /> },
  { name: "Buku Kas", path: "/buku-kas", perm: "bukukas.view", feature: "buku_kas", icon: <FaMoneyBill /> },
  { name: "Kas Instansi", path: "/kas-instansi", perm: "kas_instansi.view", feature: "kas_instansi", icon: <FaMoneyBill /> },
  { name: "Konsolidasi Yayasan", path: "/kas-instansi/konsolidasi", perm: "kas_instansi.konsolidasi", feature: "kas_instansi", icon: <FaMoneyBill /> },
  { name: "Sahriyah", path: "/sahriyah", perm: "sahriyah.view", feature: "sahriyah", unitFeature: "sahriyah", icon: <FaMoneyBill /> },
  { name: "Setting Sahriyah", path: "/sahriyah-setting", perm: "sahriyah.manage", feature: "sahriyah", unitFeature: "sahriyah", icon: <FaMoneyBill /> },
  { name: "Dashboard Dompet", path: "/rfid-dashboard", perm: ["wallet.view", "rfid.view"], feature: null, unitFeature: "wallet", icon: <FaMoneyBill /> },
  { name: "Topup", path: "/rfid-topup", perm: ["wallet.view", "rfid.view"], feature: null, unitFeature: "wallet", icon: <FaMoneyBill /> },
  { name: "Penarikan", path: "/wallet-withdrawal", perm: ["wallet.manage", "rfid.manage"], feature: null, unitFeature: "wallet", icon: <FaMoneyBill /> },
  { name: "Mutasi", path: "/rfid-mutasi", perm: ["wallet.view", "rfid.view"], feature: null, unitFeature: "wallet", icon: <FaMoneyBill /> },
  { name: "Transaksi", path: "/rfid-transactions", perm: ["wallet.view", "rfid.view"], feature: null, unitFeature: "wallet", icon: <FaMoneyBill /> },
  { name: "RFID Monitoring", path: "/rfid-monitor", perm: "rfid.view", feature: "rfid", unitFeature: "rfid", icon: <FaWifi /> },
  { name: "Device", path: "/rfid-devices", perm: "rfid.view", feature: "rfid", unitFeature: "rfid", icon: <FaMicrochip /> },
  { name: "Merchant", path: "/rfid-merchant", perm: "rfid.view", feature: "rfid", unitFeature: "rfid", icon: <FaWifi /> },
  { name: "Refund", path: "/rfid-refund", perm: "rfid.view", feature: "rfid", unitFeature: "rfid", icon: <FaWifi /> },
  { name: "Perizinan", path: "/perizinan", perm: "perizinan.view", feature: "perizinan", unitFeature: "perizinan", icon: <FaClipboardList /> },
  { name: "Kesehatan Santri", path: "/kesehatan", perm: "kesehatan.view", feature: "keamanan", unitFeature: "kesehatan", icon: <FaHeartbeat /> },
  { name: "Pelanggaran", path: "/pelanggaran", perm: "pelanggaran.view", feature: "pelanggaran", unitFeature: "pelanggaran", icon: <FaClipboardList /> },
  { name: "Tamu", path: "/tamu", perm: "tamu.view", feature: "keamanan", icon: <FaClipboardList /> },
  { name: "Users", path: "/users", perm: "user.view", feature: "sistem", icon: <FaUserShield /> },
  { name: "Roles", path: "/roles", perm: "role.manage", feature: "sistem", icon: <FaUserShield /> },
  { name: "Audit", path: "/audit", perm: "audit.view", feature: "audit", icon: <FaClipboardList /> },
  { name: "Info dari KlikPesantren", path: "/platform-announcements", perm: null, feature: null, icon: <FaClipboardList /> },
  { name: "Tentang KlikPesantren", path: "/about", perm: null, feature: null, icon: <FaSchool /> },
];

const MENU_GROUPS = [
  {
    id: "dashboard",
    title: "Dashboard",
    collapsible: false,
    items: ["Dashboard"],
  },
  {
    id: "data-utama",
    title: "Data Utama",
    collapsible: true,
    items: ["Santri", "Alumni", "Wali Santri", "Guru", "Kelas", "Profil Pesantren", "Pengumuman", "Konten Pesantren"],
  },
  {
    id: "akademik",
    title: "Akademik",
    collapsible: true,
    items: ["Nilai", "Mata Pelajaran", "Hafalan", "Program Unit", "Absensi", "Absensi Guru"],
  },
  {
    id: "keuangan",
    title: "Keuangan",
    collapsible: true,
    items: [
      "Pembayaran",
      "Buku Kas",
      "Kas Instansi",
      "Konsolidasi Yayasan",
      "Sahriyah",
      "Setting Sahriyah",
      "Dashboard Dompet",
      "Topup",
      "Penarikan",
      "Mutasi",
      "Transaksi",
      "RFID Monitoring",
      "Device",
      "Merchant",
      "Refund",
    ],
  },
  {
    id: "kedisiplinan",
    title: "Kedisiplinan",
    collapsible: true,
    items: ["Perizinan", "Kesehatan Santri", "Pelanggaran", "Tamu"],
  },
  {
    id: "sistem",
    title: "Sistem",
    collapsible: true,
    items: ["Unit Pendidikan", "Users", "Roles", "Audit", "Info dari KlikPesantren", "Tentang KlikPesantren"],
  },
];

const RFID_PATHS = new Set([
  "/rfid-dashboard",
  "/rfid-monitor",
  "/rfid-transactions",
  "/rfid-topup",
  "/wallet-withdrawal",
  "/rfid-refund",
  "/rfid-mutasi",
  "/rfid-merchant",
]);

function loadCollapsedState() {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCollapsedState(state) {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state));
}

function saveScrollPosition(scrollTop) {
  localStorage.setItem(SCROLL_KEY, String(scrollTop));
}

function restoreScrollPosition(navEl) {
  if (!navEl) return;
  const saved = localStorage.getItem(SCROLL_KEY);
  if (saved == null) return;
  navEl.scrollTop = Number(saved);
}

function getActiveGroupId(pathname, menuByPath) {
  const menu = menuByPath.get(pathname);
  if (!menu) return null;

  for (const group of MENU_GROUPS) {
    if (group.items.includes(menu.name)) {
      return group.id;
    }
  }
  return null;
}

function SidebarBrandStyles() {
  return (
    <style>{`
      .sidebar-brand-wrap {
        width: 100%;
        min-height: 0;
        box-sizing: border-box;
        align-items: stretch !important;
      }

      .sidebar-brand-wrap > div {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        width: 100%;
        gap: var(--space-2) !important;
        min-width: 0;
      }

      .sidebar-brand-wrap > div > div:first-child {
        flex-shrink: 0;
        width: 40px !important;
        height: 40px !important;
      }

      .sidebar-brand-wrap > div > div:first-child > div,
      .sidebar-brand-wrap > div > div:first-child > img {
        width: 40px !important;
        height: 40px !important;
        font-size: 13px !important;
      }

      .sidebar-brand-wrap .sidebar-brand-text {
        display: flex;
        flex-direction: column;
        width: 100%;
        min-width: 0;
        gap: 2px;
      }

      .sidebar-brand-wrap .sidebar-brand-text > div:first-child {
        white-space: normal !important;
        display: -webkit-box !important;
        -webkit-line-clamp: 2 !important;
        -webkit-box-orient: vertical !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        line-height: 1.35 !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        color: var(--sidebar-active-text) !important;
        margin: 0 !important;
        max-height: calc(1.35em * 2);
        word-break: break-word;
      }

      .sidebar-brand-wrap .sidebar-brand-text > div:last-child {
        display: -webkit-box !important;
        -webkit-line-clamp: 2 !important;
        -webkit-box-orient: vertical !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: normal !important;
        line-height: 1.35 !important;
        font-size: 10px !important;
        font-weight: 500 !important;
        color: var(--sidebar-text-muted) !important;
        opacity: 0.9 !important;
        margin: 0 !important;
        max-height: calc(1.35em * 2);
        word-break: break-word;
      }
    `}</style>
  );
}

function SidebarBrand() {
  const { display } = useTenantProfile();

  return (
    <>
      <SidebarBrandStyles />
      <div className="sidebar-brand-wrap" style={brandContainerStyle}>
        <TenantBrand
          variant="sidebar"
          size="md"
          logo={display.logo}
          name={display.name}
          location={display.address}
        />
      </div>
    </>
  );
}

function Sidebar({ drawerOpen = false, onDrawerClose }) {
  const location = useLocation();
  const { hasActiveUnitFeature } = useActiveUnit();
  const navRef = useRef(null);
  const scrollRafRef = useRef(null);

  const [collapsed, setCollapsed] = useState(loadCollapsedState);
  const [permissionsVersion, setPermissionsVersion] = useState(0);

  useEffect(() => {
    const syncPermissionsVersion = () => {
      setPermissionsVersion((v) => v + 1);
    };
    window.addEventListener(PERMISSIONS_UPDATED_EVENT, syncPermissionsVersion);
    return () => {
      window.removeEventListener(PERMISSIONS_UPDATED_EVENT, syncPermissionsVersion);
    };
  }, []);

  const menus = useMemo(
    () => {
      void permissionsVersion;
      return MENU.filter((m) => hasAnyPermission(m.perm) && hasFeature(m.feature) && hasActiveUnitFeature(m.unitFeature));
    },
    [permissionsVersion, hasActiveUnitFeature],
  );

  const menuByName = useMemo(
    () => new Map(menus.map((menu) => [menu.name, menu])),
    [menus],
  );

  const menuByPath = useMemo(
    () => new Map(menus.map((menu) => [menu.path, menu])),
    [menus],
  );

  const persistScroll = useCallback(() => {
    if (!navRef.current) return;
    saveScrollPosition(navRef.current.scrollTop);
  }, []);

  const handleNavScroll = useCallback(() => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      persistScroll();
    });
  }, [persistScroll]);

  useEffect(() => {
    const navEl = navRef.current;
    restoreScrollPosition(navEl);

    const frame = requestAnimationFrame(() => {
      restoreScrollPosition(navEl);
    });

    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);

  useEffect(() => {
    restoreScrollPosition(navRef.current);
    window.addEventListener("beforeunload", persistScroll);
    return () => {
      window.removeEventListener("beforeunload", persistScroll);
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, [persistScroll]);

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/";
  };

  const toggleGroup = (groupId) => {
    setCollapsed((prev) => {
      const next = { ...prev, [groupId]: prev[groupId] !== true };
      saveCollapsedState(next);
      return next;
    });
  };

  const isGroupOpen = (group) => {
    if (!group.collapsible) return true;
    const activeGroupId = getActiveGroupId(location.pathname, menuByPath);
    if (activeGroupId === group.id) return true;
    return collapsed[group.id] !== true;
  };

  const renderMenuLink = (menu, { nested = false } = {}) => {
    const active = location.pathname === menu.path;

    return (
      <Link
        key={menu.path}
        to={menu.path}
        className={`sidebar-menu-link${nested ? " sidebar-menu-link--nested" : ""}`}
        style={{
          ...menuLinkStyle,
          paddingLeft: nested ? "calc(var(--space-3) + 18px)" : menuLinkStyle.paddingLeft,
          background: active ? SIDEBAR.activeBg : "transparent",
          borderLeftColor: active ? SIDEBAR.activeBorder : "transparent",
          color: active ? SIDEBAR.activeText : SIDEBAR.text,
          fontWeight: active ? 600 : 500,
        }}
        title={menu.name}
        onClick={() => onDrawerClose?.()}
        onMouseEnter={(e) => {
          if (!active) {
            e.currentTarget.style.background = SIDEBAR.hoverBg;
          }
        }}
        onMouseLeave={(e) => {
          if (!active) {
            e.currentTarget.style.background = "transparent";
          }
        }}
      >
        <span
          style={{
            ...iconStyle,
            color: active ? "var(--primary)" : SIDEBAR.textMuted,
          }}
        >
          {menu.icon}
        </span>
        <span style={menuTextStyle} className="sidebar-menu-label">
          {menu.name}
        </span>
      </Link>
    );
  };

  const renderGroup = (group) => {
    const groupMenus = group.items
      .map((name) => menuByName.get(name))
      .filter(Boolean);

    if (groupMenus.length === 0) return null;

    const open = isGroupOpen(group);
    const rfidStartIndex = group.id === "keuangan"
      ? groupMenus.findIndex((m) => RFID_PATHS.has(m.path))
      : -1;

    return (
      <div key={group.id} style={sectionStyle}>
        {group.collapsible ? (
          <button
            type="button"
            onClick={() => toggleGroup(group.id)}
            className="sidebar-group-toggle"
            style={sectionHeaderButtonStyle}
            aria-expanded={open}
            title={group.title}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = SIDEBAR.hoverBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <span style={{ ...sectionTitleStyle, marginBottom: 0 }} className="sidebar-group-title">
              {group.title}
            </span>
            <span
              className="sidebar-chevron"
              style={{
                ...chevronStyle,
                marginBottom: 0,
                transform: open ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              <FaChevronRight size={10} />
            </span>
          </button>
        ) : (
          <div style={sectionTitleStyle} className="sidebar-group-title">
            {group.title}
          </div>
        )}

        {open && (
          <div style={sectionMenuStyle}>
            {groupMenus.map((menu, index) => (
              <div key={menu.path}>
                {group.id === "keuangan" && index === rfidStartIndex ? (
                  <div style={{ ...sectionTitleStyle, marginTop: "var(--space-3)" }}>Dompet Santri</div>
                ) : null}
                {renderMenuLink(menu, {
                  nested: group.id === "keuangan" && rfidStartIndex >= 0 && index >= rfidStartIndex,
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`sidebar-root${drawerOpen ? " sidebar-root--open" : ""}`}>
      <div style={topStyle}>
        <div style={brandWrapperStyle}>
          <SidebarBrand />
        </div>

        <nav
          ref={navRef}
          style={navStyle}
          onScroll={handleNavScroll}
          aria-label="Navigasi utama"
        >
          {MENU_GROUPS.map(renderGroup)}
        </nav>
      </div>

      <div style={footerStyle}>
        <button
          type="button"
          onClick={logout}
          className="sidebar-logout-btn"
          style={logoutStyle}
          title="Logout"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)";
            e.currentTarget.style.color = "#FCA5A5";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = SIDEBAR.text;
          }}
        >
          <FaSignOutAlt /> <span className="sidebar-logout-text">Logout</span>
        </button>

        {isUniversalAdminHost() ? (
          <Link to="/about" style={adminProductStyle} className="sidebar-admin-product">
            <img src={ADMIN_PRODUCT_BRAND.logo} alt="" style={adminProductLogoStyle} />
            <span>{ADMIN_PRODUCT_BRAND.name}</span>
          </Link>
        ) : null}

        <Link to="/about" style={platformMarkWrapStyle} className="sidebar-platform">
          {ADMIN_PRODUCT_BRAND.poweredBy}
        </Link>
      </div>
    </div>
  );
}

const topStyle = {
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  flex: 1,
  overflow: "hidden",
};

const brandContainerStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: "var(--space-3)",
  minWidth: 0,
  width: "100%",
};

const brandWrapperStyle = {
  paddingTop: "var(--space-2)",
  paddingBottom: "var(--space-3)",
  marginBottom: "var(--space-3)",
  minHeight: 0,
  borderBottom: `1px solid ${SIDEBAR.border}`,
  flexShrink: 0,
  boxSizing: "border-box",
};

const navStyle = {
  overflowY: "auto",
  overflowX: "hidden",
  paddingRight: "var(--space-1)",
  flex: 1,
  minHeight: 0,
  scrollbarWidth: "thin",
  scrollbarColor: "rgba(148, 163, 184, 0.35) transparent",
};

const sectionStyle = {
  marginBottom: "var(--space-3)",
};

const sectionHeaderButtonStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "7px 10px",
  marginBottom: "var(--space-2)",
  marginLeft: "-8px",
  width: "calc(100% + 8px)",
  background: "transparent",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  textAlign: "left",
  transition: "background 180ms ease",
};

const sectionTitleStyle = {
  color: "#94A3B8",
  fontSize: "10px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  marginBottom: "var(--space-2)",
  paddingLeft: "var(--space-1)",
};

const chevronStyle = {
  display: "inline-flex",
  alignItems: "center",
  color: SIDEBAR.textMuted,
  marginBottom: "var(--space-2)",
  transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1)",
  transformOrigin: "center",
};

const sectionMenuStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "3px",
};

const menuLinkStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  padding: "10px var(--space-3)",
  paddingLeft: "calc(var(--space-3) - 3px)",
  borderRadius: "var(--radius-md)",
  borderLeft: "3px solid transparent",
  transition: "background 180ms ease, color 180ms ease, border-color 180ms ease",
  textDecoration: "none",
  minHeight: "40px",
  boxSizing: "border-box",
};

const iconStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "18px",
  height: "18px",
  flexShrink: 0,
  fontSize: "14px",
  transition: "color 180ms ease",
};

const menuTextStyle = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  lineHeight: 1.3,
};

const footerStyle = {
  paddingTop: "var(--space-4)",
  marginTop: "var(--space-4)",
  borderTop: `1px solid ${SIDEBAR.border}`,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  flexShrink: 0,
};

const logoutStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  width: "100%",
  background: "transparent",
  color: SIDEBAR.text,
  border: "none",
  padding: "9px var(--space-3)",
  borderRadius: "10px",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: "14px",
  transition: "background 180ms ease, color 180ms ease",
};

const adminProductStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  color: SIDEBAR.text,
  fontSize: "12px",
  fontWeight: 700,
  textDecoration: "none",
};

const adminProductLogoStyle = {
  width: 28,
  height: 28,
  borderRadius: 8,
  objectFit: "cover",
  flexShrink: 0,
};

const platformMarkWrapStyle = {
  color: SIDEBAR.textMuted,
  fontSize: "11px",
  lineHeight: 1.45,
  fontWeight: 500,
  textDecoration: "none",
};

export default Sidebar;
