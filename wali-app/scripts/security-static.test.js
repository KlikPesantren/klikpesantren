const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

function readRgbaPng(relativePath) {
  const png = fs.readFileSync(path.join(root, relativePath));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  assert.ok(header, 'PNG IHDR tidak ditemukan');
  assert.equal(header.bitDepth, 8, 'Notification icon harus PNG 8-bit');
  assert.equal(header.colorType, 6, 'Notification icon harus RGBA dengan alpha channel');
  assert.equal(header.interlace, 0, 'Interlaced PNG belum didukung oleh gate');

  const bytesPerPixel = 4;
  const stride = header.width * bytesPerPixel;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * header.height);
  let sourceOffset = 0;

  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[sourceOffset];
    sourceOffset += 1;
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[sourceOffset + x];
      const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[rowOffset + x - stride] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[rowOffset + x - stride - bytesPerPixel]
        : 0;
      let reconstructed;
      if (filter === 0) reconstructed = value;
      else if (filter === 1) reconstructed = value + left;
      else if (filter === 2) reconstructed = value + up;
      else if (filter === 3) reconstructed = value + Math.floor((left + up) / 2);
      else if (filter === 4) reconstructed = value + paeth(left, up, upperLeft);
      else throw new Error(`PNG filter ${filter} tidak didukung`);
      pixels[rowOffset + x] = reconstructed & 0xff;
    }
    sourceOffset += stride;
  }

  return { ...header, pixels };
}

test('production profile builds an app bundle against HTTPS', () => {
  const eas = JSON.parse(read('eas.json'));
  assert.equal(eas.build.production.android.buildType, 'app-bundle');
  assert.match(eas.build.production.env.EXPO_PUBLIC_API_BASE_URL, /^https:\/\//);
  assert.notEqual(eas.build.production.distribution, 'internal');
});

test('Android production config blocks cleartext and unused sensitive permissions', () => {
  const app = JSON.parse(read('app.json')).expo;
  const buildProperties = app.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
  assert.equal(buildProperties[1].android.usesCleartextTraffic, false);
  assert.ok(app.android.blockedPermissions.includes('android.permission.SYSTEM_ALERT_WINDOW'));
  assert.ok(app.android.blockedPermissions.includes('android.permission.READ_EXTERNAL_STORAGE'));
  assert.ok(app.android.blockedPermissions.includes('android.permission.WRITE_EXTERNAL_STORAGE'));
  assert.ok(app.android.blockedPermissions.includes('android.permission.READ_MEDIA_IMAGES'));
});

test('authentication token uses SecureStore and login payload is not logged', () => {
  const storage = read('src/utils/storage.js');
  const authApi = read('src/api/auth.api.js');
  assert.match(storage, /SecureStore\.setItemAsync\(SECURE_TOKEN_KEY/);
  assert.doesNotMatch(authApi, /console\.(log|warn|error).*payload/i);
});

test('mobile source does not expose test notification controls', () => {
  const files = [
    'src/constants/endpoints.js',
    'src/api/push.api.js',
    'src/screens/profil/ProfilHubScreen.jsx',
  ];
  const source = files.map(read).join('\n');
  assert.doesNotMatch(source, /test-notification|Test Push|Debug Push Notification/i);
});

test('accounts using an initial PIN are forced through PIN change', () => {
  const authContext = read('src/context/AuthContext.jsx');
  const navigator = read('src/navigation/AppNavigator.jsx');
  const backendAuth = read('../middleware/waliAppAuthMiddleware.js');
  assert.match(authContext, /mustChangePin/);
  assert.match(navigator, /RequiredPinChange/);
  assert.match(backendAuth, /PIN_CHANGE_REQUIRED/);
  assert.match(backendAuth, /req\.path === "\/pin"/);
});

test('Wali token version revocation is gated and checked server-side', () => {
  const service = read('../services/waliAppService.js');
  const middleware = read('../middleware/waliAppAuthMiddleware.js');
  const routes = read('../routes/waliAppRoutes.js');
  const migration = read('../migrations/056_wali_token_version.sql');
  assert.match(service, /WALI_TOKEN_VERSION_ENABLED/);
  assert.match(service, /payload\.token_version/);
  assert.match(middleware, /decoded\.token_version/);
  assert.match(routes, /token_version\s*=\s*token_version \+ 1/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0/);
});

test('production notification icon is a 96x96 white transparent PNG', () => {
  const app = JSON.parse(read('app.json')).expo;
  const notificationPlugin = app.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications',
  );
  assert.ok(notificationPlugin, 'Plugin expo-notifications tidak tersedia');
  const relativeIconPath = notificationPlugin[1]?.icon?.replace(/^\.\//, '');
  assert.ok(relativeIconPath, 'Path notification icon belum dikonfigurasi');

  const { width, height, pixels } = readRgbaPng(relativeIconPath);
  let visible = 0;
  let transparent = 0;
  let nonWhiteVisible = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const [red, green, blue, alpha] = pixels.subarray(i, i + 4);
    if (alpha === 0) transparent += 1;
    if (alpha > 0) {
      visible += 1;
      if (red !== 255 || green !== 255 || blue !== 255) nonWhiteVisible += 1;
    }
  }

  const problems = [];
  if (width !== 96 || height !== 96) problems.push(`dimensi ${width}x${height}, wajib 96x96`);
  if (visible === 0) problems.push('ikon tidak memiliki pixel terlihat');
  if (transparent === 0) problems.push('background tidak transparan');
  if (nonWhiteVisible > 0) problems.push(`${nonWhiteVisible} pixel terlihat bukan putih`);
  assert.deepEqual(problems, [], `Notification icon production belum valid: ${problems.join('; ')}`);
});
