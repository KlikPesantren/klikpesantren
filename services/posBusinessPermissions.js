const EXPLICIT_MARKER = '__EFFECTIVE_V1__';
const GROUPS = Object.freeze({
  SALES:['SALE_CREATE','SALE_VIEW','SALE_REFUND','SALE_DISCOUNT'],
  SHIFT:['SHIFT_OPEN','SHIFT_CLOSE','SHIFT_VIEW_HISTORY'],
  CUSTOMER:['CUSTOMER_VIEW','CUSTOMER_MANAGE','CUSTOMER_CREDIT_VIEW','CUSTOMER_CREDIT_MANAGE'],
  PRODUCT:['PRODUCT_VIEW','PRODUCT_MANAGE','PRODUCT_PRICE_MANAGE','PRODUCT_COST_VIEW'],
  INVENTORY:['INVENTORY_VIEW','INVENTORY_ADJUST','INVENTORY_OPNAME','INVENTORY_MOVEMENT_VIEW'],
  PURCHASE:['PURCHASE_VIEW','PURCHASE_CREATE','PURCHASE_RETURN'], SUPPLIER:['SUPPLIER_VIEW','SUPPLIER_MANAGE'],
  AP:['AP_VIEW','AP_PAY'], AR:['AR_VIEW','AR_COLLECT'],
  FINANCE:['FINANCE_ACCOUNT_VIEW','FINANCE_TRANSACTION_VIEW','EXPENSE_CREATE','OTHER_INCOME_CREATE','TRANSFER_CREATE'],
  OWNER_FINANCE:['CAPITAL_MANAGE','PRIVE_MANAGE'],
  REPORTS:['REPORT_SALES','REPORT_PROFIT','REPORT_INVENTORY','REPORT_FINANCE','REPORT_CUSTOMER','REPORT_ONLINE'],
  ONLINE:['ONLINE_STORE_VIEW','ONLINE_STORE_MANAGE','ONLINE_ORDER_MANAGE'],
  USERS:['USER_VIEW','USER_MANAGE','PERMISSION_MANAGE'], SETTINGS:['BUSINESS_SETTINGS_VIEW','BUSINESS_SETTINGS_MANAGE'],
});
const ALL=Object.freeze([...new Set(Object.values(GROUPS).flat())]);
const DEFAULTS=Object.freeze({
 OWNER:ALL,
 SUPERVISOR:['SALE_CREATE','SALE_VIEW','SALE_REFUND','SALE_DISCOUNT','SHIFT_OPEN','SHIFT_CLOSE','SHIFT_VIEW_HISTORY','CUSTOMER_VIEW','CUSTOMER_MANAGE','CUSTOMER_CREDIT_VIEW','PRODUCT_VIEW','PRODUCT_MANAGE','PRODUCT_PRICE_MANAGE','PRODUCT_COST_VIEW','INVENTORY_VIEW','INVENTORY_ADJUST','INVENTORY_OPNAME','INVENTORY_MOVEMENT_VIEW','PURCHASE_VIEW','PURCHASE_CREATE','PURCHASE_RETURN','SUPPLIER_VIEW','SUPPLIER_MANAGE','AP_VIEW','AP_PAY','AR_VIEW','AR_COLLECT','REPORT_SALES','REPORT_INVENTORY','REPORT_CUSTOMER','REPORT_ONLINE','ONLINE_STORE_VIEW','ONLINE_ORDER_MANAGE','BUSINESS_SETTINGS_VIEW'],
 CASHIER:['SALE_CREATE','SALE_VIEW','SHIFT_OPEN','SHIFT_CLOSE','SHIFT_VIEW_HISTORY','CUSTOMER_VIEW','PRODUCT_VIEW'],
});
const LEGACY=Object.freeze({'profile.read':'BUSINESS_SETTINGS_VIEW','products.read':'PRODUCT_VIEW','products.manage':'PRODUCT_MANAGE','customers.read':'CUSTOMER_VIEW','parties.manage':'CUSTOMER_MANAGE','purchases.post':'PURCHASE_CREATE','stock.adjust':'INVENTORY_ADJUST','sale.post':'SALE_CREATE','sale.discount':'SALE_DISCOUNT','returns.post':'SALE_REFUND','shifts.own':'SHIFT_OPEN','money.manage':'FINANCE_TRANSACTION_VIEW','debt.collect':'AR_COLLECT','reports.read':'REPORT_PROFIT','users.manage':'USER_MANAGE','profile.manage':'BUSINESS_SETTINGS_MANAGE','wallet.preview':'SALE_CREATE','wallet.credentials.manage':'BUSINESS_SETTINGS_MANAGE','store.manage':'ONLINE_STORE_MANAGE','orders.read':'ONLINE_STORE_VIEW','orders.manage':'ONLINE_ORDER_MANAGE'});
function canonical(value){return ALL.includes(value)?value:LEGACY[value]||null;}
function validate(list){if(!Array.isArray(list))return null;const out=[...new Set(list.map(canonical))];return out.includes(null)?null:out.sort();}
function effective(role,stored=[]){if(role==='OWNER')return [...ALL];const explicit=stored.includes(EXPLICIT_MARKER),supplied=validate(stored.filter(p=>p!==EXPLICIT_MARKER));if(!supplied)return [];return [...new Set(explicit?supplied:[...(DEFAULTS[role]||[]),...supplied])].sort();}
function encodeExplicit(list){const valid=validate(list);return valid?[EXPLICIT_MARKER,...valid]:null;}
function has(member,permission){return effective(member.role,member.permissions).includes(canonical(permission));}
module.exports={GROUPS,ALL,DEFAULTS,EXPLICIT_MARKER,canonical,validate,effective,encodeExplicit,has};
