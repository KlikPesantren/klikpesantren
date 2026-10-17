// Local-only visual acceptance server for SS-040B. It refuses every database
// except the disposable loopback fixture and composes the real POS Admin
// service/router; no production environment or credential is loaded.
const express = require('express');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const HOST = '127.0.0.1';
const DB_PORT = 55439;
const API_PORT = 55441;
const db = new Pool({
  host: HOST,
  port: DB_PORT,
  user: 'pos_test_owner',
  database: 'pos_business_v2_test',
  max: 8,
});

const user = {
  id: 99,
  nama: 'Admin Preview SS-040B',
  username: 'preview-admin',
  role: 'superadmin',
  tenant_id: 1,
  tenant_slug: 'synthetic-merchant',
  tenant_nama: 'Fixture SS-040B (TEST)',
  tenant_features: ['pos'],
  permissions: ['pos.view', 'pos.reconcile'],
};

async function verifyDisposableDatabase() {
  const identity = (await db.query(
    'SELECT current_database() db,current_user,host(inet_server_addr()) host,inet_server_port() port',
  )).rows[0];
  if (
    identity.db !== 'pos_business_v2_test' ||
    identity.current_user !== 'pos_test_owner' ||
    identity.host !== HOST ||
    identity.port !== DB_PORT
  ) throw new Error('DISPOSABLE_LOCAL_DATABASE_REQUIRED');
}

async function seedVisibleObligations() {
  require.cache[require.resolve('../db')] = {
    id: require.resolve('../db'),
    filename: require.resolve('../db'),
    loaded: true,
    exports: db,
  };
  const { createPosBusinessService } = require('../services/posBusinessService');
  const core = createPosBusinessService({ db });
  const token = (await core.login({
    body: { login: 'owner', password: 'Synthetic-only-V2-password' },
  })).token;
  const business = (await db.query(`SELECT m.business_id FROM pos_merchant_memberships m
    JOIN pos_merchant_users u ON u.id=m.user_id WHERE u.login='owner' ORDER BY m.business_id LIMIT 1`)).rows[0];
  const product = (await db.query(`SELECT id,selling_price FROM pos_business_products
    WHERE business_id=$1 AND name='Synthetic Settlement Product' ORDER BY created_at LIMIT 1`, [business.business_id])).rows[0];
  const shift = (await db.query(`SELECT id FROM pos_business_shifts
    WHERE business_id=$1 AND status='OPEN' ORDER BY opened_at LIMIT 1`, [business.business_id])).rows[0];
  if (!business || !product || !shift) throw new Error('RUN_SETTLEMENT_FIXTURE_FIRST');
  const request = (body) => ({
    headers: { authorization: `Bearer ${token}` },
    params: { businessId: business.business_id },
    query: {},
    body,
  });
  const rows = [
    ['Raihana', 'aa000010', 10, 'ss040b-preview-raihana'],
    ['Nilna', 'aa000011', 5, 'ss040b-preview-nilna'],
    ['Ahmad', 'aa000012', 8, 'ss040b-preview-ahmad'],
  ];
  for (const [, credential, quantity, requestId] of rows) {
    await core.sale(request({
      shift_id: shift.id,
      items: [{ product_id: product.id, quantity }],
      payments: [{
        method: 'DOMPET_SANTRI',
        amount: String(BigInt(product.selling_price) * BigInt(quantity)),
        credential_method: 'RFID',
        credential,
        unit_id: 2,
      }],
      request_id: requestId,
    }));
  }
}

async function main() {
  await verifyDisposableDatabase();
  await seedVisibleObligations();
  const { createPosAdminService } = require('../services/posAdminService');
  const { createPosAdminRouter } = require('../routes/posAdminRoutes');
  const admin = createPosAdminService({
    db,
    permissionList: async () => ['pos.view', 'pos.reconcile'],
  });
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.get('/health', (_req, res) => res.json({ local: true, fixture: 'SS-040B' }));
  app.get('/public/tenants/:slug/profile', (req, res) => {
    if (req.params.slug !== user.tenant_slug) return res.sendStatus(404);
    res.json({ data: { name: user.tenant_nama, service_available: true } });
  });
  app.post('/auth/login', (req, res) => {
    if (
      req.body?.tenant_slug !== user.tenant_slug ||
      req.body?.username !== user.username ||
      req.body?.password !== 'preview-only'
    ) return res.status(401).json({ error: 'Kredensial preview tidak sesuai' });
    res.json({ token: 'ss040b-local-preview-token', user });
  });
  app.get('/auth/me', (_req, res) => res.json({ success: true, user }));
  app.get('/units', async (_req, res) => {
    const rows = (await db.query(`SELECT id,kode,nama,unit_type,preset_key,is_active
      FROM unit_pendidikan WHERE tenant_id=1 AND id=2`)).rows;
    res.json({ success: true, data: rows, access: { all_units: true } });
  });
  app.get('/units/:unitId/features', (_req, res) => res.json({
    success: true,
    data: [{ key: 'pos', effective_enabled: true }],
  }));
  app.use('/pos/admin', (req, _res, next) => {
    req.user = user;
    req.tenantId = user.tenant_id;
    next();
  }, createPosAdminRouter({ admin }));
  const server = app.listen(API_PORT, HOST, () => {
    console.log(`SS-040B local API ready: http://${HOST}:${API_PORT}`);
  });
  const stop = () => server.close(() => db.end());
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error('SS-040B preview refused', { code: error.code || error.message });
  db.end();
  process.exitCode = 1;
});
