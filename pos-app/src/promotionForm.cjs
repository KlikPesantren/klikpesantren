const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(value) {
  const match = DATE_RE.exec(String(value || ""));
  if (!match) throw Object.assign(Error("INVALID_PROMOTION_PERIOD"), { code: "INVALID_PROMOTION_PERIOD" });
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day)
    throw Object.assign(Error("INVALID_PROMOTION_PERIOD"), { code: "INVALID_PROMOTION_PERIOD" });
  return { year, month, day };
}

function localParts(instant, timeZone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant)).filter(item => item.type !== "literal").map(item => [item.type, Number(item.value)]));
  return values;
}

function zoneOffset(instant, timeZone) {
  const p = localParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

function startOfBusinessDate(value, timeZone = "Asia/Jakarta") {
  const p = parts(value), target = Date.UTC(p.year, p.month - 1, p.day);
  let instant = target - zoneOffset(target, timeZone);
  instant = target - zoneOffset(instant, timeZone);
  return instant;
}

function addDays(value, count) {
  const p = parts(value), next = new Date(Date.UTC(p.year, p.month - 1, p.day + count));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function businessDateToIso(value, timeZone = "Asia/Jakarta", endOfDay = false) {
  if (!value) return null;
  const instant = endOfDay ? startOfBusinessDate(addDays(value, 1), timeZone) - 1 : startOfBusinessDate(value, timeZone);
  return new Date(instant).toISOString();
}

function isoToBusinessDate(value, timeZone = "Asia/Jakarta") {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(+date)) throw Object.assign(Error("INVALID_PROMOTION_PERIOD"), { code: "INVALID_PROMOTION_PERIOD" });
  const p = localParts(+date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function todayInBusiness(timeZone = "Asia/Jakarta", now = Date.now()) {
  return isoToBusinessDate(new Date(now).toISOString(), timeZone);
}

function displayBusinessDate(value) {
  if (!value) return "Tidak dibatasi";
  const p = parts(value);
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(p.year, p.month - 1, p.day)));
}

function promotionPayload(form, timeZone, createId) {
  if (!form.name?.trim()) throw Object.assign(Error("INVALID_PROMOTION"), { code: "INVALID_PROMOTION" });
  const discountKind=['PERCENT','FIXED'].includes(form.kind);
  if (!discountKind&&!/^(0|[1-9]\d*)$/.test(String(form.group_price??''))) throw Object.assign(Error('INVALID_PRICING_INTEGER'),{code:'INVALID_PRICING_INTEGER'});
  if(form.kind==='FIXED'&&!/^(0|[1-9]\d*)$/.test(String(form.discount_amount??'')))throw Object.assign(Error('INVALID_DISCOUNT'),{code:'INVALID_DISCOUNT'});
  const priority = form.priority === "" || form.priority == null ? "0" : String(form.priority);
  if (!/^-?(0|[1-9]\d*)$/.test(priority) || Math.abs(Number(priority)) > 100000)
    throw Object.assign(Error("INVALID_PROMOTION_PRIORITY"), { code: "INVALID_PROMOTION_PRIORITY" });
  const startsAt = businessDateToIso(form.start_date, timeZone);
  const endsAt = businessDateToIso(form.end_date, timeZone, true);
  if (startsAt && endsAt && startsAt >= endsAt)
    throw Object.assign(Error("INVALID_PROMOTION_PERIOD"), { code: "INVALID_PROMOTION_PERIOD" });
  const base = {
    id: form.id || createId(), name: form.name.trim(), kind: form.kind,
    group_price: discountKind?'0':String(form.group_price), priority, level_id:null,
    ...(form.kind==='PERCENT'?{discount_bps:percentBasisPoints(form.discount_percent)}:form.kind==='FIXED'?{discount_amount:String(form.discount_amount)}:{}),
    starts_at: startsAt, ends_at: endsAt, active: form.active !== false,
  };
  if (["QUANTITY","PERCENT","FIXED"].includes(form.kind)) return {
    ...base, product_id: form.product_id, threshold: form.kind==='QUANTITY'?String(form.threshold):'1', mode: form.mode || "EVERY", components: [],
  };
  return { ...base, mode: "EVERY", components: (form.components || []).map(item => ({ product_id: item.product_id, quantity: String(item.quantity) })) };
}

function quantityPreview(unitPrice, threshold, groupPrice, mode = "EVERY", maximum = 7) {
  const unit = BigInt(unitPrice || 0), size = BigInt(threshold || 0), promo = BigInt(groupPrice || 0);
  if (!size || promo > unit * size) return [];
  return Array.from({ length: maximum }, (_, index) => {
    const quantity = BigInt(index + 1), groups = quantity >= size ? (mode === "ONCE" ? 1n : quantity / size) : 0n;
    return { quantity: String(quantity), total: String(groups * promo + (quantity - groups * size) * unit) };
  });
}

function percentBasisPoints(value){const input=String(value??'').replace(',','.');if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(input))throw Object.assign(Error('INVALID_DISCOUNT'),{code:'INVALID_DISCOUNT'});const [whole,decimal='']=input.split('.'),bps=BigInt(whole)*100n+BigInt(decimal.padEnd(2,'0'));if(bps>10000n)throw Object.assign(Error('INVALID_DISCOUNT'),{code:'INVALID_DISCOUNT'});return String(bps);}
function discountPreview(base,form){try{const normal=BigInt(base);if(form.kind==='PERCENT'&&form.discount_percent!==''){const discount=normal*BigInt(percentBasisPoints(form.discount_percent))/10000n;return {normal:String(normal),discount:String(discount),total:String(normal-discount)};}if(form.kind==='FIXED'&&/^(0|[1-9]\d*)$/.test(String(form.discount_amount))){const discount=BigInt(form.discount_amount);if(discount>normal)return null;return {normal:String(normal),discount:String(discount),total:String(normal-discount)};}return null;}catch{return null;}}
module.exports = { percentBasisPoints,discountPreview,
  addDays, businessDateToIso, displayBusinessDate, isoToBusinessDate,
  promotionPayload, quantityPreview, todayInBusiness,
};
