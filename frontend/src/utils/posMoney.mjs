export function rupiah(value='0') {
 if(value===null)return '—';
 const text=String(value??'0');
 if(!/^-?\d+$/.test(text))return '—';
 return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(BigInt(text));
}
export function moneyInput(value){
 const text=String(value);
 if(!/^\d+$/.test(text)||BigInt(text)>9223372036854775807n)throw new Error('Nominal harus Rupiah bulat yang valid.');
 return BigInt(text).toString();
}
