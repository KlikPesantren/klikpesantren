import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import platformApi from "../../services/platformApi";
import Badge from "../../components/ui/Badge";
import PlatformButton from "../../components/platform/PlatformButton";
import {
  PlatformConsoleShell,
} from "../../components/platform/PlatformConsoleShell";
import { formatDateShort } from "../../utils/formatDate";

const EMPTY_PAYMENT_SETTINGS = {
  warning_days_before_due: "",
  billing_bank_name: "",
  billing_account_number: "",
  billing_account_holder: "",
  billing_payment_instruction: "",
  billing_confirmation_whatsapp: "",
  billing_confirmation_message_template: "",
};

function hydratePaymentSettings(settings = {}) {
  return {
    warning_days_before_due: settings.warning_days_before_due == null
      ? ""
      : String(settings.warning_days_before_due),
    billing_bank_name: settings.billing_bank_name ?? "",
    billing_account_number: settings.billing_account_number ?? "",
    billing_account_holder: settings.billing_account_holder ?? "",
    billing_payment_instruction: settings.billing_payment_instruction ?? "",
    billing_confirmation_whatsapp: settings.billing_confirmation_whatsapp ?? "",
    billing_confirmation_message_template:
      settings.billing_confirmation_message_template ?? "",
  };
}

function billingBadgeVariant(status) {
  if (status === "active") return "success";
  if (status === "trial") return "info";
  if (status === "overdue") return "warning";
  if (status === "suspended" || status === "cancelled") return "danger";
  return "neutral";
}

function tenantDisplayName(row) {
  return row?.nama || row?.name || "-";
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function PlatformBillingOverviewPage({ mode = "subscriptions" }) {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(mode === "subscriptions");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsSuccess, setSettingsSuccess] = useState("");
  const [settingsUpdatedAt, setSettingsUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await platformApi.get("/platform/tenants");
      setTenants(res.data?.data || []);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal memuat billing tenant");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Async loader owns its state transitions.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const loadPaymentSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError("");
    try {
      const res = await platformApi.get("/platform/settings");
      setPaymentForm(hydratePaymentSettings(res.data?.data?.settings));
      setSettingsUpdatedAt(res.data?.data?.updated_at || null);
    } catch (err) {
      setSettingsError(
        err.response?.data?.error || "Gagal memuat pengaturan pembayaran",
      );
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "subscriptions") {
      // Async loader owns its state transitions.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadPaymentSettings();
    }
  }, [loadPaymentSettings, mode]);

  const updatePaymentField = (key, value) => {
    setPaymentForm((current) => ({ ...current, [key]: value }));
    setSettingsSuccess("");
  };

  const savePaymentSettings = async (event) => {
    event.preventDefault();
    setSettingsError("");
    setSettingsSuccess("");

    const rawWarningDays = paymentForm.warning_days_before_due.trim();
    const warningDays = Number(rawWarningDays);
    if (
      rawWarningDays === ""
      || !Number.isInteger(warningDays)
      || warningDays < 0
      || warningDays > 365
    ) {
      setSettingsError("Peringatan harus berupa bilangan bulat antara 0 dan 365 hari.");
      return;
    }

    setSettingsSaving(true);
    try {
      const res = await platformApi.patch("/platform/settings", {
        ...paymentForm,
        warning_days_before_due: warningDays,
      });
      setPaymentForm(hydratePaymentSettings(res.data?.data?.settings));
      setSettingsUpdatedAt(res.data?.data?.updated_at || null);
      setSettingsSuccess("Pengaturan pembayaran berhasil disimpan.");
    } catch (err) {
      setSettingsError(
        err.response?.data?.error || "Gagal menyimpan pengaturan pembayaran",
      );
    } finally {
      setSettingsSaving(false);
    }
  };

  const filtered = useMemo(() => {
    if (mode === "overdue") {
      return tenants.filter((t) => t.billing_status === "overdue");
    }
    if (mode === "expiring-soon") {
      return tenants.filter((t) => {
        const days = daysUntil(t.subscription_expires_at);
        return days != null && days >= 0 && days <= 30;
      });
    }
    return tenants;
  }, [tenants, mode]);

  const pageCopy = {
    subscriptions: {
      badge: "BILLING OPS",
      title: "Subscriptions",
      subtitle: "Ringkasan billing manual semua tenant. Detail & edit di Tenant Detail.",
    },
    overdue: {
      badge: "BILLING ALERT",
      title: "Overdue",
      subtitle: "Tenant dengan status billing overdue — perlu follow-up owner.",
    },
    "expiring-soon": {
      badge: "BILLING ALERT",
      title: "Expiring Soon",
      subtitle: "Langganan berakhir dalam 30 hari ke depan.",
    },
  };

  const copy = pageCopy[mode] || pageCopy.subscriptions;

  return (
    <PlatformConsoleShell
      badge={copy.badge}
      title={copy.title}
      subtitle={copy.subtitle}
      primaryLink="/platform/tenants"
      primaryLabel="Semua Tenants"
    >
      {mode === "subscriptions" ? (
        <section className="platform-compact-card" style={{ marginBottom: 16 }}>
          <h2 className="theme-section-title">Pengaturan Pembayaran Langganan</h2>
          <p className="theme-muted" style={{ marginTop: -4 }}>
            Konfigurasi global tujuan pembayaran dan awal periode pengingat untuk seluruh tenant.
            Nominal, status, dan jatuh tempo tetap dikelola per tenant.
          </p>

          {settingsError ? (
            <div className="theme-alert theme-alert--danger">{settingsError}</div>
          ) : null}
          {settingsSuccess ? (
            <div className="theme-alert theme-alert--success">{settingsSuccess}</div>
          ) : null}

          {settingsLoading ? (
            <p className="theme-muted">Memuat pengaturan pembayaran...</p>
          ) : (
            <form onSubmit={savePaymentSettings}>
              <div style={settingsGridStyle}>
                <label className="theme-field-label">
                  Peringatan sebelum jatuh tempo
                  <div style={numberFieldStyle}>
                    <input
                      className="theme-field"
                      type="number"
                      min="0"
                      max="365"
                      step="1"
                      required
                      value={paymentForm.warning_days_before_due}
                      onChange={(event) =>
                        updatePaymentField("warning_days_before_due", event.target.value)
                      }
                    />
                    <span>hari</span>
                  </div>
                </label>
                <label className="theme-field-label">
                  Nama Bank
                  <input
                    className="theme-field"
                    type="text"
                    value={paymentForm.billing_bank_name}
                    onChange={(event) =>
                      updatePaymentField("billing_bank_name", event.target.value)
                    }
                  />
                </label>
                <label className="theme-field-label">
                  Nomor Rekening
                  <input
                    className="theme-field"
                    type="text"
                    inputMode="numeric"
                    value={paymentForm.billing_account_number}
                    onChange={(event) =>
                      updatePaymentField("billing_account_number", event.target.value)
                    }
                  />
                </label>
                <label className="theme-field-label">
                  Atas Nama
                  <input
                    className="theme-field"
                    type="text"
                    value={paymentForm.billing_account_holder}
                    onChange={(event) =>
                      updatePaymentField("billing_account_holder", event.target.value)
                    }
                  />
                </label>
                <label className="theme-field-label">
                  WhatsApp Konfirmasi
                  <input
                    className="theme-field"
                    type="text"
                    inputMode="tel"
                    value={paymentForm.billing_confirmation_whatsapp}
                    onChange={(event) =>
                      updatePaymentField(
                        "billing_confirmation_whatsapp",
                        event.target.value,
                      )
                    }
                  />
                  <span style={helperStyle}>
                    Tautan WhatsApp memakai normalisasi nomor yang sudah digunakan sistem.
                  </span>
                </label>
                <label className="theme-field-label" style={wideFieldStyle}>
                  Instruksi Pembayaran
                  <textarea
                    className="theme-field"
                    rows="3"
                    value={paymentForm.billing_payment_instruction}
                    onChange={(event) =>
                      updatePaymentField("billing_payment_instruction", event.target.value)
                    }
                  />
                </label>
                <label className="theme-field-label" style={wideFieldStyle}>
                  Template Pesan Konfirmasi
                  <textarea
                    className="theme-field"
                    rows="3"
                    value={paymentForm.billing_confirmation_message_template}
                    onChange={(event) =>
                      updatePaymentField(
                        "billing_confirmation_message_template",
                        event.target.value,
                      )
                    }
                  />
                  <span style={helperStyle}>
                    Placeholder yang didukung: <code>{"{tenant_name}"}</code>.
                  </span>
                </label>
              </div>

              <div style={settingsActionsStyle}>
                <PlatformButton
                  variant="primary"
                  type="submit"
                  loading={settingsSaving}
                  disabled={settingsLoading}
                >
                  Simpan Pengaturan Pembayaran
                </PlatformButton>
              </div>
              {settingsUpdatedAt ? (
                <p className="theme-muted" style={updatedAtStyle}>
                  Terakhir diperbarui:{" "}
                  {new Date(settingsUpdatedAt).toLocaleString("id-ID")}
                </p>
              ) : null}
            </form>
          )}
        </section>
      ) : null}
      {error && (
        <div style={errorStyle}>{error}</div>
      )}
      <div className="platform-console-table-wrap">
        {loading ? (
          <div className="platform-console-empty">Memuat...</div>
        ) : filtered.length === 0 ? (
          <div className="platform-console-empty">Tidak ada tenant untuk filter ini.</div>
        ) : (
          <table className="platform-console-table">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Plan</th>
                <th>Billing</th>
                <th>Expires</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/platform/tenants/${t.id}`}>{tenantDisplayName(t)}</Link>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{t.slug}</div>
                  </td>
                  <td>{t.plan_code || t.current_package?.label || "-"}</td>
                  <td>
                    <Badge variant={billingBadgeVariant(t.billing_status)} size="sm">
                      {t.billing_status || "active"}
                    </Badge>
                  </td>
                  <td>{formatDateShort(t.subscription_expires_at) || "-"}</td>
                  <td>
                    <Badge variant={t.status === "active" ? "success" : "danger"} size="sm">
                      {t.status}
                    </Badge>
                  </td>
                  <td>
                    <Link to={`/platform/tenants/${t.id}`}>Billing →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PlatformConsoleShell>
  );
}

const errorStyle = {
  padding: "12px 14px",
  borderRadius: 8,
  background: "var(--danger-subtle)",
  color: "var(--danger)",
  fontWeight: 600,
};

const settingsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
};

const wideFieldStyle = {
  gridColumn: "1 / -1",
};

const numberFieldStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 10,
};

const helperStyle = {
  display: "block",
  marginTop: 6,
  color: "var(--text-secondary)",
  fontSize: 12,
  fontWeight: 400,
};

const settingsActionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 16,
};

const updatedAtStyle = {
  marginTop: 10,
  marginBottom: 0,
  fontSize: 12,
  textAlign: "right",
};

export default PlatformBillingOverviewPage;
