import api from './client';
import { ENDPOINTS } from '../constants/endpoints';

export const raporApi = {
  async list() { return (await api.get(ENDPOINTS.RAPOR)).data; },
  async detail(id) { return (await api.get(ENDPOINTS.RAPOR_DETAIL(id))).data; },
  async pdf(id) { return (await api.get(ENDPOINTS.RAPOR_PDF(id), { responseType: 'arraybuffer' })).data; },
};
