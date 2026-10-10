import { useId, useRef, useState } from "react";
import platformApi from "../../services/platformApi";
import PlatformButton from "./PlatformButton";

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

export default function WebsiteAssetField({ label, value, onChange }) {
  const inputId = useId();
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [unavailableUrl, setUnavailableUrl] = useState("");
  const unavailable = Boolean(value && unavailableUrl === value);

  async function uploadAsset(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ALLOWED_TYPES.has(file.type)) {
      setError("Format gambar harus PNG, JPG, JPEG, atau WebP.");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("Ukuran gambar maksimal 5MB.");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await platformApi.post("/platform/website/assets", formData);
      const url = response.data?.data?.url;
      if (!url) throw new Error("URL asset tidak tersedia pada response upload.");
      onChange(url);
    } catch (uploadError) {
      setError(uploadError.response?.data?.error || uploadError.message || "Upload gambar gagal.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="theme-field-label" style={{ gridColumn: "1 / -1" }}>
      <span>{label}</span>
      <span className="theme-muted" style={{ fontSize: 12 }}>Gambar saat ini</span>
      <div style={previewStyle}>
        {!value ? (
          <span className="theme-muted" style={stateTextStyle}>Belum ada asset</span>
        ) : unavailable ? (
          <span role="status" style={unavailableStyle}>Gambar tidak dapat ditampilkan</span>
        ) : (
          <img src={value} alt={`Gambar saat ini: ${label}`} onLoad={() => setUnavailableUrl("")} onError={() => setUnavailableUrl(value)} style={imageStyle} />
        )}
      </div>
      <input className="theme-field" type="url" value={value || ""} placeholder="URL / referensi asset" aria-label={`${label} URL`} onChange={(event) => { setError(""); onChange(event.target.value); }} />
      <input ref={fileInputRef} id={inputId} type="file" accept="image/png,image/jpeg,image/jpg,image/webp" onChange={uploadAsset} style={{ display: "none" }} />
      <div style={actionsStyle}>
        <PlatformButton type="button" variant="secondary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          {uploading ? "Mengupload..." : value ? "Upload / Ganti Gambar" : "Upload Gambar"}
        </PlatformButton>
        <span className="theme-muted" style={{ fontSize: 12 }}>Perubahan baru masuk Draft setelah Simpan Draft.</span>
      </div>
      {error ? <span role="alert" style={errorStyle}>{error}</span> : null}
    </div>
  );
}

const previewStyle = { width: "100%", maxWidth: 360, minHeight: 128, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--surface-muted)" };
const imageStyle = { width: "100%", height: 160, objectFit: "contain" };
const stateTextStyle = { padding: 20, textAlign: "center" };
const unavailableStyle = { ...stateTextStyle, color: "var(--danger)", fontWeight: 700 };
const actionsStyle = { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" };
const errorStyle = { color: "var(--danger)", fontSize: 12, fontWeight: 700 };
