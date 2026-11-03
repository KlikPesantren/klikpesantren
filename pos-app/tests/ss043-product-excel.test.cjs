const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../src/MerchantBusinessApp.jsx'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '../src/api.js'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '../../routes/posBusinessRoutes.js'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '../../services/posProductWorkbookService.js'), 'utf8');
const pkg = require('../package.json');

test('Android workbook flow uses SDK 57 compatible picker, cache copy, filesystem and sharing', () => {
  assert.match(pkg.dependencies['expo-document-picker'], /^~57\.0\./);
  assert.match(pkg.dependencies['expo-file-system'], /^~57\.0\./);
  assert.match(pkg.dependencies['expo-sharing'], /^~57\.0\./);
  assert.match(app, /DocumentPicker\.getDocumentAsync/);
  assert.match(app, /copyToCacheDirectory:true/);
  assert.match(api, /createDownloadResumable/);
  assert.match(app, /Sharing\.shareAsync/);
});

test('Produk exposes add, import, export, preview and one atomic commit request', () => {
  for (const label of ['Tambah Produk', 'Import Excel', 'Export Excel', 'Unduh Template', 'Hasil validasi server', 'Konfirmasi Import']) assert.ok(app.includes(label));
  assert.match(app, /products\/import\/\$\{commit \? "commit" : "preview"\}/);
  assert.doesNotMatch(app, /preview\.rows\.map\([^)]*submit\(/);
  assert.match(routes, /products\/import\/commit/);
  assert.match(service, /BEGIN|createPosProductWorkbookService/);
  assert.match(service, /PRODUCT_IMPORT_VALIDATION_FAILED/);
});

test('master-only contract never writes inventory, FIFO, Wallet, cash or debt tables', () => {
  const commit = service.slice(service.indexOf('async function productWorkbookCommit'), service.indexOf('async function productWorkbookExport'));
  assert.match(commit, /pos_business_products/);
  for (const forbidden of ['pos_inventory_movements', 'pos_inventory_layers', 'pos_money_movements', 'pos_debt_movements', 'wallet']) assert.doesNotMatch(commit, new RegExp(forbidden, 'i'));
});
