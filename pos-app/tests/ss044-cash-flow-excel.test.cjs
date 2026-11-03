const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../src/FinancialWorkspace.jsx'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '../../routes/posBusinessRoutes.js'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '../../services/posBusinessFinance.js'), 'utf8');
const workbook = fs.readFileSync(path.join(__dirname, '../../services/posCashBookWorkbookService.js'), 'utf8');

test('Owner cash flow presents canonical balances and distinguishes non-cash values', () => {
  for (const label of ['Saldo awal periode', 'Uang masuk eksternal', 'Uang keluar eksternal', 'Saldo akhir periode']) assert.ok(app.includes(label));
  assert.match(service, /opening_balance/); assert.match(service, /WALLET_SETTLEMENT/);
  assert.match(service, /kind<>'TRANSFER'/);
});

test('cash-book Excel export reuses authenticated projection and supports all selected filters', () => {
  assert.match(routes, /cash-book\/export\.xlsx/);
  assert.match(workbook, /req\._cashBookExport = true/); assert.match(workbook, /delete req\._cashBookExport/);
  for (const key of ['account_id', 'kind', 'actor_id', 'shift_id']) assert.ok(service.includes(key));
  assert.match(service, /!req\._cashBookExport/); assert.doesNotMatch(app, /Export Excel/);
  assert.match(workbook, /MAX_EXPORT_ROWS = 25000/);
});

test('workbook has three required sheets, numeric money and formula-injection protection', () => {
  for (const sheet of ['Ringkasan', 'Mutasi', 'Audit Shift']) assert.ok(workbook.includes(`'${sheet}'`));
  assert.match(workbook, /FORMULA_PREFIX/); assert.match(workbook, /moneyNumber/);
  assert.doesNotMatch(workbook, /pos_money_movements|INSERT INTO|UPDATE |DELETE FROM/i);
});

test('financial import remains absent because no reviewed atomic bulk-post contract exists', () => {
  assert.doesNotMatch(routes, /cash-book\/import|money\/import/);
  assert.doesNotMatch(app, /Import Excel[^\n]*Buku Kas|Import Keuangan/);
});
