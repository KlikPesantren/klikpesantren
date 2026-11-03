const productPermissions = require('./posBusinessPermissions');
const XLSX = require('xlsx');

const HEADERS = [
  'SKU', 'Barcode', 'Nama Produk', 'Kategori', 'Satuan',
  'Harga Jual', 'Harga Beli Referensi', 'Status Aktif',
];
const MAX_ROWS = 1000;
const MAX_SAFE_RUPIAH = BigInt(Number.MAX_SAFE_INTEGER);
const DANGEROUS_FORMULA_PREFIX = /^[=+\-@]/;

function fail(bad, code, status = 400, details) {
  try { bad(code, status); } catch (error) {
    if (details) error.details = details;
    throw error;
  }
}

function safeSpreadsheetText(value) {
  const text = String(value ?? '');
  return DANGEROUS_FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function importedText(cell, { required = false, max = 160, identifier = false } = {}) {
  if (!cell || cell.v == null || String(cell.v).trim() === '') {
    if (required) throw Error('REQUIRED');
    return null;
  }
  if (cell.f) throw Error('FORMULA_NOT_ALLOWED');
  if (identifier && cell.t !== 's') throw Error('IDENTIFIER_MUST_BE_TEXT');
  let value = String(cell.v).trim();
  if (value.startsWith("'") && DANGEROUS_FORMULA_PREFIX.test(value.slice(1))) value = value.slice(1);
  if (!value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw Error('INVALID_TEXT');
  return value;
}

function importedRupiah(cell, { required = false, positive = false } = {}) {
  if (!cell || cell.v == null || String(cell.v).trim() === '') {
    if (required) throw Error('REQUIRED');
    return null;
  }
  if (cell.f) throw Error('FORMULA_NOT_ALLOWED');
  let raw;
  if (cell.t === 'n') {
    if (!Number.isSafeInteger(cell.v)) throw Error('INVALID_RUPIAH');
    raw = String(cell.v);
  } else {
    raw = String(cell.v).trim().replace(/^Rp\s*/i, '').replace(/[.\s]/g, '');
  }
  if (!/^(0|[1-9]\d*)$/.test(raw)) throw Error('INVALID_RUPIAH');
  const value = BigInt(raw);
  if (value > MAX_SAFE_RUPIAH || (positive && value === 0n)) throw Error('INVALID_RUPIAH');
  return value.toString();
}

function importedStatus(cell) {
  if (!cell || cell.v == null || String(cell.v).trim() === '') return true;
  if (cell.f) throw Error('FORMULA_NOT_ALLOWED');
  if (typeof cell.v === 'boolean') return cell.v;
  const value = String(cell.v).trim().toUpperCase();
  if (['AKTIF', 'YA', 'YES', 'TRUE', '1'].includes(value)) return true;
  if (['NONAKTIF', 'TIDAK', 'NO', 'FALSE', '0'].includes(value)) return false;
  throw Error('INVALID_STATUS');
}

function readRows(buffer) {
  let workbook;
  try { workbook = XLSX.read(buffer, { type: 'buffer', raw: true, cellDates: false }); }
  catch { throw Object.assign(Error('INVALID_PRODUCT_WORKBOOK'), { code: 'INVALID_PRODUCT_WORKBOOK', status: 400 }); }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet?.['!ref']) throw Object.assign(Error('EMPTY_PRODUCT_WORKBOOK'), { code: 'EMPTY_PRODUCT_WORKBOOK', status: 400 });
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const actualHeaders = HEADERS.map((_, column) => String(sheet[XLSX.utils.encode_cell({ r: 0, c: column })]?.v ?? '').trim());
  if (actualHeaders.some((value, index) => value !== HEADERS[index])) {
    throw Object.assign(Error('INVALID_PRODUCT_WORKBOOK_HEADERS'), { code: 'INVALID_PRODUCT_WORKBOOK_HEADERS', status: 400 });
  }
  if (range.e.r > MAX_ROWS) throw Object.assign(Error('PRODUCT_WORKBOOK_TOO_MANY_ROWS'), { code: 'PRODUCT_WORKBOOK_TOO_MANY_ROWS', status: 413 });
  const rows = [];
  for (let rowIndex = 1; rowIndex <= range.e.r; rowIndex++) {
    const cells = HEADERS.map((_, column) => sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })]);
    if (cells.every(cell => cell?.v == null || String(cell.v).trim() === '')) continue;
    const row = { row: rowIndex + 1, errors: [] };
    const read = (key, work) => { try { row[key] = work(); } catch (error) { row.errors.push(`${key}:${error.message}`); } };
    read('sku', () => importedText(cells[0], { required: true, max: 80, identifier: true }));
    read('barcode', () => importedText(cells[1], { max: 120, identifier: true }));
    read('name', () => importedText(cells[2], { required: true, max: 160 }));
    read('category', () => importedText(cells[3], { max: 120 }));
    read('uom', () => importedText(cells[4], { required: true, max: 32 }));
    read('selling_price', () => importedRupiah(cells[5], { required: true, positive: true }));
    read('reference_purchase_price', () => importedRupiah(cells[6]));
    read('active', () => importedStatus(cells[7]));
    rows.push(row);
  }
  if (!rows.length) throw Object.assign(Error('EMPTY_PRODUCT_WORKBOOK'), { code: 'EMPTY_PRODUCT_WORKBOOK', status: 400 });
  return rows;
}

function comparable(row) {
  return {
    sku: row.sku, barcode: row.barcode || null, name: row.name, category: row.category || null,
    uom: row.uom, selling_price: String(row.selling_price),
    reference_purchase_price: row.reference_purchase_price == null ? null : String(row.reference_purchase_price),
    active: row.active,
  };
}

function analyzeRows(rows, existing) {
  const bySku = new Map(existing.map(row => [row.sku, row]));
  const byBarcode = new Map(existing.filter(row => row.barcode).map(row => [row.barcode, row]));
  const skuCounts = new Map(), barcodeCounts = new Map();
  for (const row of rows) {
    if (row.sku) skuCounts.set(row.sku, (skuCounts.get(row.sku) || 0) + 1);
    if (row.barcode) barcodeCounts.set(row.barcode, (barcodeCounts.get(row.barcode) || 0) + 1);
  }
  const claimedTargets = new Set();
  const analyzed = rows.map(row => {
    const errors = [...row.errors];
    if (row.sku && skuCounts.get(row.sku) > 1) errors.push('sku:DUPLICATE_IN_FILE');
    if (row.barcode && barcodeCounts.get(row.barcode) > 1) errors.push('barcode:DUPLICATE_IN_FILE');
    const skuMatch = row.sku ? bySku.get(row.sku) : null;
    const barcodeMatch = row.barcode ? byBarcode.get(row.barcode) : null;
    if (skuMatch && barcodeMatch && skuMatch.id !== barcodeMatch.id) errors.push('identity:SKU_BARCODE_CONFLICT');
    const target = skuMatch || barcodeMatch || null;
    if (target && claimedTargets.has(target.id)) errors.push('identity:DUPLICATE_TARGET_IN_FILE');
    if (target) claimedTargets.add(target.id);
    let status = errors.length ? (errors.some(error => error.includes('DUPLICATE_')) ? 'DUPLICATE' : 'INVALID') : target ? 'UPDATE' : 'CREATE';
    if (!errors.length && target && JSON.stringify(comparable(row)) === JSON.stringify(comparable(target))) status = 'UNCHANGED';
    const identity_changes=target?['sku','barcode'].filter(key=>(target[key]||null)!==(row[key]||null)).map(key=>({field:key,before:target[key]||null,after:row[key]||null})):[];
    return { ...row, status, product_id: target?.id || null, identity_changes };
  });
  const count = status => analyzed.filter(row => row.status === status).length;
  return {
    rows: analyzed,
    summary: { total: analyzed.length, create: count('CREATE'), update: count('UPDATE'), unchanged: count('UNCHANGED'), duplicate: count('DUPLICATE'), invalid: count('INVALID') },
    can_commit: count('INVALID') === 0 && count('DUPLICATE') === 0,
  };
}

function sheetFromRows(rows) {
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  sheet['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 34 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 14 }];
  sheet['!autofilter'] = { ref: `A1:H${Math.max(1, rows.length + 1)}` };
  for (let row = 1; row <= rows.length + 1; row++) {
    for (const column of [0, 1]) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (sheet[address]) { sheet[address].t = 's'; sheet[address].z = '@'; }
    }
    for (const column of [5, 6]) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (sheet[address]?.t === 'n') sheet[address].z = '#,##0';
    }
  }
  return sheet;
}

function workbookBuffer(rows = [], instructions = false) {
  const workbook = XLSX.utils.book_new();
  const products = sheetFromRows(rows);
  if (instructions && !rows.length) {
    products.A2 = { t: 's', v: '', z: '@' }; products.B2 = { t: 's', v: '', z: '@' }; products['!ref'] = 'A1:H2';
  }
  XLSX.utils.book_append_sheet(workbook, products, 'Produk');
  if (instructions) {
    const help = XLSX.utils.aoa_to_sheet([
      ['Petunjuk Import Produk Suq Shogir'],
      ['SKU dan Barcode wajib diformat sebagai Text agar nol di depan tidak hilang.'],
      ['Harga menggunakan bilangan Rupiah bulat tanpa desimal.'],
      ['Status Aktif menerima AKTIF atau NONAKTIF.'],
      ['Import hanya mengubah master produk; stok dan nilai FIFO tidak disentuh.'],
      [`Maksimal ${MAX_ROWS} baris data per file.`],
    ]);
    help['!cols'] = [{ wch: 95 }];
    XLSX.utils.book_append_sheet(workbook, help, 'Petunjuk');
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

function rupiahCell(value) {
  const amount = BigInt(value || 0);
  if (amount > MAX_SAFE_RUPIAH || amount < -MAX_SAFE_RUPIAH) return amount.toString();
  return Number(amount);
}

function exportWorkbookBuffer(products) {
  const headers = [...HEADERS, 'Stok Tersedia'];
  const rows = products.map(row => [
    safeSpreadsheetText(row.sku), safeSpreadsheetText(row.barcode || ''), safeSpreadsheetText(row.name),
    safeSpreadsheetText(row.category || ''), safeSpreadsheetText(row.uom), rupiahCell(row.selling_price),
    row.reference_purchase_price == null ? '' : rupiahCell(row.reference_purchase_price), row.active ? 'AKTIF' : 'NONAKTIF',
    rupiahCell(row.available || 0),
  ]);
  const workbook = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 34 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 14 }, { wch: 16 }];
  sheet['!autofilter'] = { ref: `A1:I${Math.max(1, rows.length + 1)}` };
  for (let row = 1; row <= rows.length; row++) {
    for (const column of [0, 1]) { const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]; if (cell) { cell.t = 's'; cell.z = '@'; } }
    for (const column of [5, 6]) { const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })]; if (cell?.t === 'n') cell.z = '#,##0'; }
  }
  XLSX.utils.book_append_sheet(workbook, sheet, 'Produk');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

function filenamePart(value) {
  return String(value || 'merchant').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'merchant';
}

function createPosProductWorkbookService({ run, bad, makeId }) {
  const existingProducts = (c, business, lock = false) => c.query(`SELECT id,sku,barcode,name,category,uom,selling_price,reference_purchase_price,active
    FROM pos_business_products WHERE business_id=$1 ORDER BY id${lock ? ' FOR UPDATE' : ''}`, [business]).then(result => result.rows);
  async function productWorkbookTemplate(req) {
    return run(req, 'products.manage', async () => ({ filename: 'template-import-produk-suq-shogir.xlsx', buffer: workbookBuffer([], true) }));
  }
  async function productWorkbookPreview(req) {
    return run(req, 'products.manage', async (c, a) => {
      if(!productPermissions.has(a.member,'PRODUCT_PRICE_MANAGE') || !productPermissions.has(a.member,'PRODUCT_COST_VIEW'))fail(bad,'MERCHANT_PERMISSION_DENIED',403);
      if (!req.file?.buffer) fail(bad, 'PRODUCT_WORKBOOK_REQUIRED', 400);
      return analyzeRows(readRows(req.file.buffer), await existingProducts(c, a.business));
    });
  }
  async function productWorkbookCommit(req) {
    return run(req, 'products.manage', async (c, a) => {
      if(!productPermissions.has(a.member,'PRODUCT_PRICE_MANAGE') || !productPermissions.has(a.member,'PRODUCT_COST_VIEW'))fail(bad,'MERCHANT_PERMISSION_DENIED',403);
      if (!req.file?.buffer) fail(bad, 'PRODUCT_WORKBOOK_REQUIRED', 400);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`pos-product-import:${a.business}`]);
      const analysis = analyzeRows(readRows(req.file.buffer), await existingProducts(c, a.business, true));
      if (!analysis.can_commit) fail(bad, 'PRODUCT_IMPORT_VALIDATION_FAILED', 422, analysis);
      for (const row of analysis.rows) {
        if (row.status === 'CREATE') {
          await c.query(`INSERT INTO pos_business_products(id,business_id,sku,barcode,name,category,uom,selling_price,reference_purchase_price,minimum_stock,active,sellable,online_visible)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,true,false)`,
          [makeId(), a.business, row.sku, row.barcode, row.name, row.category, row.uom, row.selling_price, row.reference_purchase_price, row.active]);
        } else if (row.status === 'UPDATE') {
          await c.query(`UPDATE pos_business_products SET sku=$1,barcode=$2,name=$3,category=$4,uom=$5,selling_price=$6,reference_purchase_price=$7,active=$8
            WHERE id=$9 AND business_id=$10`, [row.sku, row.barcode, row.name, row.category, row.uom, row.selling_price,
            row.reference_purchase_price, row.active, row.product_id, a.business]);
        }
      }
      return { ...analysis, committed: true };
    });
  }
  async function productWorkbookExport(req) {
    return run(req, 'products.read', async (c, a) => {
      const category = req.query?.category ? String(req.query.category).trim() : null;
      const status = String(req.query?.status || 'ALL').toUpperCase();
      if (!['ALL', 'ACTIVE', 'INACTIVE'].includes(status)) fail(bad, 'INVALID_PRODUCT_EXPORT_FILTER', 400);
      if (category && category.length > 120) fail(bad, 'INVALID_PRODUCT_EXPORT_FILTER', 400);
      const hasReservations = (await c.query("SELECT to_regclass('public.pos_online_reservations') present")).rows[0].present;
      const search=String(req.query?.q||'').trim(),stock=String(req.query?.stock||'');
      if(search.length>160||!['','AVAILABLE','LOW','OUT'].includes(stock))fail(bad,'INVALID_PRODUCT_EXPORT_FILTER',400);
      const values = [a.business], filters = [];
      if(search){values.push(search);filters.push(`strpos(lower(concat_ws(' ',p.name,p.sku,p.barcode)),lower($${values.length}))>0`);}
      const available="(coalesce(s.on_hand,0)-"+(hasReservations?'coalesce(r.reserved,0)':'0')+")";
      if(stock==='AVAILABLE')filters.push(available+'>0');
      if(stock==='OUT')filters.push(available+'<=0');
      if(stock==='LOW')filters.push(available+'>0 AND '+available+'<=p.minimum_stock');
      if (category) { values.push(category); filters.push(`p.category=$${values.length}`); }
      if (status !== 'ALL') { values.push(status === 'ACTIVE'); filters.push(`p.active=$${values.length}`); }
      const reservations = hasReservations ? `LEFT JOIN (SELECT product_id,sum(quantity) reserved FROM pos_online_reservations
        WHERE business_id=$1 AND state='RESERVED' GROUP BY product_id) r ON r.product_id=p.id` : '';
      const products = (await c.query(`SELECT p.sku,p.barcode,p.name,p.category,p.uom,p.selling_price,${productPermissions.has(a.member,'PRODUCT_COST_VIEW') ? 'p.reference_purchase_price,' : ''}p.active,
        (coalesce(s.on_hand,0)-${hasReservations ? 'coalesce(r.reserved,0)' : '0'})::text available
        FROM pos_business_products p
        LEFT JOIN (SELECT product_id,sum(quantity) on_hand FROM pos_inventory_movements WHERE business_id=$1 GROUP BY product_id) s ON s.product_id=p.id
        ${reservations} WHERE p.business_id=$1 ${filters.length ? `AND ${filters.join(' AND ')}` : ''} ORDER BY p.name,p.id`, values)).rows;
      const date = new Date().toISOString().slice(0, 10);
      return { filename: `produk-${filenamePart(a.member.display_name)}-${date}.xlsx`, buffer: exportWorkbookBuffer(products), count: products.length };
    });
  }
  return { productWorkbookTemplate, productWorkbookPreview, productWorkbookCommit, productWorkbookExport };
}

module.exports = {
  HEADERS, MAX_ROWS, readRows, analyzeRows, workbookBuffer, exportWorkbookBuffer,
  safeSpreadsheetText, createPosProductWorkbookService,
};
