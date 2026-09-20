import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import platformApi from "../../services/platformApi";
import Badge from "../../components/ui/Badge";
import PlatformButton from "../../components/platform/PlatformButton";
import Card from "../../components/ui/Card";
import KpiCard from "../../components/ui/KpiCard";
import KpiGrid from "../../components/ui/KpiGrid";
import SectionHeading from "../../components/ui/SectionHeading";
import Modal from "../../components/Modal";
import { TENANT_PACKAGES } from "../../constants/tenantPackages";
import { formatCurrency } from "../../utils/formatCurrency";
import { formatDateShort } from "../../utils/formatDate";
import { openTenantAdminPortal } from "../../utils/tenantPortal";
import BrandProfilePanel from "../../components/platform/BrandProfilePanel";
import { getPlatformUser } from "../../utils/platformStorage";

const APPLY_PACKAGE_OPTIONS = TENANT_PACKAGES;

const BILLING_STATUS_OPTIONS = [
  "trial",
  "active",
  "overdue",
  "suspended",
  "cancelled",
];

function tenantDisplayName(row) {
  return row?.nama || row?.name || "-";
}

function statusBadgeVariant(status) {
  if (status === "active") return "success";
  if (status === "suspended") return "danger";
  if (status === "trial") return "info";
  return "neutral";
}

function billingBadgeVariant(status) {
  if (status === "active") return "success";
  if (status === "trial") return "info";
  if (status === "overdue") return "warning";
  if (status === "suspended" || status === "cancelled") return "danger";
  return "neutral";
}

function featureOnOff(features, key) {
  return features.find((feature) => feature.key === key)?.enabled === true;
}

function formatDateTime(value) {
  if (!value) return "-";
  return `${formatDateShort(value)} ${new Date(value).toLocaleTimeString("id-ID")}`;
}

function toDateTimeInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function addDays(value, days) {
  const base = value ? new Date(value) : new Date();
  const now = new Date();
  const start = Number.isNaN(base.getTime()) || base < now ? now : base;
  start.setDate(start.getDate() + days);
  return start.toISOString();
}

function PlatformTenantDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState(null);
  const [tenantDomain, setTenantDomain] = useState(null);
  const [domainLoading, setDomainLoading] = useState(false);
  const [domainError, setDomainError] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [features, setFeatures] = useState([]);
  const [featuresLoading, setFeaturesLoading] = useState(false);
  const [featuresSaving, setFeaturesSaving] = useState(false);
  const [featuresError, setFeaturesError] = useState("");
  const [currentPackage, setCurrentPackage] = useState({ id: "custom", label: "Custom" });
  const [selectedPackage, setSelectedPackage] = useState("basic");
  const [packageSaving, setPackageSaving] = useState(false);
  const [billing, setBilling] = useState(null);
  const [billingForm, setBillingForm] = useState({
    plan_code: "premium",
    billing_status: "active",
    subscription_expires_at: "",
    billing_notes: "",
  });
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [resetAdminOpen, setResetAdminOpen] = useState(false);
  const [resetAdminLoading, setResetAdminLoading] = useState(false);
  const [resetAdminError, setResetAdminError] = useState("");
  const [resetAdminCredential, setResetAdminCredential] = useState(null);
  const [resetAdminCopied, setResetAdminCopied] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [confirmDefaultSlug, setConfirmDefaultSlug] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [editForm, setEditForm] = useState({
    nama: "",
    tenant_display_name: "",
    slug: "",
    status: "active",
    alamat: "",
    telepon: "",
    tagline: "",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [detailRes, dashRes] = await Promise.all([
        platformApi.get(`/platform/tenants/${id}`),
        platformApi.get(`/platform/tenants/${id}/dashboard`),
      ]);
      setTenant(detailRes.data?.data || null);
      setDashboard(dashRes.data || null);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal memuat detail tenant");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadTenantDomain = useCallback(async () => {
    setDomainLoading(true);
    setDomainError("");
    try {
      const response = await platformApi.get(`/platform/tenants/${id}/domain`);
      setTenantDomain(response.data?.data || null);
    } catch (err) {
      if (err.response?.status === 404) setTenantDomain(null);
      else setDomainError(err.response?.data?.error || "Gagal memuat domain tenant");
    } finally {
      setDomainLoading(false);
    }
  }, [id]);

  useEffect(() => { loadTenantDomain(); }, [loadTenantDomain]);

  const generateTenantDomain = async () => {
    setDomainLoading(true);
    setDomainError("");
    try {
      const response = await platformApi.post(`/platform/tenants/${id}/domain/draft`);
      setTenantDomain(response.data?.data || null);
    } catch (err) {
      setDomainError(err.response?.data?.error || "Gagal membuat draft domain");
    } finally {
      setDomainLoading(false);
    }
  };

  const runTenantDomainAction = async (endpoint) => {
    if (!tenantDomain?.id) return;
    setDomainLoading(true); setDomainError("");
    try {
      const response = await platformApi.post(`/platform/tenant-domains/${tenantDomain.id}/${endpoint}`);
      setTenantDomain(response.data?.data || tenantDomain);
    } catch (err) {
      setDomainError(err.response?.data?.error || "Operasi domain tenant gagal");
      await loadTenantDomain();
    } finally { setDomainLoading(false); }
  };

  const loadFeatures = useCallback(async () => {
    setFeaturesLoading(true);
    setFeaturesError("");
    try {
      const res = await platformApi.get(`/platform/tenants/${id}/features`);
      setFeatures(res.data?.features || []);
      setCurrentPackage(res.data?.current_package || { id: "custom", label: "Custom" });
      if (
        APPLY_PACKAGE_OPTIONS.some(
          (pkg) => pkg.id === res.data?.current_package?.id
        )
      ) {
        setSelectedPackage(res.data.current_package.id);
      }
    } catch (err) {
      setFeaturesError(err.response?.data?.error || "Gagal memuat fitur tenant");
    } finally {
      setFeaturesLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadFeatures();
  }, [loadFeatures]);

  const applyBillingState = (nextBilling) => {
    const safeBilling = nextBilling || {};
    setBilling(safeBilling);
    setBillingForm({
      plan_code: safeBilling.plan_code || "premium",
      billing_status: safeBilling.billing_status || "active",
      subscription_expires_at: toDateTimeInputValue(
        safeBilling.subscription_expires_at
      ),
      billing_notes: safeBilling.billing_notes || "",
    });
  };

  const loadBilling = useCallback(async () => {
    setBillingLoading(true);
    setBillingError("");
    try {
      const res = await platformApi.get(`/platform/tenants/${id}/billing`);
      applyBillingState(res.data?.data || null);
    } catch (err) {
      setBillingError(err.response?.data?.error || "Gagal memuat billing tenant");
    } finally {
      setBillingLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  const handleToggleFeature = (key) => {
    setFeatures((prev) =>
      prev.map((f) =>
        f.key === key && !f.is_core ? { ...f, enabled: !f.enabled } : f
      )
    );
  };

  const handleSaveFeatures = async () => {
    setFeaturesSaving(true);
    setFeaturesError("");
    try {
      const res = await platformApi.patch(`/platform/tenants/${id}/features`, {
        features: features.map((f) => ({ key: f.key, enabled: f.enabled })),
      });
      setFeatures(res.data?.features || []);
      setCurrentPackage(res.data?.current_package || { id: "custom", label: "Custom" });
    } catch (err) {
      setFeaturesError(err.response?.data?.error || "Gagal menyimpan fitur tenant");
    } finally {
      setFeaturesSaving(false);
    }
  };

  const handleApplyPackage = async () => {
    const pkg = APPLY_PACKAGE_OPTIONS.find((item) => item.id === selectedPackage);
    if (!pkg) return;

    const isCustom = pkg.id === "custom";
    const confirmed = window.confirm(
      isCustom
        ? `Terapkan konfigurasi Custom untuk "${tenantDisplayName(tenant)}"?\n\nFitur aktif akan mengikuti checklist saat ini. Fitur core tetap aktif dan data tenant tidak berubah.`
        : `Apply package ${pkg.label} untuk "${tenantDisplayName(tenant)}"?\n\nFitur tenant akan mengikuti paket ini. Nama tenant, status, user, dan data santri tidak berubah.`
    );
    if (!confirmed) return;

    setPackageSaving(true);
    setFeaturesError("");
    try {
      const payload = { package: pkg.id };
      if (isCustom) {
        payload.custom_features = features
          .filter((feature) => feature.enabled)
          .map((feature) => feature.key);
      }

      const res = await platformApi.patch(
        `/platform/tenants/${id}/package`,
        payload
      );
      setFeatures(res.data?.features || []);
      setCurrentPackage(res.data?.current_package || { id: pkg.id, label: pkg.label });
      setSelectedPackage(res.data?.current_package?.id || pkg.id);
    } catch (err) {
      setFeaturesError(err.response?.data?.error || "Gagal apply package");
    } finally {
      setPackageSaving(false);
    }
  };

  const handleOpenTenantPortal = () => {
    const slug = tenant?.slug || dashboard?.tenant?.slug;
    const opened = openTenantAdminPortal(slug);
    if (!opened) {
      window.alert("Slug tenant tidak valid.");
    }
  };

  const openEditModal = () => {
    setEditError("");
    setConfirmDefaultSlug(false);
    setEditForm({
      nama: tenantDisplayName(tenant),
      tenant_display_name: tenant?.tenant_display_name || "",
      slug: tenant?.slug || "",
      status: tenant?.status || "active",
      alamat: tenant?.alamat || "",
      telepon: tenant?.telepon || "",
      tagline: tenant?.tagline || "",
    });
    setEditOpen(true);
  };

  const closeEditModal = () => {
    if (editSaving) return;
    setEditOpen(false);
    setEditError("");
  };

  const handleSaveEditTenant = async () => {
    setEditSaving(true);
    setEditError("");
    try {
      const payload = {
        nama: editForm.nama.trim(),
        tenant_display_name: editForm.tenant_display_name.trim() || null,
        slug: editForm.slug.trim(),
        status: editForm.status,
        alamat: editForm.alamat.trim() || null,
        telepon: editForm.telepon.trim() || null,
        tagline: editForm.tagline.trim() || null,
      };

      if (tenant?.slug === "default" && payload.slug !== "default") {
        if (!confirmDefaultSlug) {
          setEditError(
            "Tenant default memerlukan konfirmasi khusus untuk mengubah slug."
          );
          setEditSaving(false);
          return;
        }
        payload.confirm_default_slug_change = true;
      }

      const res = await platformApi.patch(`/platform/tenants/${id}`, payload);
      setTenant((prev) => ({ ...prev, ...(res.data?.data || {}) }));
      setEditOpen(false);
      await loadData();
    } catch (err) {
      setEditError(err.response?.data?.error || "Gagal menyimpan perubahan tenant");
    } finally {
      setEditSaving(false);
    }
  };

  const handleResetAdminPassword = async () => {
    const confirmed = window.confirm(
      `Reset password admin tenant "${tenantDisplayName(tenant)}"?\n\nPassword baru akan ditampilkan sekali. Data tenant tidak berubah.`
    );
    if (!confirmed) return;

    setResetAdminLoading(true);
    setResetAdminError("");
    setResetAdminCredential(null);
    setResetAdminCopied(false);
    setResetAdminOpen(true);

    try {
      const res = await platformApi.post(
        `/platform/tenants/${id}/reset-admin-password`
      );
      setResetAdminCredential(res.data?.admin || null);
    } catch (err) {
      setResetAdminError(
        err.response?.data?.error || "Gagal reset password admin tenant"
      );
    } finally {
      setResetAdminLoading(false);
    }
  };

  const handleCopyResetAdminCredential = async () => {
    if (!resetAdminCredential) return;
    const text = [
      `Tenant: ${tenantDisplayName(tenant)}`,
      `Slug: ${tenant?.slug}`,
      `Username: ${resetAdminCredential.username}`,
      `Password: ${resetAdminCredential.password}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setResetAdminCopied(true);
    } catch {
      window.prompt("Salin kredensial admin tenant:", text);
    }
  };

  const closeResetAdminModal = () => {
    if (resetAdminLoading) return;
    setResetAdminOpen(false);
    setResetAdminError("");
    setResetAdminCredential(null);
    setResetAdminCopied(false);
  };

  const handleSuspend = async () => {
    const reason = window.prompt(
      "Alasan suspend tenant (wajib):",
      "Penangguhan layanan sementara"
    );
    if (reason === null) return;
    if (!reason.trim()) {
      window.alert("Alasan suspend wajib diisi.");
      return;
    }

    const confirmed = window.confirm(
      `Suspend tenant "${tenantDisplayName(tenant)}"?\n\nTenant tidak bisa login hingga diaktifkan kembali.`
    );
    if (!confirmed) return;

    setActionLoading(true);
    try {
      await platformApi.patch(`/platform/tenants/${id}/status`, {
        status: "suspended",
        reason: reason.trim(),
      });
      await loadData();
    } catch (err) {
      window.alert(err.response?.data?.error || "Gagal suspend tenant");
    } finally {
      setActionLoading(false);
    }
  };

  const handleActivate = async () => {
    const confirmed = window.confirm(
      `Aktifkan kembali tenant "${tenantDisplayName(tenant)}"?`
    );
    if (!confirmed) return;

    setActionLoading(true);
    try {
      await platformApi.patch(`/platform/tenants/${id}/status`, {
        status: "active",
      });
      await loadData();
    } catch (err) {
      window.alert(err.response?.data?.error || "Gagal mengaktifkan tenant");
    } finally {
      setActionLoading(false);
    }
  };

  const handleHardDelete = async () => {
    if (!tenant || !["inactive", "suspended"].includes(tenant.status) ||
        tenant.slug === "default" || getPlatformUser()?.role !== "platform_superadmin" ||
        deleteConfirmation !== "DELETE") return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await platformApi.delete(`/platform/tenants/${tenant.id}`, {
        data: {
          confirmation: "DELETE",
          tenant_id: tenant.id,
          tenant_slug: tenant.slug,
        },
      });
      setDeleteOpen(false);
      navigate("/platform/tenants", { replace: true });
    } catch (err) {
      setDeleteError(err.response?.data?.error || "Hard delete tenant gagal");
    } finally {
      setDeleteBusy(false);
    }
  };

  const saveBilling = async (patch) => {
    setBillingSaving(true);
    setBillingError("");

    try {
      const res = await platformApi.patch(`/platform/tenants/${id}/billing`, patch);
      applyBillingState(res.data?.data || null);
      await loadData();
    } catch (err) {
      setBillingError(err.response?.data?.error || "Gagal menyimpan billing");
    } finally {
      setBillingSaving(false);
    }
  };

  const handleSaveBilling = () => {
    saveBilling({
      plan_code: billingForm.plan_code,
      billing_status: billingForm.billing_status,
      subscription_expires_at: billingForm.subscription_expires_at
        ? new Date(billingForm.subscription_expires_at).toISOString()
        : null,
      billing_notes: billingForm.billing_notes,
    });
  };

  const handleMarkBilling = (billing_status) => {
    saveBilling({ billing_status });
  };

  const handleExtendBilling = () => {
    saveBilling({
      subscription_expires_at: addDays(
        billing?.subscription_expires_at,
        30
      ),
      billing_status: "active",
    });
  };

  if (loading) {
    return <div style={centerStyle}>Memuat detail tenant...</div>;
  }

  if (error || !tenant) {
    return (
      <div>
        <Link to="/platform/tenants" style={backLinkStyle}>
          ← Kembali ke daftar
        </Link>
        <div style={errorBoxStyle}>{error || "Tenant tidak ditemukan"}</div>
      </div>
    );
  }

  const info = dashboard?.tenant || tenant;
  const op = dashboard?.operasional || {};
  const keu = dashboard?.keuangan || {};
  const pend = dashboard?.pendidikan || {};
  const keam = dashboard?.keamanan || {};
  const rfid = dashboard?.rfid || {};
  const isActive = info.status === "active";
  const health = dashboard?.health || tenant.health || {};
  const featureStatus = health.feature_status || {};
  const canShowDeleteTenant = getPlatformUser()?.role === "platform_superadmin" &&
    tenant.slug !== "default";
  const canDeleteTenant = canShowDeleteTenant &&
    ["inactive", "suspended"].includes(tenant.status);

  return (
    <>
      <div style={headerRowStyle}>
        <div>
          <Link to="/platform/tenants" style={backLinkStyle}>
            ← Kembali ke daftar
          </Link>
          <h1 style={pageTitleStyle}>{tenantDisplayName(info)}</h1>
          <div style={{ marginTop: 8 }}>
            <Badge variant={statusBadgeVariant(info.status)}>{info.status}</Badge>
            <code style={slugCodeStyle}>{info.slug}</code>
          </div>
        </div>

        <div style={actionsStyle}>
          <PlatformButton variant="primary" onClick={handleOpenTenantPortal}>
            Buka Portal Tenant
          </PlatformButton>
          <PlatformButton
            variant="secondary"
            onClick={handleResetAdminPassword}
            loading={resetAdminLoading}
          >
            Reset Admin Password
          </PlatformButton>
          {canShowDeleteTenant && (
            <PlatformButton
              variant="danger"
              disabled={!canDeleteTenant || actionLoading || deleteBusy}
              onClick={() => { setDeleteConfirmation(""); setDeleteError(""); setDeleteOpen(true); }}
              title={canDeleteTenant ? "Hapus tenant secara permanen" : "Suspend/nonaktifkan tenant terlebih dahulu"}
            >
              Hapus Tenant Permanen
            </PlatformButton>
          )}
          {isActive ? (
            <PlatformButton
              variant="danger"
              onClick={handleSuspend}
              loading={actionLoading}
            >
              Suspend Tenant
            </PlatformButton>
          ) : (
            <PlatformButton
              variant="success"
              onClick={handleActivate}
              loading={actionLoading}
            >
              Activate Tenant
            </PlatformButton>
          )}
          <PlatformButton variant="secondary" onClick={loadData}>
            Refresh
          </PlatformButton>
        </div>
      </div>

      <BrandProfilePanel
        tenantId={id}
        tenantName={tenantDisplayName(info)}
        tenantSlug={info.slug}
        tenantDomain={tenantDomain}
      />

      <div style={{ marginBottom: 20 }}>
        <Card padding="md" shadow="card" radius="xl">
        <div style={sectionHeaderRowStyle}>
          <SectionHeading spacing="first" variant="divider">
            Tenant Info
          </SectionHeading>
          <PlatformButton variant="secondary" size="sm" onClick={openEditModal}>
            Edit Tenant
          </PlatformButton>
        </div>
        <div style={infoGridStyle}>
          <InfoItem label="Nama" value={tenantDisplayName(info)} />
          <InfoItem label="Slug" value={info.slug} />
          <InfoItem label="Status" value={info.status} />
          <InfoItem label="Alamat" value={info.alamat || "-"} />
          <InfoItem label="Onboarded" value={formatDateShort(info.onboarded_at)} />
          <InfoItem label="Created" value={formatDateShort(info.created_at)} />
          <InfoItem label="Users" value={tenant.user_count ?? "-"} />
          <InfoItem label="Units" value={tenant.unit_count ?? "-"} />
        </div>
        {tenant.suspended_reason && (
          <p style={suspendReasonStyle}>
            Alasan suspend: {tenant.suspended_reason}
          </p>
        )}
        </Card>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Card padding="md" shadow="card" radius="xl">
          <div style={sectionHeaderRowStyle}>
            <SectionHeading spacing="first" variant="divider">Domain Tenant</SectionHeading>
            {!tenantDomain && !domainLoading && (
              <PlatformButton variant="secondary" size="sm" onClick={generateTenantDomain}>Generate Draft</PlatformButton>
            )}
          </div>
          {domainError && <div style={errorBoxStyle}>{domainError}</div>}
          {domainLoading ? <p style={featureHintStyle}>Memuat domain tenant...</p> : tenantDomain ? (
            <div style={infoGridStyle}>
              <InfoItem label="Hostname" value={tenantDomain.hostname} />
              <InfoItem label="DNS" value={tenantDomain.dns_status} />
              <InfoItem label="Vercel" value={tenantDomain.vercel_status} />
              <InfoItem label="SSL" value={tenantDomain.ssl_status} />
              <InfoItem label="Overall" value={tenantDomain.overall_status} />
              <div>
                <div style={infoLabelStyle}>Action</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <PlatformButton variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(tenantDomain.hostname)}>Copy</PlatformButton>
                  {tenantDomain.overall_status === "active" && (
                    <PlatformButton variant="primary" size="sm" onClick={() => window.open(`https://${tenantDomain.hostname}`, "_blank", "noopener,noreferrer")}>Open</PlatformButton>
                  )}
                  {tenantDomain.overall_status !== "active" && tenantDomain.overall_status !== "disabled" && (
                    <PlatformButton variant="primary" size="sm" onClick={() => runTenantDomainAction("provision-all")}>Provision</PlatformButton>
                  )}
                  {tenantDomain.dns_status === "failed" && (
                    <PlatformButton variant="secondary" size="sm" onClick={() => runTenantDomainAction("retry-dns")}>Retry DNS</PlatformButton>
                  )}
                  {tenantDomain.vercel_status === "failed" && (
                    <PlatformButton variant="secondary" size="sm" onClick={() => runTenantDomainAction("retry-vercel")}>Retry Vercel</PlatformButton>
                  )}
                </div>
              </div>
            </div>
          ) : <p style={featureHintStyle}>Draft domain belum dibuat.</p>}
          {tenantDomain?.overall_status !== "active" && (
            <p style={domainWarningStyle}>Domain belum aktif sepenuhnya. Selesaikan DNS, verifikasi Vercel, lalu reconcile SSL.</p>
          )}
        </Card>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Card padding="md" shadow="card" radius="xl">
          <SectionHeading spacing="first" variant="divider">
            Tenant Health
          </SectionHeading>
          <KpiGrid>
            <KpiCard label="Total Santri" value={health.total_santri ?? op.total_santri ?? 0} accent="primary" />
            <KpiCard label="Total Guru" value={health.total_guru ?? op.total_guru ?? 0} accent="info" />
            <KpiCard label="Total Wali" value={health.total_wali ?? op.total_wali ?? 0} accent="success" />
            <KpiCard label="Total User" value={health.total_user ?? tenant.user_count ?? 0} accent="neutral" />
            <KpiCard label="Total Kelas" value={health.total_kelas ?? op.total_kelas ?? 0} accent="success" />
            <KpiCard label="Status Tenant" value={health.status ?? info.status} accent="neutral" />
            <KpiCard label="Feature Enabled" value={health.feature_enabled_count ?? features.filter((f) => f.enabled).length} accent="primary" />
            <KpiCard label="Feature Disabled" value={health.feature_disabled_count ?? features.filter((f) => !f.enabled && !f.is_core).length} accent="warning" />
          </KpiGrid>
          <div style={healthMetaGridStyle}>
            <InfoItem label="Last Activity" value={formatDateTime(health.last_activity_at)} />
            <InfoItem
              label="RFID"
              value={(featureStatus.rfid ?? featureOnOff(features, "rfid")) ? "ON" : "OFF"}
            />
            <InfoItem
              label="Wali App"
              value={(featureStatus.wali_app ?? featureOnOff(features, "wali_app")) ? "ON" : "OFF"}
            />
            <InfoItem
              label="Sahriyah"
              value={(featureStatus.sahriyah ?? featureOnOff(features, "sahriyah")) ? "ON" : "OFF"}
            />
            <InfoItem
              label="Kas Instansi"
              value={(featureStatus.kas_instansi ?? featureOnOff(features, "kas_instansi")) ? "ON" : "OFF"}
            />
          </div>
          {!featuresLoading && features.length > 0 && (
            <div style={healthFeatureGridStyle}>
              <div>
                <div style={healthFeatureTitleStyle}>Feature Enabled</div>
                <div style={healthFeatureListStyle}>
                  {features
                    .filter((f) => f.enabled)
                    .map((f) => f.label)
                    .join(", ") || "—"}
                </div>
              </div>
              <div>
                <div style={healthFeatureTitleStyle}>Feature Disabled</div>
                <div style={healthFeatureListStyle}>
                  {features
                    .filter((f) => !f.enabled && !f.is_core)
                    .map((f) => f.label)
                    .join(", ") || "—"}
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Card padding="md" shadow="card" radius="xl">
          <SectionHeading spacing="first" variant="divider">
            Billing
          </SectionHeading>
          {billingError && <div style={errorBoxStyle}>{billingError}</div>}
          {billingLoading ? (
            <p style={featureHintStyle}>Memuat billing tenant...</p>
          ) : (
            <>
              <div style={billingGridStyle}>
                <div>
                  <div style={infoLabelStyle}>Plan</div>
                  <select
                    value={billingForm.plan_code}
                    onChange={(e) =>
                      setBillingForm((form) => ({
                        ...form,
                        plan_code: e.target.value,
                      }))
                    }
                    style={billingInputStyle}
                    disabled={billingSaving}
                  >
                    {TENANT_PACKAGES.map((pkg) => (
                      <option key={pkg.id} value={pkg.id}>
                        {pkg.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={infoLabelStyle}>Billing Status</div>
                  <select
                    value={billingForm.billing_status}
                    onChange={(e) =>
                      setBillingForm((form) => ({
                        ...form,
                        billing_status: e.target.value,
                      }))
                    }
                    style={billingInputStyle}
                    disabled={billingSaving}
                  >
                    {BILLING_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <div style={{ marginTop: 8 }}>
                    <Badge
                      variant={billingBadgeVariant(billingForm.billing_status)}
                      size="sm"
                    >
                      {billingForm.billing_status}
                    </Badge>
                  </div>
                </div>
                <InfoItem
                  label="Started At"
                  value={formatDateTime(billing?.subscription_started_at)}
                />
                <div>
                  <div style={infoLabelStyle}>Expires At</div>
                  <input
                    type="datetime-local"
                    value={billingForm.subscription_expires_at}
                    onChange={(e) =>
                      setBillingForm((form) => ({
                        ...form,
                        subscription_expires_at: e.target.value,
                      }))
                    }
                    style={billingInputStyle}
                    disabled={billingSaving}
                  />
                </div>
                <InfoItem
                  label="Last Payment"
                  value={formatDateTime(billing?.last_payment_at)}
                />
                <InfoItem
                  label="Next Invoice"
                  value={formatDateTime(billing?.next_invoice_at)}
                />
              </div>
              <div style={billingNotesStyle}>
                <div style={infoLabelStyle}>Notes</div>
                <textarea
                  value={billingForm.billing_notes}
                  onChange={(e) =>
                    setBillingForm((form) => ({
                      ...form,
                      billing_notes: e.target.value,
                    }))
                  }
                  rows={3}
                  style={billingTextareaStyle}
                  disabled={billingSaving}
                />
              </div>
              <div style={billingActionsStyle}>
                <PlatformButton
                  variant="success"
                  onClick={() => handleMarkBilling("active")}
                  loading={billingSaving}
                >
                  Mark Active
                </PlatformButton>
                <PlatformButton
                  variant="secondary"
                  onClick={() => handleMarkBilling("overdue")}
                  loading={billingSaving}
                >
                  Mark Overdue
                </PlatformButton>
                <PlatformButton
                  variant="danger"
                  onClick={() => handleMarkBilling("suspended")}
                  loading={billingSaving}
                >
                  Suspend Billing
                </PlatformButton>
                <PlatformButton
                  variant="secondary"
                  onClick={handleExtendBilling}
                  loading={billingSaving}
                >
                  Extend 30 Days
                </PlatformButton>
                <PlatformButton
                  variant="primary"
                  onClick={handleSaveBilling}
                  loading={billingSaving}
                >
                  Save Billing Notes
                </PlatformButton>
              </div>
            </>
          )}
        </Card>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Card padding="md" shadow="card" radius="xl">
          <SectionHeading spacing="first" variant="divider">
            Support Notes
          </SectionHeading>
          <p style={featureHintStyle}>
            Catatan operasional support untuk tenant ini. Simpan isu, follow-up, dan
            konteks customer tanpa buka VS Code.
          </p>
          <div style={supportNotesPlaceholderStyle}>
            <strong>Coming soon</strong>
            <span>
              Support notes per tenant (issue log, assignment) akan ditambahkan di
              fase berikutnya. Sementara gunakan field Billing Notes di atas atau
              catatan internal owner.
            </span>
          </div>
        </Card>
      </div>

      <div style={{ marginBottom: 20 }}>
        <Card padding="md" shadow="card" radius="xl">
          <SectionHeading spacing="first" variant="divider">
            Feature Management
          </SectionHeading>
          <div style={packageToolbarStyle}>
            <div style={packageBadgeWrapStyle}>
              <span style={packageLabelStyle}>Current Package</span>
              <Badge
                variant={currentPackage?.id === "custom" ? "warning" : "success"}
                size="sm"
              >
                {currentPackage?.label || "Custom"}
              </Badge>
            </div>
            <div style={packageApplyStyle}>
              <select
                value={selectedPackage}
                onChange={(e) => setSelectedPackage(e.target.value)}
                style={packageSelectStyle}
                disabled={packageSaving || featuresLoading}
              >
                {APPLY_PACKAGE_OPTIONS.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.label}
                  </option>
                ))}
              </select>
              <PlatformButton
                variant="secondary"
                onClick={handleApplyPackage}
                loading={packageSaving}
                disabled={featuresLoading || features.length === 0}
              >
                {selectedPackage === "custom" ? "Terapkan Custom" : "Apply Package"}
              </PlatformButton>
            </div>
          </div>
          <p style={featureHintStyle}>
            {selectedPackage === "custom"
              ? "Mode Custom memakai checklist fitur di bawah. Atur modul yang dibutuhkan; fitur core tetap aktif."
              : "Aktifkan atau nonaktifkan modul untuk tenant ini. Fitur core tidak bisa dimatikan."}
          </p>

          {featuresError && <div style={errorBoxStyle}>{featuresError}</div>}

          {featuresLoading ? (
            <p style={featureHintStyle}>Memuat daftar fitur...</p>
          ) : (
            <>
              <div style={featureListStyle}>
                {features.map((feature) => (
                  <label key={feature.key} style={featureRowStyle}>
                    <input
                      type="checkbox"
                      checked={feature.enabled}
                      disabled={feature.is_core}
                      onChange={() => handleToggleFeature(feature.key)}
                    />
                    <span style={featureLabelWrapStyle}>
                      <span style={featureNameStyle}>
                        {feature.label}
                        {feature.is_core ? (
                          <span style={featureCoreBadgeStyle}>Core</span>
                        ) : null}
                      </span>
                      {feature.description ? (
                        <span style={featureDescStyle}>{feature.description}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
                <PlatformButton
                  variant="primary"
                  onClick={handleSaveFeatures}
                  loading={featuresSaving}
                  disabled={featuresLoading || features.length === 0}
                >
                  Simpan Fitur
                </PlatformButton>
              </div>
            </>
          )}
        </Card>
      </div>

      <SectionHeading spacing="first">Operasional</SectionHeading>
      <KpiGrid>
        <KpiCard label="Total Santri" value={op.total_santri ?? 0} accent="primary" />
        <KpiCard label="Total Guru" value={op.total_guru ?? 0} accent="info" />
        <KpiCard label="Total Wali" value={op.total_wali ?? 0} accent="neutral" />
        <KpiCard label="Total Kelas" value={op.total_kelas ?? 0} accent="success" />
      </KpiGrid>

      <SectionHeading>Keuangan</SectionHeading>
      <KpiGrid>
        <KpiCard
          label="Tagihan Aktif"
          value={keu.tagihan_aktif_count ?? 0}
          trend={formatCurrency(keu.tagihan_aktif_nominal ?? 0)}
        />
        <KpiCard
          label="Pembayaran Bulan Ini"
          value={keu.pembayaran_bulan_ini_count ?? 0}
          trend={formatCurrency(keu.pembayaran_bulan_ini_nominal ?? 0)}
        />
        <KpiCard
          label="Saldo Buku Kas"
          value={formatCurrency(keu.saldo_buku_kas ?? 0)}
          accent="success"
        />
        <KpiCard
          label="Saldo Kas Instansi"
          value={formatCurrency(keu.saldo_kas_instansi ?? 0)}
          accent="teal"
        />
      </KpiGrid>

      <SectionHeading>Pendidikan</SectionHeading>
      <KpiGrid>
        <KpiCard
          label="Kehadiran Santri"
          value={`${pend.kehadiran_santri_pct ?? 0}%`}
          accent="primary"
        />
        <KpiCard
          label="Kehadiran Guru"
          value={`${pend.kehadiran_guru_pct ?? 0}%`}
          accent="info"
        />
        <KpiCard label="Total Hafalan" value={pend.total_hafalan ?? 0} />
        <KpiCard label="Rata-rata Nilai" value={pend.rata_nilai ?? 0} />
      </KpiGrid>

      <SectionHeading>Keamanan</SectionHeading>
      <KpiGrid>
        <KpiCard label="Santri Izin Aktif" value={keam.santri_izin_aktif ?? 0} accent="warning" />
        <KpiCard label="Pelanggaran Bulan Ini" value={keam.pelanggaran_bulan_ini ?? 0} accent="danger" />
      </KpiGrid>

      <SectionHeading>RFID</SectionHeading>
      <KpiGrid>
        <KpiCard
          label="Topup Hari Ini"
          value={formatCurrency(rfid.topup_hari_ini ?? 0)}
          accent="success"
        />
        <KpiCard label="Transaksi Hari Ini" value={rfid.transaksi_hari_ini ?? 0} />
        <KpiCard label="Device Online" value={rfid.device_online ?? 0} accent="info" />
        <KpiCard label="Merchant Aktif" value={rfid.merchant_aktif ?? 0} />
      </KpiGrid>

      {dashboard?.generated_at && (
        <p style={generatedStyle}>
          Data dashboard: {formatDateShort(dashboard.generated_at)}{" "}
          {new Date(dashboard.generated_at).toLocaleTimeString("id-ID")}
        </p>
      )}

      <Modal
        open={editOpen}
        title="Edit Tenant"
        onClose={closeEditModal}
      >
        <div style={modalFormStyle}>
          {editError ? <div style={errorBoxStyle}>{editError}</div> : null}
          <label style={fieldLabelStyle}>
            Nama Tenant / Nama Pesantren
            <input
              style={fieldInputStyle}
              value={editForm.nama}
              onChange={(e) => setEditForm((prev) => ({ ...prev, nama: e.target.value }))}
            />
          </label>
          <label style={fieldLabelStyle}>
            Nama Tampilan Admin/PWA
            <input
              style={fieldInputStyle}
              value={editForm.tenant_display_name}
              placeholder="Kosongkan untuk memakai nama tenant canonical"
              onChange={(e) => setEditForm((prev) => ({ ...prev, tenant_display_name: e.target.value }))}
            />
          </label>
          <label style={fieldLabelStyle}>
            Slug (kebab-case)
            <input
              style={fieldInputStyle}
              value={editForm.slug}
              onChange={(e) =>
                setEditForm((prev) => ({
                  ...prev,
                  slug: e.target.value.toLowerCase().replace(/\s+/g, "-"),
                }))
              }
            />
          </label>
          {tenant?.slug === "default" && editForm.slug !== "default" ? (
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={confirmDefaultSlug}
                onChange={(e) => setConfirmDefaultSlug(e.target.checked)}
              />
              Saya mengerti risiko mengubah slug tenant default
            </label>
          ) : null}
          <label style={fieldLabelStyle}>
            Status
            <select
              style={fieldInputStyle}
              value={editForm.status}
              onChange={(e) => setEditForm((prev) => ({ ...prev, status: e.target.value }))}
            >
              <option value="active">active</option>
              <option value="suspended">suspended</option>
              <option value="inactive">inactive</option>
            </select>
          </label>
          <label style={fieldLabelStyle}>
            Alamat
            <textarea
              style={{ ...fieldInputStyle, minHeight: 72, resize: "vertical" }}
              value={editForm.alamat}
              onChange={(e) => setEditForm((prev) => ({ ...prev, alamat: e.target.value }))}
            />
          </label>
          <label style={fieldLabelStyle}>
            Telepon
            <input
              style={fieldInputStyle}
              value={editForm.telepon}
              onChange={(e) => setEditForm((prev) => ({ ...prev, telepon: e.target.value }))}
            />
          </label>
          <label style={fieldLabelStyle}>
            Tagline
            <input
              style={fieldInputStyle}
              value={editForm.tagline}
              onChange={(e) => setEditForm((prev) => ({ ...prev, tagline: e.target.value }))}
            />
          </label>
          <div style={modalActionsStyle}>
            <PlatformButton variant="secondary" onClick={closeEditModal} disabled={editSaving}>
              Batal
            </PlatformButton>
            <PlatformButton variant="primary" onClick={handleSaveEditTenant} loading={editSaving}>
              Simpan
            </PlatformButton>
          </div>
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        title="Hapus Tenant Permanen"
        onClose={() => { if (!deleteBusy) setDeleteOpen(false); }}
        width={540}
      >
        <p style={errorBoxStyle}>
          PERINGATAN: tindakan ini permanen. Semua data milik tenant ini akan dihapus
          dan tidak dapat dipulihkan melalui aplikasi.
        </p>
        <p>Target: <strong>{tenantDisplayName(tenant)}</strong> · {tenant?.slug} · ID {tenant?.id}</p>
        <label style={fieldLabelStyle}>
          Ketik DELETE untuk mengonfirmasi target di atas
          <input
            style={fieldInputStyle}
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            autoComplete="off"
            disabled={deleteBusy}
          />
        </label>
        {deleteError && <div style={errorBoxStyle}>{deleteError}</div>}
        <div style={modalActionsStyle}>
          <PlatformButton variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>
            Batal
          </PlatformButton>
          <PlatformButton variant="danger" onClick={handleHardDelete}
            disabled={!canDeleteTenant || deleteConfirmation !== "DELETE" || deleteBusy}
            loading={deleteBusy}>
            Hapus Permanen
          </PlatformButton>
        </div>
      </Modal>

      <Modal
        open={resetAdminOpen}
        title="Reset Admin Tenant Password"
        onClose={closeResetAdminModal}
        width={540}
      >
        <div>
          <p style={resetAdminHintStyle}>
            Password baru hanya ditampilkan sekali. Jangan kirim lewat channel
            publik.
          </p>
          {resetAdminError && <div style={errorBoxStyle}>{resetAdminError}</div>}
          {resetAdminLoading ? (
            <p style={featureHintStyle}>Membuat password baru...</p>
          ) : resetAdminCredential ? (
            <>
              <div style={credentialBoxStyle}>
                <div><strong>Tenant:</strong> {tenantDisplayName(tenant)}</div>
                <div><strong>Slug:</strong> {tenant.slug}</div>
                <div><strong>Nama Admin:</strong> {resetAdminCredential.nama || "-"}</div>
                <div><strong>Username:</strong> {resetAdminCredential.username}</div>
                <div><strong>Password:</strong> {resetAdminCredential.password}</div>
              </div>
              <div style={deleteActionsStyle}>
                <PlatformButton variant="secondary" onClick={handleCopyResetAdminCredential}>
                  {resetAdminCopied ? "Tersalin" : "Salin Kredensial"}
                </PlatformButton>
                <PlatformButton onClick={closeResetAdminModal}>Tutup</PlatformButton>
              </div>
            </>
          ) : null}
        </div>
      </Modal>

    </>
  );
}

function InfoItem({ label, value }) {
  return (
    <div>
      <div style={infoLabelStyle}>{label}</div>
      <div style={infoValueStyle}>{value ?? "-"}</div>
    </div>
  );
}

const centerStyle = {
  padding: 40,
  textAlign: "center",
  color: "var(--text-secondary)",
};

const headerRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  marginBottom: 20,
  flexWrap: "wrap",
};

const pageTitleStyle = {
  margin: "8px 0 0",
  fontSize: "26px",
  fontWeight: 800,
  color: "var(--text-primary)",
};

const backLinkStyle = {
  fontSize: "13px",
  color: "var(--text-secondary)",
  textDecoration: "none",
  fontWeight: 600,
};

const slugCodeStyle = {
  marginLeft: 10,
  fontSize: "13px",
  background: "var(--neutral-subtle)",
  padding: "2px 8px",
  borderRadius: "4px",
};

const actionsStyle = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};

const infoGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 16,
  marginTop: 8,
};

const sectionHeaderRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};

const modalFormStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const fieldLabelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--text-primary)",
};

const fieldInputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  fontSize: "14px",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const checkboxLabelStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  fontSize: "13px",
  color: "var(--warning)",
  fontWeight: 600,
};

const modalActionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 8,
};

const infoLabelStyle = {
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-secondary)",
  marginBottom: 4,
};

const infoValueStyle = {
  fontSize: "15px",
  fontWeight: 600,
  color: "var(--text-primary)",
};

const suspendReasonStyle = {
  marginTop: 16,
  marginBottom: 0,
  padding: "10px 12px",
  borderRadius: "var(--radius-sm)",
  background: "var(--warning-subtle)",
  color: "var(--warning)",
  fontSize: "13px",
  fontWeight: 600,
};

const errorBoxStyle = {
  marginTop: 16,
  padding: "12px 14px",
  borderRadius: "var(--radius-sm)",
  background: "var(--danger-subtle)",
  color: "var(--danger)",
  fontWeight: 600,
};

const domainWarningStyle = {
  margin: "16px 0 0",
  padding: "10px 12px",
  borderRadius: "var(--radius-sm)",
  background: "var(--warning-subtle)",
  color: "#92400e",
  fontSize: "13px",
  fontWeight: 600,
};

const generatedStyle = {
  marginTop: 24,
  fontSize: "12px",
  color: "var(--text-muted)",
};

const packageToolbarStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 12,
};

const packageBadgeWrapStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const packageLabelStyle = {
  fontSize: "12px",
  fontWeight: 700,
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const packageApplyStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const packageSelectStyle = {
  minWidth: 140,
  padding: "9px 10px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--surface)",
  color: "var(--text-primary)",
  fontSize: "14px",
};

const featureHintStyle = {
  margin: "0 0 12px",
  fontSize: "13px",
  color: "var(--text-secondary)",
  lineHeight: 1.5,
};

const supportNotesPlaceholderStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "14px 16px",
  borderRadius: "var(--radius-md)",
  background: "var(--success-subtle)",
  border: "1px dashed #93c5fd",
  color: "#1e3a8a",
  fontSize: "13px",
  lineHeight: 1.5,
};

const featureListStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 10,
};

const featureRowStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "10px 12px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--surface)",
  cursor: "pointer",
};

const featureLabelWrapStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
};

const featureNameStyle = {
  fontSize: "14px",
  fontWeight: 700,
  color: "var(--text-primary)",
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const featureDescStyle = {
  fontSize: "12px",
  color: "var(--text-secondary)",
  lineHeight: 1.4,
};

const featureCoreBadgeStyle = {
  display: "inline-flex",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: "10px",
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#166534",
  background: "rgba(22, 101, 52, 0.12)",
};

const healthFeatureGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 16,
  marginTop: 16,
};

const healthMetaGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 14,
  marginTop: 16,
  paddingTop: 16,
  borderTop: "1px solid var(--border)",
};

const healthFeatureTitleStyle = {
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-secondary)",
  marginBottom: 6,
};

const healthFeatureListStyle = {
  fontSize: "13px",
  color: "var(--text-primary)",
  lineHeight: 1.5,
};

const billingGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 16,
};

const billingInputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 10px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--surface)",
  color: "var(--text-primary)",
  fontSize: "14px",
};

const billingNotesStyle = {
  marginTop: 14,
};

const billingTextareaStyle = {
  ...billingInputStyle,
  minHeight: 78,
  resize: "vertical",
};

const billingActionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  flexWrap: "wrap",
  marginTop: 16,
};

const resetAdminHintStyle = {
  margin: "0 0 12px",
  padding: "10px 12px",
  borderRadius: "var(--radius-sm)",
  background: "rgba(22, 101, 52, 0.1)",
  color: "#166534",
  fontWeight: 700,
  fontSize: "13px",
};

const credentialBoxStyle = {
  display: "grid",
  gap: 8,
  padding: 14,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--neutral-subtle)",
  color: "var(--text-primary)",
  fontSize: "14px",
};

const deleteActionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 16,
  flexWrap: "wrap",
};

export default PlatformTenantDetailPage;
