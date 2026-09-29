import { useCallback, useEffect, useRef, useState } from "react";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import { DashboardResponsiveStyles } from "../components/dashboard/DashboardResponsiveStyles";
import DashboardMetrics from "../components/dashboard/DashboardMetrics";
import DashboardHero from "../components/dashboard/DashboardHero";
import DashboardAllUnitsV1 from "../components/dashboard/DashboardAllUnitsV1";
import DashboardSpecificUnit from "../components/dashboard/DashboardSpecificUnit";
import DashboardKeuangan from "../components/dashboard/DashboardKeuangan";
import DashboardPendidikan from "../components/dashboard/DashboardPendidikan";
import DashboardKeamanan from "../components/dashboard/DashboardKeamanan";
import DashboardSekretaris from "../components/dashboard/DashboardSekretaris";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { getUser } from "../utils/storage";
import { hasPermission } from "../utils/hasPermission";
import SubscriptionBillingNotice from "../components/SubscriptionBillingNotice";

const DEFAULT_SHORTCUTS = [
  { permission: "absensi.view", label: "Absensi Santri", path: "/absensi" },
  { permission: "program_unit.view", label: "Program Unit", path: "/program-unit" },
  { permission: "kas_instansi.view", label: "Kas Unit", path: "/kas-instansi" },
  { permission: "pembayaran.view", label: "Pembayaran", path: "/pembayaran" },
  { permission: "santri.view", label: "Data Santri", path: "/santri" },
  { permission: "pengumuman.view", label: "Pengumuman", path: "/pengumuman" },
];

function createEmptySummary() {
  return {
    total_santri: 0,
    total_alumni: 0,
    santri_aktif: 0,
    santri_non_aktif: 0,
    total_kelas: 0,
    total_guru: 0,
    total_wali: 0,
    total_saldo: 0,
    persentase_kehadiran_santri: 0,
    persentase_kehadiran_guru: 0,
    total_hafalan: 0,
    rata_nilai: 0,
    absensi_hari_ini: 0,
    nilai_terisi: 0,
    kehadiran_santri_hadir: 0,
    kehadiran_santri_total: 0,
    kehadiran_guru_hadir: 0,
    kehadiran_guru_total: 0,
    nilai_total: 0,
    total_wali_akun: 0,
    wali_belum_ganti_pin: 0,
    santri_poin_tertinggi: [],
    kas_masuk: 0,
    kas_keluar: 0,
    saldo_kas: 0,
    nominal_tagihan: 0,
    sudah_dibayar: 0,
    sisa_belum_dibayar: 0,
    pembayaran_hari_ini: 0,
    tagihan_belum_lunas: 0,
    total_pembayaran: 0,
    total_tunggakan: 0,
    sahriyah_status: { total_santri: 0, lunas: 0, cicilan: 0, belum_bayar: 0 },
    total_pelanggaran: 0,
    total_perizinan: 0,
    belum_kembali: 0,
    recent_perizinan: [],
    total_pengumuman: 0,
    pengumuman_aktif: 0,
    pengumuman_terbaru: [],
    tamu_hari_ini: 0,
    tamu_bulan_ini: 0,
    tamu_masih_didalam: 0,
    grafik_kas: [],
    transaksi_terbaru: [],
    pembayaran_terbaru: [],
    top_tunggakan: [],
  };
}

function DashboardPage() {
  const user = getUser();
  const {
    activeUnitId,
    activeUnit,
    allUnitsAllowed,
    loading: unitLoading,
    error: unitError,
  } = useActiveUnit();

  const [summary, setSummary] = useState(createEmptySummary);
  const [summaryMeta, setSummaryMeta] = useState({ scope: "all", all_units: true });
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [allUnitsYear, setAllUnitsYear] = useState(() => new Date().getFullYear());
  const [specificClassSelection, setSpecificClassSelection] = useState({ unitId: null, classId: "" });
  const summaryRequestRef = useRef({ sequence: 0, controller: null });

  const role = user?.role || "";
  const canViewDashboardData = hasPermission("dashboard.view");
  const shortcuts = DEFAULT_SHORTCUTS.filter((item) => hasPermission(item.permission));

  const isUnitWorkspace = Boolean(activeUnitId);
  const specificClassId = Number(specificClassSelection.unitId) === Number(activeUnitId)
    ? specificClassSelection.classId
    : "";
  const dashboardScopeReady = !unitLoading && !unitError && (allUnitsAllowed || isUnitWorkspace);
  const dashboardBlockedMessage = unitError ||
    (!unitLoading && !allUnitsAllowed && !isUnitWorkspace
      ? "Belum memiliki penugasan unit. Minta superadmin mengatur unit untuk akun ini."
      : "");
  const unitContext = isUnitWorkspace
    ? { scope: "unit", unitName: activeUnit?.nama || summaryMeta.unit_name || "Unit" }
    : dashboardScopeReady ? { scope: "all" } : { scope: "blocked" };
  const summaryForView = dashboardScopeReady && !summaryError ? summary : createEmptySummary();

  const getSummary = useCallback(async () => {
    summaryRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const sequence = summaryRequestRef.current.sequence + 1;
    summaryRequestRef.current = { sequence, controller };

    if (!activeUnitId && !allUnitsAllowed) {
      setSummary(createEmptySummary());
      setSummaryMeta({ scope: "blocked", all_units: false });
      setSummaryError("Belum memiliki penugasan unit. Minta superadmin mengatur unit untuk akun ini.");
      setSummaryLoading(false);
      return;
    }

    try {
      setSummaryLoading(true);
      setSummaryError("");
      const params = activeUnitId
        ? { unit_id: activeUnitId, ...(specificClassId ? { kelas_id: specificClassId } : {}) }
        : { scope: "all", year: allUnitsYear };
      const response = activeUnitId
        ? await api.get("/dashboard-specific-unit/summary", { params, signal: controller.signal })
        : await api.get("/dashboard/all-units-v1", { params, signal: controller.signal });
      if (summaryRequestRef.current.sequence !== sequence) return;
      setSummary(response.data.data);
      setSummaryMeta(response.data.meta || { scope: activeUnitId ? "unit" : "all" });
    } catch (err) {
      if (controller.signal.aborted || summaryRequestRef.current.sequence !== sequence) return;
      console.error(err);
      const code = err.response?.data?.code;
      setSummary(createEmptySummary());
      setSummaryError(
        ["UNIT_ACCESS_DENIED", "UNIT_REQUIRED"].includes(code)
          ? "Belum memiliki penugasan unit. Minta superadmin mengatur unit untuk akun ini."
          : err.response?.data?.error || "Ringkasan dashboard belum dapat dimuat."
      );
    } finally {
      if (summaryRequestRef.current.sequence === sequence) setSummaryLoading(false);
    }
  }, [activeUnitId, allUnitsAllowed, allUnitsYear, specificClassId]);

  useEffect(() => {
    if (canViewDashboardData && dashboardScopeReady) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      getSummary();
    } else {
      summaryRequestRef.current.controller?.abort();
      summaryRequestRef.current.sequence += 1;
      setSummaryLoading(false);
    }
    return () => summaryRequestRef.current.controller?.abort();
  }, [canViewDashboardData, dashboardScopeReady, getSummary]);

  return (
    <AppShell title="Dashboard" breadcrumb="Dashboard">
      <DashboardResponsiveStyles />
      {role === "superadmin" ? <SubscriptionBillingNotice /> : null}
      <div className="dashboard-page dashboard-monitoring-v3">
        <section className="dashboard-section dashboard-section--hero">
          <DashboardHero unitContext={unitContext} />
        </section>

        {canViewDashboardData && dashboardScopeReady && !isUnitWorkspace ? (
          <section className="dashboard-section">
            <div style={contextPanelStyle}>
              <strong>
                {isUnitWorkspace
                  ? `Workspace aktif: ${unitContext.unitName}`
                  : "Workspace aktif: Semua Unit"}
              </strong>
              <span>
                {isUnitWorkspace
                  ? "KPI unit mengikuti workspace aktif. KPI Tamu tetap berkontrak tenant/yayasan."
                  : "Dashboard Yayasan V1 menampilkan identity unik, kelas, Buku Kas, dan Dompet Santri seluruh unit."}
              </span>
            </div>
          </section>
        ) : null}

        {canViewDashboardData && !unitLoading && (summaryError || dashboardBlockedMessage) ? (
          <section className="dashboard-section">
            <div style={errorPanelStyle}>{summaryError || dashboardBlockedMessage}</div>
          </section>
        ) : null}

        {unitLoading || summaryLoading ? (
          <section className="dashboard-section">
            <div style={loadingPanelStyle}>Memuat ringkasan workspace aktif...</div>
          </section>
        ) : null}

        {!canViewDashboardData ? (
          <section className="dashboard-section dashboard-section--metrics">
            <div style={shortcutPanelStyle}>
              <div>
                <h2 style={shortcutTitleStyle}>Akses Cepat</h2>
                <p style={shortcutSubtitleStyle}>
                  Pilih halaman yang tersedia untuk role Anda.
                </p>
              </div>
              <div style={shortcutGridStyle}>
                {shortcuts.length > 0 ? (
                  shortcuts.map((item) => (
                    <a key={item.path} href={item.path} style={shortcutLinkStyle}>
                      {item.label}
                    </a>
                  ))
                ) : (
                  <span style={shortcutEmptyStyle}>
                    Belum ada halaman yang bisa diakses. Minta admin mengatur permission role.
                  </span>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {canViewDashboardData && dashboardScopeReady && !summaryLoading && !summaryError && isUnitWorkspace ? (
          <section className="dashboard-section">
            <DashboardSpecificUnit
              data={summaryForView}
              onClassChange={(classId) => setSpecificClassSelection({ unitId: activeUnitId, classId })}
            />
          </section>
        ) : null}

        {canViewDashboardData && dashboardScopeReady && !summaryLoading && !summaryError && role === "superadmin" && !isUnitWorkspace && (
            <section className="dashboard-section">
              <DashboardAllUnitsV1
                data={summaryForView}
                year={allUnitsYear}
                onYearChange={setAllUnitsYear}
              />
            </section>
        )}

        {canViewDashboardData && dashboardScopeReady && !isUnitWorkspace && !summaryLoading && !summaryError && role === "keuangan" && <DashboardKeuangan summary={summaryForView} />}

        {canViewDashboardData && dashboardScopeReady && !isUnitWorkspace && !summaryLoading && !summaryError && role === "pendidikan" && <DashboardPendidikan summary={summaryForView} />}

        {canViewDashboardData && dashboardScopeReady && !isUnitWorkspace && !summaryLoading && !summaryError && role === "keamanan" && <DashboardKeamanan summary={summaryForView} />}

        {canViewDashboardData && dashboardScopeReady && !isUnitWorkspace && !summaryLoading && !summaryError && role === "sekretaris" && <DashboardSekretaris summary={summaryForView} />}

        {canViewDashboardData && dashboardScopeReady && !isUnitWorkspace && !summaryLoading && !summaryError && !["superadmin", "keuangan", "pendidikan", "keamanan", "sekretaris"].includes(role) && (
          <section className="dashboard-section dashboard-section--metrics">
            <DashboardMetrics summary={summaryForView} meta={isUnitWorkspace ? { scope: "unit" } : summaryMeta} />
          </section>
        )}
      </div>
    </AppShell>
  );
}

const shortcutPanelStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "20px",
  boxShadow: "var(--shadow-card)",
};

const contextPanelStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px 12px",
  alignItems: "center",
  justifyContent: "space-between",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "12px 14px",
  color: "var(--text-primary)",
  fontSize: "13px",
  boxShadow: "var(--shadow-card)",
};

const errorPanelStyle = {
  background: "var(--danger-subtle)",
  border: "1px solid color-mix(in srgb, var(--danger) 22%, transparent)",
  borderRadius: "var(--radius-md)",
  padding: "12px 14px",
  color: "var(--danger)",
  fontSize: "13px",
  fontWeight: 700,
};

const loadingPanelStyle = {
  background: "var(--surface-muted)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "12px 14px",
  color: "var(--text-secondary)",
  fontSize: "13px",
  fontWeight: 700,
};

const shortcutTitleStyle = {
  margin: 0,
  fontSize: "18px",
  color: "var(--text-primary)",
};

const shortcutSubtitleStyle = {
  margin: "6px 0 16px",
  color: "var(--text-secondary)",
  fontSize: "14px",
};

const shortcutGridStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
};

const shortcutLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: "38px",
  padding: "8px 12px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--surface-muted)",
  color: "var(--text-primary)",
  textDecoration: "none",
  fontSize: "13px",
  fontWeight: 700,
};

const shortcutEmptyStyle = {
  color: "var(--text-secondary)",
  fontSize: "14px",
};

export default DashboardPage;
