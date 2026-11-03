// Exact id-ID formatting independent of Android/Hermes BigInt locale support.
// No Number conversion, rounding, or mutation of API/input values.
function rupiah(value){
 const input=String(value??'0').trim(),m=/^(-?)(\d+)(?:\.(\d+))?$/.exec(input||'0');
 if(!m)return '—';
 const whole=m[2].replace(/^0+(?=\d)/,''),fraction=(m[3]||'').replace(/0+$/,'');
 const negative=m[1]&&(whole!=='0'||fraction)?'-':'';
 return `${negative}Rp${whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')}${fraction?','+fraction:''}`;
}
module.exports={rupiah};
