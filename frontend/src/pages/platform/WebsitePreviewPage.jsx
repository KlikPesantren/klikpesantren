import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

export default function WebsitePreviewPage() {
  const [viewport, setViewport] = useState("desktop");
  const [view, setView] = useState("home");
  const src = useMemo(() => `/platform/website/preview/render?view=${view}`, [view]);

  return (
    <div style={pageStyle}>
      <header style={toolbarStyle}>
        <div>
          <strong>Preview Draft Website</strong>
          <span style={hintStyle}>Draft tersimpan · bukan website production</span>
        </div>
        <div style={controlsStyle}>
          <select value={view} onChange={(event) => setView(event.target.value)} style={controlStyle}>
            <option value="home">Homepage</option>
            <option value="founding">Founding Partner</option>
          </select>
          <button type="button" onClick={() => setViewport("desktop")} style={controlStyle}>Desktop</button>
          <button type="button" onClick={() => setViewport("mobile")} style={controlStyle}>Mobile</button>
          <Link to="/platform/website" style={backStyle}>Kembali ke Editor</Link>
        </div>
      </header>
      <main style={stageStyle}>
        <iframe
          key={src}
          title="Preview draft website KlikPesantren"
          src={src}
          style={{ ...frameStyle, width: viewport === "mobile" ? 390 : "100%" }}
        />
      </main>
    </div>
  );
}

const pageStyle = { minHeight: "100vh", background: "#e2e8f0", fontFamily: '"Plus Jakarta Sans", sans-serif' };
const toolbarStyle = { position: "sticky", top: 0, zIndex: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "12px 18px", background: "#0f172a", color: "white", flexWrap: "wrap" };
const hintStyle = { display: "block", marginTop: 3, color: "#cbd5e1", fontSize: 12 };
const controlsStyle = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
const controlStyle = { minHeight: 36, borderRadius: 8, border: "1px solid #475569", padding: "0 12px", background: "#1e293b", color: "white" };
const backStyle = { ...controlStyle, display: "inline-flex", alignItems: "center", textDecoration: "none" };
const stageStyle = { minHeight: "calc(100vh - 66px)", padding: 18, display: "flex", justifyContent: "center" };
const frameStyle = { minHeight: "calc(100vh - 102px)", border: 0, borderRadius: 12, background: "white", boxShadow: "0 18px 60px rgba(15,23,42,.18)" };
