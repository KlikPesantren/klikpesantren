import Constants from "expo-constants";
const base = Constants.expoConfig.extra.apiUrl.replace(/\/$/, "");
export function makeApi(token, onConnection = () => {}) {
  return async (path, { method = "GET", body, query } = {}) => {
    // Defense in depth: acceptance never sends even a read/auth request to any API.
    if (Constants.expoConfig.extra.posEnvironment === "acceptance")
      throw Object.assign(Error("REVIEW_NETWORK_DISABLED"), {
        code: "REVIEW_NETWORK_DISABLED",
        status: 403,
      });
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 15000);
    try {
      const qs = query
        ? "?" +
          new URLSearchParams(
            Object.entries(query).filter(([, v]) => v != null),
          ).toString()
        : "";
      const res = await fetch(base + path + qs, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      onConnection(true);
      let json;
      try {
        json = await res.json();
      } catch {
        throw Object.assign(Error("INVALID_RESPONSE"), {
          status: 502,
          code: "UNKNOWN",
        });
      }
      if (!res.ok)
        throw Object.assign(Error("REQUEST_FAILED"), {
          status: res.status,
          code:
            json.code ||
            (res.status === 401
              ? "AUTH_EXPIRED"
              : res.status === 403
                ? "PERMISSION_DENIED"
                : "REJECTED"),
        });
      return path === "/auth/login" ? json : json.data;
    } catch (e) {
      if (!e.status) {
        onConnection(false);
        e.code = "NETWORK";
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
}
