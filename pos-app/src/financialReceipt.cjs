const {rupiah}=require('./moneyFormat.cjs');
const NAMES={EXPENSE:'Bukti Pengeluaran',OTHER_INCOME:'Bukti Pemasukan',TRANSFER:'Bukti Transfer Saldo',MONEY_REVERSAL:'Bukti Pembatalan',AR_COLLECTION:'Pelunasan Piutang',AP_PAYMENT:'Pembayaran Supplier',PURCHASE:'Bukti Pembelian',SALE_RETURN:'Bukti Retur Penjualan',PURCHASE_RETURN:'Bukti Retur Pembelian'};
function financialProofText(value){
 const d=value.finance_document;if(!d?.id||!d.kind||!/^\d+$/.test(String(d.total)))throw Object.assign(Error('RECEIPT_INVALID'),{code:'RECEIPT_INVALID'});
 const clean=v=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
 const rows=[clean(value.branding?.name||'Suq Shogir'),NAMES[d.kind]||'Bukti Transaksi Keuangan',
  'STATUS: '+({CANCELLED:'DIBATALKAN',CORRECTED:'DIKOREKSI',POSTED:'TERCATAT'}[d.status]||clean(d.status)),
  'No: '+clean(d.reference||d.id),'Tanggal pembukuan: '+require('./financePresentation.cjs').displayDate(d.business_date),'Dicatat: '+new Date(d.created_at).toLocaleString('id-ID',{timeZone:d.timezone||'Asia/Jakarta'}),
  'Nominal: '+rupiah(d.total),'Dibayar/dicatat: '+rupiah(d.paid),'Keterangan: '+clean(d.reason||'—')];
 for(const leg of d.legs||[])rows.push((BigInt(leg.amount)<0n?'Keluar / ':'Masuk / ')+clean(leg.name)+': '+rupiah(BigInt(leg.amount)<0n?-BigInt(leg.amount):leg.amount));
 for(const fee of d.fees||[])rows.push('Biaya admin tetap tercatat: '+rupiah(fee.total)+' / Ref '+clean(fee.id));
 if(d.source_id)rows.push('Referensi asal: '+clean(d.source_id));
 if(d.reversal_id)rows.push('Pembatalan: '+clean(d.reversal_id));
 if(d.correction_id)rows.push('Pengganti: '+clean(d.correction_id));
 if(value.branding?.legacy_current_accounts)rows.push('Label akun arsip lama mengikuti data saat dicetak. Identitas akun asli tetap pada catatan.');
 if(value.branding?.legacy_current_brand)rows.push('Nama usaha memakai data saat dicetak (arsip lama).');
 if(d.kind==='MONEY_REVERSAL'||d.status!=='POSTED')rows.push('Bukti pembukuan. Pengembalian uang eksternal harus dipastikan terpisah.');
 return rows.join('\n');
}
module.exports={financialProofText};
