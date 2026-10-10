const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BusinessCredentialReader, createBusinessWalletContract } = require('../src/businessWallet.cjs');
test('RFID and opaque barcode/QR are adapters to one DOMPET_SANTRI contract; dev reader fail-closed', async () => {
  const card = 'kpw_' + 'A'.repeat(43), calls = [];
  const api = async (path, options) => { calls.push({ path, options }); return { name: 'Synthetic', available_balance: '10000' }; };
  const c = createBusinessWalletContract(api, 'synthetic-business');
  for (const method of ['RFID', 'BARCODE', 'QR']) {
    const reader = new BusinessCredentialReader(method, async () => method === 'RFID' ? '0AB102FF' : card, { development: true, enabled: true });
    const p = await c.preview(reader, 2), payment = c.component(p, '2000');
    assert.equal(payment.method, 'DOMPET_SANTRI');assert.equal(payment.credential_method, method);
    assert.equal(payment.credential, method === 'RFID' ? '0ab102ff' : card);
    await c.checkout({ request_id: 'same-retry-id', payments: [payment] });
  }
  assert.ok(calls.every(x => x.path.startsWith('/pos-business/')));
  await assert.rejects(new BusinessCredentialReader('QR', async () => card, { enabled: true }).scan(), /READER_UNAVAILABLE/);
  await assert.rejects(new BusinessCredentialReader('QR', async () => '1', { development: true, enabled: true }).scan(), /UNKNOWN_CREDENTIAL/);
});
