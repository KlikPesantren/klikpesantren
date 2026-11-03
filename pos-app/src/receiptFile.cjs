const { buildReceiptHtml, normalizeDevicePreferences } = require('./receiptOutput.cjs');
const failure = code => Object.assign(Error(code), { code });
const MESSAGES = {
  RECEIPT_INVALID: 'Struk transaksi tersimpan belum lengkap. Muat ulang struk dari Riwayat.',
  RECEIPT_PDF_INVALID: 'File PDF struk gagal dibuat atau kosong. Transaksi tetap tersimpan.',
  RECEIPT_PRINT_FAILED: 'Dialog cetak tidak dapat dibuka. Periksa layanan cetak Android.',
  RECEIPT_SAVE_FAILED: 'PDF belum tersimpan. Periksa izin folder dan ruang penyimpanan.',
  RECEIPT_SHARE_FAILED: 'PDF tidak dapat dibagikan. Periksa aplikasi tujuan berbagi.',
  FILE_SHARING_UNAVAILABLE: 'Perangkat tidak menyediakan aplikasi untuk berbagi PDF.',
};
const receiptActionError = error => MESSAGES[error?.code] || 'Aksi struk gagal. Transaksi tetap tersimpan; Anda dapat menekan Selesai.';
function createReceiptActions({ Print, FileSystem, Sharing, platform }) {
  return async function output(value, action, preferences) {
    if (!value?.finance_document?.id && (!value?.sale?.id || !value.items?.length || !value.payments?.length)) throw failure('RECEIPT_INVALID');
    const html = buildReceiptHtml(value, normalizeDevicePreferences(preferences).paper_width);
    if (action === 'print') {
      try { await Print.printAsync({ html }); return { dialogOpened: true }; }
      catch (error) {
        if (/cancel/i.test(error?.code || '')) return { cancelled: true };
        throw failure('RECEIPT_PRINT_FAILED');
      }
    }
    let file;
    try {
      file = await Print.printToFileAsync({ html });
      const info = await FileSystem.getInfoAsync(file.uri);
      const header = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64, position: 0, length: 5 });
      if (!info.exists || info.size < 20 || !header.startsWith('JVBERi0') || file.numberOfPages < 1) throw failure('RECEIPT_PDF_INVALID');
    } catch { throw failure('RECEIPT_PDF_INVALID'); }
    if (action === 'save' && platform === 'android') {
      try {
        const saf = FileSystem.StorageAccessFramework;
        const permission = await saf.requestDirectoryPermissionsAsync();
        if (!permission.granted) return { cancelled: true };
        const name = `Suq-Struk-${String(value.branding?.receipt || value.sale?.id || value.finance_document?.id).replace(/[^a-zA-Z0-9._-]/g, '-')}.pdf`;
        const target = await saf.createFileAsync(permission.directoryUri, name, 'application/pdf');
        const bytes = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(target, bytes, { encoding: FileSystem.EncodingType.Base64 });
        return { saved: true };
      } catch { throw failure('RECEIPT_SAVE_FAILED'); }
    }
    if (!await Sharing.isAvailableAsync()) throw failure('FILE_SHARING_UNAVAILABLE');
    try { await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Struk Suq Shogir' }); }
    catch { throw failure('RECEIPT_SHARE_FAILED'); }
    return { shared: true };
  };
}
module.exports = { createReceiptActions, receiptActionError };
