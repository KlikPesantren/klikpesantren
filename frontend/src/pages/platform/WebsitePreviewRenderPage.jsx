import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { WebsiteContentProvider } from "../../context/WebsiteContentContext";
import platformApi from "../../services/platformApi";
import LandingPage from "../LandingPage";
import FoundingPartnerPage from "../FoundingPartnerPage";

export default function WebsitePreviewRenderPage() {
  const [params] = useSearchParams();
  const [content, setContent] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    platformApi.get("/platform/website/content")
      .then((response) => setContent(response.data?.data?.content || {}))
      .catch((requestError) => setError(requestError.response?.data?.error || "Gagal memuat draft website"));
  }, []);

  if (error) return <div style={{ padding: 24 }}>{error}</div>;
  if (!content) return <div style={{ padding: 24 }}>Memuat preview draft…</div>;

  const view = params.get("view") || "home";
  return (
    <WebsiteContentProvider content={content}>
      {view === "founding" ? <FoundingPartnerPage preview /> : <LandingPage />}
    </WebsiteContentProvider>
  );
}
