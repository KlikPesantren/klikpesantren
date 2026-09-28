import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchPublicWebsiteContent } from "../services/platformPublicApi";

const WebsiteContentContext = createContext(null);

export function WebsiteContentProvider({ children, content: contentOverride }) {
  const [publishedContent, setPublishedContent] = useState(contentOverride || null);

  useEffect(() => {
    if (contentOverride) return undefined;
    let cancelled = false;
    fetchPublicWebsiteContent()
      .then((content) => { if (!cancelled) setPublishedContent(content || {}); })
      .catch(() => { if (!cancelled) setPublishedContent({}); });
    return () => { cancelled = true; };
  }, [contentOverride]);

  const value = useMemo(
    () => contentOverride || publishedContent || {},
    [contentOverride, publishedContent]
  );
  return <WebsiteContentContext.Provider value={value}>{children}</WebsiteContentContext.Provider>;
}

export function useWebsiteContent() {
  return useContext(WebsiteContentContext) || {};
}
