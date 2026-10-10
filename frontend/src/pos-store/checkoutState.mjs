// A session-only retry journal. No credentials in URLs, logs, or source.
export function loadDraft(storage, slug) {
  try {
    const value = JSON.parse(storage.getItem(`pos-checkout:${slug}`) || 'null');
    if (!value || !/^[a-f0-9]{64}$/.test(value.order_access) || !/^[a-f0-9-]{36}$/.test(value.request_id) || !Array.isArray(value.items) || !value.items.length) return null;
    return value;
  } catch { return null; }
}
export function prepareDraft(storage, slug, fields, cryptoApi) {
  const old = loadDraft(storage, slug);
  if (old) return old; // Unknown network outcome must retain original input/idempotency.
  const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
  const draft = { ...fields, request_id: cryptoApi.randomUUID(), order_access: [...bytes].map(b => b.toString(16).padStart(2, '0')).join('') };
  storage.setItem(`pos-checkout:${slug}`, JSON.stringify(draft));
  return draft;
}
export function clearDraft(storage, slug) { storage.removeItem(`pos-checkout:${slug}`); }
