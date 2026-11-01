function validateProductionApiBase(value) {
  const base = String(value || '').trim();
  let url;
  try { url = new URL(base); } catch { throw new Error('Production build requires VITE_API_BASE_URL with a valid HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Production VITE_API_BASE_URL must use HTTPS without credentials, query or fragment');
  }
  return base.replace(/\/$/, '');
}
module.exports = { validateProductionApiBase };
