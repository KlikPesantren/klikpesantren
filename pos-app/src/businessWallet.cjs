const { CredentialReader, normalizeCredential, money } = require('./domain.cjs');
// Reader adapter only. No NFC/RC522 equivalence or physical-camera claim.
class BusinessCredentialReader extends CredentialReader {
  constructor(method, take, { development = false, enabled = false } = {}) {
    super();
    this.method = method;
    this.take = take;
    this.allowed = development && enabled && process.env.NODE_ENV !== 'production';
  }
  async scan() {
    if (!this.allowed) throw Error('READER_UNAVAILABLE');
    if (!['RFID', 'BARCODE', 'QR'].includes(this.method)) throw Error('INVALID_CREDENTIAL_METHOD');
    const raw = await this.take();
    const value = this.method === 'RFID' ? normalizeCredential(raw) : String(raw || '').trim();
    if (this.method !== 'RFID' && !/^kpw_[A-Za-z0-9_-]{43}$/.test(value)) throw Error('UNKNOWN_CREDENTIAL');
    return { credential_method: this.method, credential: value };
  }
}
// Contract adapter accepts the existing transport and encrypted retry journal.
// Caller must reuse checkout request_id after timeout; it must not auto-confirm.
function createBusinessWalletContract(api, businessId) {
  const base = `/pos-business/${businessId}`;
  return {
    async preview(reader, unitId) {
      const scan = await reader.scan();
      const result = await api(`${base}/wallet/preview`, { method: 'POST', body: { ...scan, unit_id: unitId } });
      return { preview: result, scan, unit_id: unitId };
    },
    component(prepared, amount) {
      return { method: 'DOMPET_SANTRI', amount: money(amount).toString(), unit_id: prepared.unit_id, ...prepared.scan };
    },
    checkout(payload) {
      if (!payload.request_id || !payload.payments?.length) throw Error('INVALID_SALE');
      return api(`${base}/sales`, { method: 'POST', body: payload });
    },
    recover(operationId) {
      return api(`${base}/sales/${operationId}`);
    },
  };
}
module.exports = { BusinessCredentialReader, createBusinessWalletContract };
