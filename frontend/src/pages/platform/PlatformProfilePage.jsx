import { useCallback, useEffect, useState } from "react";
import platformApi from "../../services/platformApi";
import PlatformButton from "../../components/platform/PlatformButton";
import ImageUploadField from "../../components/ImageUploadField";
import { uploadImageForPlatform } from "../../services/upload";

const TEXT_FIELDS = [
  { key: "platform_name", label: "Nama Platform", type: "text" },
  { key: "tagline", label: "Tagline", type: "text" },
  { key: "description", label: "Deskripsi Singkat", type: "textarea" },
  { key: "support_whatsapp", label: "Support WhatsApp", type: "text" },
  { key: "support_email", label: "Support Email", type: "email" },
  { key: "website_url", label: "Website URL", type: "text" },
  { key: "about_text", label: "About Text", type: "textarea" },
  { key: "tutorial_video_url", label: "Tutorial Video URL", type: "text" },
];

function PlatformProfilePage() {
  const [form, setForm] = useState({});
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await platformApi.get("/platform/settings");
      setForm(res.data?.data?.settings || {});
      setUpdatedAt(res.data?.data?.updated_at || null);
    } catch (err) {
      setError(err.response?.data?.error || "Gagal memuat settings platform");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Existing async loader owns its state transitions.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await platformApi.patch("/platform/settings", form);
      setForm(res.data?.data?.settings || form);
      setUpdatedAt(res.data?.data?.updated_at || null);
      setSuccess("Settings platform berhasil disimpan.");
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menyimpan settings platform");
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError("");
    setPasswordSuccess("");

    if (!passwordForm.current_password || !passwordForm.new_password) {
      setPasswordError("Password lama dan password baru wajib diisi.");
      return;
    }

    if (passwordForm.new_password.length < 8) {
      setPasswordError("Password baru minimal 8 karakter.");
      return;
    }

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordError("Konfirmasi password baru tidak sama.");
      return;
    }

    setSavingPassword(true);
    try {
      await platformApi.patch("/platform/auth/password", {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      });
      setPasswordForm({
        current_password: "",
        new_password: "",
        confirm_password: "",
      });
      setPasswordSuccess("Password platform berhasil diganti.");
    } catch (err) {
      setPasswordError(err.response?.data?.error || "Gagal mengganti password platform");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div>
      <h1 className="platform-page-title">Profile Platform</h1>
      <p className="platform-page-subtitle">
        Branding dan informasi KlikPesantren yang ditampilkan ke admin pesantren.
      </p>

      {error ? <div className="theme-alert theme-alert--danger">{error}</div> : null}
      {success ? <div className="theme-alert theme-alert--success">{success}</div> : null}

      <div className="platform-compact-card">
        <h2 className="theme-section-title">Branding KlikPesantren</h2>

        {loading ? (
          <p className="theme-muted">Memuat...</p>
        ) : (
          <>
            <div className="theme-logo-zone">
              <ImageUploadField
                id="platform-logo"
                label="Upload Logo"
                value={form.logo_url || ""}
                onChange={(url) => setForm((prev) => ({ ...prev, logo_url: url }))}
                uploadFn={uploadImageForPlatform}
                pickLabel="Upload Logo"
                previewHeight={80}
              />
              <p className="theme-muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
                Logo disimpan otomatis setelah upload. Tidak perlu input URL manual.
              </p>
            </div>

            <div style={formGridStyle}>
              {TEXT_FIELDS.map((field) => (
                <label key={field.key} className="theme-field-label">
                  {field.label}
                  {field.type === "textarea" ? (
                    <textarea
                      className="theme-field"
                      value={form[field.key] ?? ""}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                    />
                  ) : (
                    <input
                      className="theme-field"
                      type={field.type}
                      value={form[field.key] || ""}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          [field.key]: e.target.value,
                        }))
                      }
                    />
                  )}
                </label>
              ))}
            </div>
          </>
        )}

        <div style={actionsStyle}>
          <PlatformButton variant="secondary" onClick={loadSettings} disabled={loading || saving}>
            Refresh
          </PlatformButton>
          <PlatformButton variant="primary" onClick={handleSave} loading={saving} disabled={loading}>
            Simpan Settings
          </PlatformButton>
        </div>

        {updatedAt ? (
          <p className="theme-muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
            Terakhir diperbarui: {new Date(updatedAt).toLocaleString("id-ID")}
          </p>
        ) : null}
      </div>

      <div className="platform-compact-card" style={{ marginTop: 14 }}>
        <h2 className="theme-section-title">Keamanan Akun Platform</h2>
        <p className="theme-muted" style={{ marginTop: -4 }}>
          Ganti password owner/platform tanpa mengubah tenant atau data pesantren.
        </p>

        {passwordError ? (
          <div className="theme-alert theme-alert--danger">{passwordError}</div>
        ) : null}
        {passwordSuccess ? (
          <div className="theme-alert theme-alert--success">{passwordSuccess}</div>
        ) : null}

        <div style={formGridStyle}>
          <label className="theme-field-label">
            Password Lama
            <input
              className="theme-field"
              type="password"
              autoComplete="current-password"
              value={passwordForm.current_password}
              onChange={(e) =>
                setPasswordForm((prev) => ({
                  ...prev,
                  current_password: e.target.value,
                }))
              }
            />
          </label>
          <label className="theme-field-label">
            Password Baru
            <input
              className="theme-field"
              type="password"
              autoComplete="new-password"
              value={passwordForm.new_password}
              onChange={(e) =>
                setPasswordForm((prev) => ({
                  ...prev,
                  new_password: e.target.value,
                }))
              }
            />
          </label>
          <label className="theme-field-label">
            Ulangi Password Baru
            <input
              className="theme-field"
              type="password"
              autoComplete="new-password"
              value={passwordForm.confirm_password}
              onChange={(e) =>
                setPasswordForm((prev) => ({
                  ...prev,
                  confirm_password: e.target.value,
                }))
              }
            />
          </label>
        </div>

        <div style={actionsStyle}>
          <PlatformButton
            variant="primary"
            onClick={handlePasswordChange}
            loading={savingPassword}
          >
            Ganti Password
          </PlatformButton>
        </div>

        <p className="theme-muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          Kalau lupa password dan tidak bisa login, gunakan recovery server:
          {" "}
          <code>node scripts/platform-password-rotate.js</code>.
          Password baru tampil sekali di terminal.
        </p>
      </div>
    </div>
  );
}

const formGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 14,
};

const actionsStyle = {
  display: "flex",
  gap: 10,
  marginTop: 16,
};

export default PlatformProfilePage;
