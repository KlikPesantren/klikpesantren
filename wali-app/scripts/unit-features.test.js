const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.resolve(__dirname, '..');
const {
  WALI_CAPABILITY_KEYS,
  buildWaliCapabilities,
} = require(path.join(repoRoot, 'services', 'waliCapabilitiesService'));

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('capabilities fail closed and use effective entitlement plus unit activation', () => {
  const capabilities = buildWaliCapabilities([
    { key: 'pelanggaran', enabled: true, effective_enabled: false },
    { key: 'absensi', enabled: true, effective_enabled: true },
  ], { unit_id: 7 });

  assert.equal(capabilities.pelanggaran, false);
  assert.equal(capabilities.absensi, true);
  assert.equal(capabilities.nilai, false);
  assert.equal(capabilities.unit_id, 7);
});

test('wallet and RFID remain independent capabilities', () => {
  const capabilities = buildWaliCapabilities([
    { key: 'wallet', effective_enabled: true },
    { key: 'rfid', effective_enabled: false },
  ], { unit_id: 8 });

  assert.equal(capabilities.wallet, true);
  assert.equal(capabilities.rfid, false);
});

test('random feature combinations require no unit-name branching', () => {
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const expected = new Map();
    const rows = WALI_CAPABILITY_KEYS.map((key) => {
      const effective = Math.random() >= 0.5;
      expected.set(key, effective);
      return { key, enabled: true, effective_enabled: effective };
    });
    const capabilities = buildWaliCapabilities(rows, { unit_id: iteration + 1 });
    for (const key of WALI_CAPABILITY_KEYS) {
      assert.equal(capabilities[key], expected.get(key));
    }
  }
});

test('backend features and module data are guarded by selected child unit', () => {
  const routes = read('routes/waliAppRoutes.js');
  assert.match(routes, /"\/features", \.\.\.withWaliAuth, waliSantriGuard, requireWaliUnit/);
  assert.match(routes, /"\/rfid\/saldo"[\s\S]*?requireWaliUnitFeature\("wallet"\)/);
  assert.match(routes, /"\/rfid\/mutasi"[\s\S]*?requireWaliUnitFeature\("wallet"\)/);
  for (const table of ['absensi', 'hafalan', 'nilai_mingguan', 'kesehatan_santri']) {
    const tableQueries = routes.match(new RegExp(`FROM ${table}[\\s\\S]{0,500}`, 'g')) ?? [];
    assert.ok(tableQueries.length > 0, `missing ${table} query`);
    for (const query of tableQueries) {
      assert.match(query, /tenant_id/);
      assert.match(query, /unit_id/);
    }
  }
});

test('Wali wallet reads the canonical ledger schema and preserves unit scope', () => {
  const routes = read('routes/waliAppRoutes.js');
  const mutasiRoute = routes.match(/"\/rfid\/mutasi"[\s\S]*?\/\/ ======================/)?.[0] || '';

  assert.match(mutasiRoute, /FROM wallet_transactions wt/);
  assert.match(mutasiRoute, /JOIN wallet_accounts wa/);
  assert.match(mutasiRoute, /wa\.status = 'active'/);
  assert.match(mutasiRoute, /wa\.santri_id = \$1/);
  assert.match(mutasiRoute, /wt\.tenant_id = \$2/);
  assert.match(mutasiRoute, /wt\.unit_id = \$3/);
  assert.match(mutasiRoute, /wt\.balance_after AS saldo_akhir/);
  assert.match(mutasiRoute, /LEFT JOIN merchant_rfid m/);
  assert.doesNotMatch(mutasiRoute, /wt\.balance_before/);
  assert.doesNotMatch(mutasiRoute, /wt\.description/);
});

test('mobile navigation is capability-driven and fail closed', () => {
  const tabs = fs.readFileSync(path.join(appRoot, 'src', 'navigation', 'MainTabs.jsx'), 'utf8');
  const quick = fs.readFileSync(path.join(appRoot, 'src', 'components', 'home', 'QuickAccessGrid.jsx'), 'utf8');
  const monitoring = fs.readFileSync(path.join(appRoot, 'src', 'navigation', 'MonitoringStack.jsx'), 'utf8');
  const finance = fs.readFileSync(path.join(appRoot, 'src', 'navigation', 'KeuanganStack.jsx'), 'utf8');

  assert.match(tabs, /features\.pengumuman === true/);
  assert.match(tabs, /hasAnyFeature\(features, MONITORING_FEATURE_KEYS\)/);
  assert.match(tabs, /hasAnyFeature\(features, FINANCE_FEATURE_KEYS\)/);
  assert.match(tabs, /<Tab\.Screen\s+name="Beranda"\s+component=\{DashboardScreen\}/);
  assert.match(tabs, /features\.pengumuman === true \? <Tab\.Screen\s+name="Pengumuman"\s+component=\{PengumumanStack\}/);
  assert.match(tabs, /showMonitoring \? <Tab\.Screen\s+name="Monitoring"\s+component=\{MonitoringStack\}/);
  assert.match(tabs, /showKeuangan \? <Tab\.Screen\s+name="Keuangan"\s+component=\{KeuanganStack\}/);
  assert.doesNotMatch(tabs, /features\.pengumuman === true \? <Tab\.Screen\s+name="Beranda"/);
  assert.doesNotMatch(tabs, /showMonitoring \? <Tab\.Screen\s+name="Pengumuman"/);
  assert.doesNotMatch(tabs, /showKeuangan \? <Tab\.Screen\s+name="Monitoring"/);
  assert.doesNotMatch(quick, /!== false/);
  assert.match(quick, /featureKey: 'wallet'/);
  assert.match(monitoring, /features\.absensi === true/);
  assert.match(monitoring, /features\.nilai === true/);
  assert.match(finance, /features\.wallet === true/);
  assert.match(finance, /features\.sahriyah === true/);
});

test('selected unit participates in stale-response guards and notification routing', () => {
  const hookNames = [
    'useDashboard.js', 'usePengumuman.js', 'useAbsensi.js', 'useNilai.js',
    'useHafalan.js', 'usePerizinan.js', 'usePelanggaran.js', 'useKesehatan.js',
    'useSahriyah.js', 'useRFID.js', 'useProfil.js',
  ];
  for (const hookName of hookNames) {
    const source = fs.readFileSync(path.join(appRoot, 'src', 'hooks', hookName), 'utf8');
    assert.match(source, /activeUnitId/, `${hookName} must depend on active unit`);
  }

  const notifications = fs.readFileSync(
    path.join(appRoot, 'src', 'screens', 'notifications', 'NotificationsScreen.jsx'),
    'utf8',
  );
  assert.match(notifications, /Number\(capabilities\.unit_id\) !== Number\(child\.unit_id\)/);
  assert.match(notifications, /capabilities\[meta\.featureKey\] !== true/);
});

test('feature-off middleware returns deterministic 403', async () => {
  process.env.DB_USER ||= 'test';
  process.env.DB_HOST ||= 'localhost';
  process.env.DB_NAME ||= 'test';
  process.env.DB_PASSWORD ||= 'test';

  const dbPath = path.join(repoRoot, 'db', 'index.js');
  const unitServicePath = path.join(repoRoot, 'services', 'unitFeatureService.js');
  const guardPath = path.join(repoRoot, 'middleware', 'waliUnitFeatureGuard.js');
  const db = require(dbPath);
  const unitService = require(unitServicePath);
  const originalQuery = db.query;
  const originalFeatureCheck = unitService.isUnitFeatureEnabled;

  db.query = async () => ({
    rows: [{ unit_id: 2, unit_kode: 'U2', unit_nama: 'Unit 2', unit_type: 'CUSTOM' }],
  });
  unitService.isUnitFeatureEnabled = async () => false;
  delete require.cache[require.resolve(guardPath)];
  const { requireWaliUnitFeature } = require(guardPath);

  let statusCode = null;
  let payload = null;
  let nextCalled = false;
  const req = {
    tenantId: 1,
    santriId: 10,
    headers: { 'x-unit-id': '2' },
  };
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };

  try {
    await requireWaliUnitFeature('pelanggaran')(req, res, () => { nextCalled = true; });
    assert.equal(statusCode, 403);
    assert.equal(payload.code, 'UNIT_FEATURE_DISABLED');
    assert.equal(nextCalled, false);
  } finally {
    db.query = originalQuery;
    unitService.isUnitFeatureEnabled = originalFeatureCheck;
    delete require.cache[require.resolve(guardPath)];
  }
});

test('cross-unit membership spoof fails closed', async () => {
  process.env.DB_USER ||= 'test';
  process.env.DB_HOST ||= 'localhost';
  process.env.DB_NAME ||= 'test';
  process.env.DB_PASSWORD ||= 'test';
  const { resolveWaliUnit } = require(path.join(repoRoot, 'middleware', 'waliUnitFeatureGuard.js'));
  const req = {
    tenantId: 1,
    santriId: 10,
    headers: { 'x-unit-id': '999' },
  };
  const client = { query: async () => ({ rows: [] }) };

  await assert.rejects(
    resolveWaliUnit(req, client),
    (error) => error.status === 403 && error.code === 'UNIT_ACCESS_DENIED',
  );
});

test('cross-family child selection returns 403', async () => {
  process.env.DB_USER ||= 'test';
  process.env.DB_HOST ||= 'localhost';
  process.env.DB_NAME ||= 'test';
  process.env.DB_PASSWORD ||= 'test';
  process.env.JWT_SECRET ||= 'test-admin-jwt-secret-for-wali-guard';
  process.env.WALI_JWT_SECRET ||= 'test-wali-jwt-secret-for-wali-guard';
  const waliServicePath = path.join(repoRoot, 'services', 'waliAppService.js');
  const guardPath = path.join(repoRoot, 'middleware', 'waliSantriGuard.js');
  const waliService = require(waliServicePath);
  const originalOwnsSantri = waliService.ownsSantri;
  waliService.ownsSantri = async () => false;
  delete require.cache[require.resolve(guardPath)];
  const waliSantriGuard = require(guardPath);

  let statusCode = null;
  let payload = null;
  const req = {
    tenantId: 1,
    wali: { nomor_hp: '0800000000', santri_ids: [10] },
    headers: { 'x-santri-id': '999' },
  };
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };

  try {
    await waliSantriGuard(req, res, () => assert.fail('cross-family request reached next()'));
    assert.equal(statusCode, 403);
    assert.equal(payload.error, 'Bukan anak Anda');
  } finally {
    waliService.ownsSantri = originalOwnsSantri;
    delete require.cache[require.resolve(guardPath)];
  }
});

test('universal app is WaliSantri and keeps canonical KlikPesantren API', () => {
  const appConfig = JSON.parse(fs.readFileSync(path.join(appRoot, 'app.json'), 'utf8'));
  const easConfig = fs.readFileSync(path.join(appRoot, 'eas.json'), 'utf8');
  assert.equal(appConfig.expo.name, 'WaliSantri');
  assert.equal(appConfig.expo.android.versionCode, 12);
  assert.equal(
    appConfig.expo.android.adaptiveIcon.foregroundImage,
    './assets/universal-walisantri-foreground-1024.png',
  );
  assert.equal(appConfig.expo.android.adaptiveIcon.backgroundImage, undefined);
  assert.equal(
    appConfig.expo.plugins[0][1].image,
    './assets/universal-walisantri-splash-1024.png',
  );
  assert.match(easConfig, /https:\/\/api\.klikpesantren\.com/);
});
