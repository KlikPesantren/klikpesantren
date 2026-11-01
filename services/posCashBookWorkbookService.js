const XLSX = require('xlsx');

const MAX_EXPORT_ROWS = 25000;
const MAX_SAFE_RUPIAH = BigInt(Number.MAX_SAFE_INTEGER);
const FORMULA_PREFIX = /^[=+\-@]/;

function safeText(value) {
  const text = String(value ?? '');
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function moneyNumber(value) {
  const amount = BigInt(value || 0);
  if (amount > MAX_SAFE_RUPIAH || amount < -MAX_SAFE_RUPIAH) {
    throw Object.assign(Error('CASH_BOOK_EXCEL_AMOUNT_TOO_LARGE'), { code: 'CASH_BOOK_EXCEL_AMOUNT_TOO_LARGE', status: 422 });
  }
  return Number(amount);
}

function styleSheet(sheet, widths, moneyColumns = []) {
  sheet['!cols'] = widths.map(wch => ({ wch }));
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let row = 1; row <= range.e.r; row++) {
    for (const column of moneyColumns) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell?.t === 'n') cell.z = '#,##0;[Red](#,##0);-';
    }
  }
}

function buildCashBookWorkbook(book) {
  if (book.total_rows > MAX_EXPORT_ROWS || book.rows.length > MAX_EXPORT_ROWS) {
    throw Object.assign(Error('CASH_BOOK_EXPORT_TOO_LARGE'), { code: 'CASH_BOOK_EXPORT_TOO_LARGE', status: 413 });
  }
  const workbook = XLSX.utils.book_new();
  const summaryRows = [
    ['Buku Kas Usaha'],
    ['Merchant', safeText(book.merchant.name)],
    ['Periode', `${book.from} s.d. ${book.to}`],
    ['Zona waktu', safeText(book.merchant.timezone)],
    [],
    ['Ringkasan', 'Nominal'],
    ['Saldo awal periode', moneyNumber(book.summary.opening_balance)],
    ['Uang masuk eksternal', moneyNumber(book.summary.money_in)],
    ['Uang keluar eksternal', moneyNumber(book.summary.money_out)],
    ['Arus kas bersih eksternal', moneyNumber(book.summary.net_cash_flow)],
    ['Perubahan saldo kas/bank/QRIS', moneyNumber(book.summary.balance_change)],
    ['Saldo akhir periode', moneyNumber(book.summary.ending_balance)],
    [],
    ['Informasi pembanding', 'Nominal'],
    ['Omzet periode', moneyNumber(book.summary.turnover)],
    ['Piutang belum tertagih per akhir periode', moneyNumber(book.summary.receivables)],
    ['Settlement Dompet Santri belum disalurkan', moneyNumber(book.summary.settlement_pending)],
    [],
    ['Akun', 'Jenis', 'Saldo awal', 'Uang masuk', 'Uang keluar', 'Transfer masuk', 'Transfer keluar', 'Perubahan saldo', 'Saldo akhir'],
    ...book.accounts.map(account => [
      safeText(account.name), safeText(account.kind), moneyNumber(account.opening_balance), moneyNumber(account.money_in),
      moneyNumber(account.money_out), moneyNumber(account.transfer_in), moneyNumber(account.transfer_out),
      moneyNumber(account.balance_change), moneyNumber(account.ending_balance),
    ]),
  ];
  const summary = XLSX.utils.aoa_to_sheet(summaryRows);
  styleSheet(summary, [35, 18, 18, 18, 18, 18, 18, 20, 18], [1, 2, 3, 4, 5, 6, 7, 8]);
  XLSX.utils.book_append_sheet(workbook, summary, 'Ringkasan');

  const movementHeaders = ['Tanggal & Waktu', 'Nomor Referensi', 'Keterangan', 'Kategori', 'Akun', 'Jenis Akun', 'Operator', 'Shift', 'Uang Masuk', 'Uang Keluar', 'Saldo Berjalan Akun', 'Sumber ID'];
  const movements = [...book.rows].sort((left, right) => new Date(left.occurred_at) - new Date(right.occurred_at) || String(left.id).localeCompare(String(right.id)));
  const movementRows = movements.map(row => [
    new Date(row.occurred_at), safeText(row.reference || ''), safeText(row.reason || row.party || ''), safeText(row.kind),
    safeText(row.account_name), safeText(row.account_kind), safeText(row.actor_name || 'Sistem'), safeText(row.shift_id || ''),
    moneyNumber(row.money_in), moneyNumber(row.money_out), moneyNumber(row.running_balance), safeText(row.source_id),
  ]);
  const mutation = XLSX.utils.aoa_to_sheet([movementHeaders, ...movementRows], { cellDates: true });
  mutation['!autofilter'] = { ref: `A1:L${Math.max(1, movementRows.length + 1)}` };
  styleSheet(mutation, [22, 22, 36, 20, 26, 14, 24, 38, 16, 16, 20, 38], [8, 9, 10]);
  for (let row = 1; row <= movementRows.length; row++) {
    const cell = mutation[XLSX.utils.encode_cell({ r: row, c: 0 })];
    if (cell) cell.z = 'yyyy-mm-dd hh:mm:ss';
  }
  XLSX.utils.book_append_sheet(workbook, mutation, 'Mutasi');

  const shiftHeaders = ['Kasir', 'Shift', 'Terminal', 'Laci Kas', 'Mulai', 'Selesai', 'Kas Awal', 'Penerimaan Tunai', 'Refund Tunai', 'Mutasi Laci Lain', 'Kas Seharusnya', 'Kas Fisik', 'Selisih', 'Status'];
  const shiftRows = book.shifts.map(shift => [
    safeText(shift.cashier), safeText(shift.id), safeText(shift.terminal), safeText(shift.drawer), new Date(shift.opened_at),
    shift.closed_at ? new Date(shift.closed_at) : '', moneyNumber(shift.opening_cash), moneyNumber(shift.cash_receipts),
    moneyNumber(shift.cash_refunds), moneyNumber(shift.drawer_other), shift.expected_cash == null ? '' : moneyNumber(shift.expected_cash),
    shift.actual_cash == null ? '' : moneyNumber(shift.actual_cash), shift.difference == null ? '' : moneyNumber(shift.difference), safeText(shift.status),
  ]);
  const shifts = XLSX.utils.aoa_to_sheet([shiftHeaders, ...shiftRows], { cellDates: true });
  shifts['!autofilter'] = { ref: `A1:N${Math.max(1, shiftRows.length + 1)}` };
  styleSheet(shifts, [24, 38, 24, 24, 21, 21, 16, 18, 16, 18, 18, 16, 16, 14], [6, 7, 8, 9, 10, 11, 12]);
  for (let row = 1; row <= shiftRows.length; row++) {
    for (const column of [4, 5]) {
      const cell = shifts[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell?.t === 'd') cell.z = 'yyyy-mm-dd hh:mm:ss';
    }
  }
  XLSX.utils.book_append_sheet(workbook, shifts, 'Audit Shift');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

function filenamePart(value) {
  return String(value || 'merchant').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'merchant';
}

function createCashBookWorkbookService({ cashBook }) {
  async function cashBookWorkbook(req) {
    req._cashBookExport = true;
    try {
      const book = await cashBook(req);
      return {
        filename: `buku-kas-${filenamePart(book.merchant.name)}-${book.from}-${book.to}.xlsx`,
        buffer: buildCashBookWorkbook(book),
        count: book.rows.length,
      };
    } finally {
      delete req._cashBookExport;
    }
  }
  return { cashBookWorkbook };
}

module.exports = { MAX_EXPORT_ROWS, safeText, moneyNumber, buildCashBookWorkbook, createCashBookWorkbookService };
