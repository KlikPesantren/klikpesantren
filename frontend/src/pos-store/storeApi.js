import { API_BASE_URL } from '../services/api';

export async function storeApi(path, { body, headers = {}, signal, method } = {}) {
  if (!API_BASE_URL) throw Error('API_CONFIGURATION_REQUIRED');
  const response = await fetch(`${API_BASE_URL}${path}`, {
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
