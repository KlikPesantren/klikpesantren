// LOCAL V2 only. No production API/env credential fallback.
export async function storeApi(path, { body, headers = {}, signal, method } = {}) {
  if (!import.meta.env.DEV) throw Error('LOCAL_STORE_ONLY');
  const response = await fetch(`http://127.0.0.1:55440${path}`, {
    method: method || (body ? 'POST' : 'GET'), signal,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw Object.assign(Error(result.code || 'REQUEST_FAILED'), { status: response.status });
  return result.data;
}
export const rupiah = value => `Rp${BigInt(value || 0).toLocaleString('id-ID')}`;
export const orderSecretKey = (slug, id) => `pos-online:${slug}:${id}`;
