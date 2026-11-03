import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
export function makeApi(token, onConnection = () => {}, apiBase = Constants.expoConfig.extra.apiUrl) {
  const base = apiBase.replace(/\/$/, "");
  const guardNetwork = () => {
    // Defense in depth: acceptance never sends even a read/auth request to any API.
    if (Constants.expoConfig.extra.posEnvironment === "acceptance")
      throw Object.assign(Error("REVIEW_NETWORK_DISABLED"), {
        code: "REVIEW_NETWORK_DISABLED",
        status: 403,
      });
  };
  const queryString = query => query
    ? "?" + new URLSearchParams(Object.entries(query).filter(([, value]) => value != null && value !== "")).toString()
    : "";
  const request = async (path, { method = "GET", body, formData, query } = {}) => {
    guardNetwork();
    let requestId=null,httpStatus=null;
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 15000);
    try {
      const qs = queryString(query);
      const res = await fetch(base + path + qs, {
        method,
        headers: {
          ...(!formData ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData || (body ? JSON.stringify(body) : undefined),
        signal: controller.signal,
      });
      requestId=res.headers?.get?.("x-request-id")||null;httpStatus=res.status;
      globalThis.__suqDiagnostics={...globalThis.__suqDiagnostics,lastRequest:{status:res.status,requestId,at:new Date().toISOString()}};
      onConnection(true);
      let json;
      try {
        json = await res.json();
      } catch (error) {
        if (controller.signal.aborted || error.name === "AbortError") throw error;
        throw Object.assign(Error("INVALID_RESPONSE"), {
          status: res.ok ? 502 : res.status,
          code: res.status >= 500 ? "SERVER_ERROR" : "INVALID_RESPONSE",
        });
      }
      if (!res.ok)
        throw Object.assign(Error("REQUEST_FAILED"), {
          status: res.status,
          code:
            json.code ||
            (res.status >= 500 ? "SERVER_ERROR" : res.status === 401
              ? "AUTH_EXPIRED"
              : res.status === 403
                ? "PERMISSION_DENIED"
                : "REJECTED"),
        });
      return path === "/auth/login" ? json : json.data;
    } catch (e) {
      if (!e.status) {
        onConnection(false);
        e.code = controller.signal.aborted || e.name === "AbortError" ? "NETWORK_TIMEOUT" : "NETWORK";
      }
      const code=/^[A-Z0-9_]{1,80}$/.test(String(e.code))?e.code:"UNKNOWN";
      globalThis.__suqDiagnostics={...globalThis.__suqDiagnostics,lastError:{code,status:httpStatus,requestId,at:new Date().toISOString()}};
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
  request.download = async (path, destination, { query, onProgress } = {}) => {
    guardNetwork();
    const download = FileSystem.createDownloadResumable(
      base + path + queryString(query),
      destination,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      progress => onProgress?.(progress.totalBytesExpectedToWrite > 0
        ? progress.totalBytesWritten / progress.totalBytesExpectedToWrite
        : 0),
    );
    try {
      const result = await download.downloadAsync();
      if (!result || result.status < 200 || result.status >= 300) {
        if (result?.uri) await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
        throw Object.assign(Error("REQUEST_FAILED"), { status: result?.status || 502, code: "REJECTED" });
      }
      onConnection(true);
      return result;
    } catch (error) {
      if (!error.status) { onConnection(false); error.code = "NETWORK"; }
      throw error;
    }
  };
  return request;
}
