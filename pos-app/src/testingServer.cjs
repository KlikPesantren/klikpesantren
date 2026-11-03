const STORAGE_KEY = "suq-testing-api-url";

function normalizeTestingServerAddress(value) {
  const input = String(value || "").trim();
  let url;
  try { url = new URL(input); }
  catch { throw Object.assign(Error("Alamat server tidak valid."), { code: "INVALID_TEST_SERVER" }); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw Object.assign(Error("Gunakan alamat HTTP/HTTPS tanpa kredensial atau parameter tambahan."), { code: "INVALID_TEST_SERVER" });
  if (url.pathname !== "/" && url.pathname !== "")
    throw Object.assign(Error("Masukkan alamat dasar server, tanpa path tambahan."), { code: "INVALID_TEST_SERVER" });
  return url.origin;
}

async function loadTestingServerAddress(store, fallback) {
  const saved = await store.getItemAsync(STORAGE_KEY);
  if (!saved) return normalizeTestingServerAddress(fallback);
  try { return normalizeTestingServerAddress(saved); }
  catch { return normalizeTestingServerAddress(fallback); }
}

async function saveTestingServerAddress(store, value) {
  const normalized = normalizeTestingServerAddress(value);
  await store.setItemAsync(STORAGE_KEY, normalized);
  return normalized;
}

async function verifyTestingServer(value, fetchImpl, timeoutMs = 8000) {
  const address = normalizeTestingServerAddress(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${address}/health`, { signal: controller.signal });
    if (!response.ok) throw Object.assign(Error(`Server merespons HTTP ${response.status}.`), { code: "TEST_SERVER_HTTP" });
    let body;
    try { body = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      throw Object.assign(Error("Endpoint /health tidak mengembalikan JSON yang valid."), { code: "TEST_SERVER_JSON" });
    }
    if (!body || body.local !== true)
      throw Object.assign(Error("Alamat tersebut bukan backend testing lokal Suq Shogir."), { code: "TEST_SERVER_NOT_LOCAL" });
    return { address, fixture: body.fixture || null };
  } catch (error) {
    if (["INVALID_TEST_SERVER", "TEST_SERVER_HTTP", "TEST_SERVER_NOT_LOCAL", "TEST_SERVER_JSON"].includes(error.code)) throw error;
    if (controller.signal.aborted || error.name === "AbortError")
      throw Object.assign(Error(`Koneksi ke ${address} melewati batas waktu ${timeoutMs / 1000} detik.`), { code: "TEST_SERVER_TIMEOUT" });
    // React Native often reports only 'Network request failed': do not claim a
    // specific transport cause without native logs, or expose raw error payloads.
    throw Object.assign(Error(`Tidak dapat terhubung ke ${address}. Periksa Wi-Fi, port, dan firewall. Untuk HTTP, pastikan APK testing mengizinkan cleartext.`), { code: "TEST_SERVER_UNREACHABLE" });
  } finally { clearTimeout(timer); }
}

module.exports = {
  STORAGE_KEY,
  normalizeTestingServerAddress,
  loadTestingServerAddress,
  saveTestingServerAddress,
  verifyTestingServer,
};
