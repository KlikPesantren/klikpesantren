const GROUPS=Object.freeze({
 SALES:[['SALE_CREATE','Melakukan Penjualan'],['SALE_VIEW','Melihat Transaksi'],['SALE_REFUND','Retur Penjualan'],['SALE_DISCOUNT','Memberikan Diskon']],
 SHIFT:[['SHIFT_OPEN','Buka Shift'],['SHIFT_CLOSE','Tutup Shift'],['SHIFT_VIEW_HISTORY','Riwayat Shift']],
 PRODUCT:[['PRODUCT_VIEW','Melihat Produk'],['PRODUCT_MANAGE','Kelola Produk'],['PRODUCT_PRICE_MANAGE','Kelola Harga'],['PRODUCT_COST_VIEW','Melihat HPP']],
 INVENTORY:[['INVENTORY_VIEW','Melihat Stok'],['INVENTORY_ADJUST','Penyesuaian Stok'],['INVENTORY_OPNAME','Stok Opname'],['INVENTORY_MOVEMENT_VIEW','Pergerakan Stok']],
 CUSTOMER:[['CUSTOMER_VIEW','Melihat Customer'],['CUSTOMER_MANAGE','Kelola Customer'],['CUSTOMER_CREDIT_VIEW','Melihat Kredit Customer'],['CUSTOMER_CREDIT_MANAGE','Kelola Kredit Customer']],
 AR:[['AR_VIEW','Melihat Piutang'],['AR_COLLECT','Menerima Pembayaran Piutang']],
 PURCHASE:[['PURCHASE_VIEW','Melihat Pembelian'],['PURCHASE_CREATE','Membuat Pembelian'],['PURCHASE_RETURN','Retur Pembelian']],
 SUPPLIER:[['SUPPLIER_VIEW','Melihat Supplier'],['SUPPLIER_MANAGE','Kelola Supplier']],
 AP:[['AP_VIEW','Melihat Utang Supplier'],['AP_PAY','Bayar Utang Supplier']],
 FINANCE:[['FINANCE_ACCOUNT_VIEW','Lihat Kas/Rekening'],['FINANCE_TRANSACTION_VIEW','Lihat Mutasi'],['EXPENSE_CREATE','Catat Pengeluaran'],['OTHER_INCOME_CREATE','Pendapatan Lain'],['TRANSFER_CREATE','Transfer']],
 OWNER_FINANCE:[['CAPITAL_MANAGE','Modal'],['PRIVE_MANAGE','Prive']],
 REPORTS:[['REPORT_SALES','Penjualan'],['REPORT_PROFIT','Laba Kotor'],['REPORT_INVENTORY','Stok'],['REPORT_FINANCE','Keuangan'],['REPORT_CUSTOMER','Customer'],['REPORT_ONLINE','Online Store']],
 ONLINE:[['ONLINE_STORE_VIEW','Lihat Toko Online'],['ONLINE_STORE_MANAGE','Kelola Toko'],['ONLINE_ORDER_MANAGE','Kelola Pesanan']],
 USERS:[['USER_VIEW','Lihat Pengguna'],['USER_MANAGE','Kelola Pengguna'],['PERMISSION_MANAGE','Kelola Hak Akses']],
 SETTINGS:[['BUSINESS_SETTINGS_VIEW','Lihat Pengaturan Usaha'],['BUSINESS_SETTINGS_MANAGE','Kelola Pengaturan Usaha']],
});
const MODULES=Object.freeze([
 ['BERANDA',null,'home'],['KASIR','SALE_CREATE','shopping-bag'],['TRANSAKSI','SALE_VIEW','file-text'],['SHIFT','SHIFT_VIEW_HISTORY','clock'],
 ['PRODUK','PRODUCT_VIEW','grid'],['STOK','INVENTORY_VIEW','archive'],['CUSTOMER','CUSTOMER_VIEW','users'],
 ['SUPPLIER','SUPPLIER_VIEW','truck'],['PEMBELIAN','PURCHASE_VIEW','shopping-cart'],['PIUTANG','AR_VIEW','arrow-down-circle'],
 ['UTANG','AP_VIEW','arrow-up-circle'],['KEUANGAN',['FINANCE_ACCOUNT_VIEW','FINANCE_TRANSACTION_VIEW','EXPENSE_CREATE','OTHER_INCOME_CREATE','TRANSFER_CREATE','CAPITAL_MANAGE','PRIVE_MANAGE'],'credit-card'],['LAPORAN',['REPORT_SALES','REPORT_PROFIT','REPORT_INVENTORY','REPORT_FINANCE','REPORT_CUSTOMER','REPORT_ONLINE'],'bar-chart-2'],
 ['TOKO ONLINE','ONLINE_STORE_VIEW','globe'],['PENGGUNA','USER_VIEW','user-check'],['PENGATURAN','BUSINESS_SETTINGS_VIEW','settings'],
]);
const DEFAULTS=Object.freeze({
 CASHIER:['SALE_CREATE','SALE_VIEW','SHIFT_OPEN','SHIFT_CLOSE','SHIFT_VIEW_HISTORY','CUSTOMER_VIEW','PRODUCT_VIEW'],
 SUPERVISOR:['SALE_CREATE','SALE_VIEW','SALE_REFUND','SALE_DISCOUNT','SHIFT_OPEN','SHIFT_CLOSE','SHIFT_VIEW_HISTORY','CUSTOMER_VIEW','CUSTOMER_MANAGE','CUSTOMER_CREDIT_VIEW','PRODUCT_VIEW','PRODUCT_MANAGE','PRODUCT_PRICE_MANAGE','PRODUCT_COST_VIEW','INVENTORY_VIEW','INVENTORY_ADJUST','INVENTORY_OPNAME','INVENTORY_MOVEMENT_VIEW','PURCHASE_VIEW','PURCHASE_CREATE','PURCHASE_RETURN','SUPPLIER_VIEW','SUPPLIER_MANAGE','AP_VIEW','AP_PAY','AR_VIEW','AR_COLLECT','REPORT_SALES','REPORT_INVENTORY','REPORT_CUSTOMER','REPORT_ONLINE','ONLINE_STORE_VIEW','ONLINE_ORDER_MANAGE','BUSINESS_SETTINGS_VIEW'],
});
function navigationItems(permissions=[]){const allowed=new Set(permissions);return MODULES.filter(([,permission])=>!permission||(Array.isArray(permission)?permission.some(item=>allowed.has(item)):allowed.has(permission))).map(([id,permission,icon])=>({id,permission,icon}));}
function navigation(permissions=[]){return navigationItems(permissions).map(item=>item.id);}
function ownerCards(workspace,permissions=[]){const allowed=new Set(permissions),cards=[];if(allowed.has('REPORT_SALES'))cards.push('omzet','transaction_count','average_ticket','payment_mix','pos_vs_online');if(allowed.has('REPORT_PROFIT'))cards.push('gross_profit');if(allowed.has('AR_VIEW'))cards.push('outstanding_receivable');if(allowed.has('AP_VIEW'))cards.push('outstanding_payable');if(allowed.has('INVENTORY_VIEW'))cards.push('low_stock');if(allowed.has('ONLINE_STORE_VIEW'))cards.push('pending_online_orders');return cards.filter(key=>workspace?.[key]!==undefined);}
function can(permissions,key){return permissions.includes(key);}
module.exports={GROUPS,MODULES,DEFAULTS,navigation,navigationItems,ownerCards,can};
