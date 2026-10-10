const crypto=require('node:crypto');
function createBusinessWallet(h) {
 const {run,bad,amount,uuid,makeId,featureEnabled,afterStage}=h;
 const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
 function input(b) {
  const type=b.credential_method;
  if(!['RFID','BARCODE','QR'].includes(type))bad('INVALID_CREDENTIAL_METHOD');
  if(typeof b.credential!=='string'||!b.credential.trim()||b.credential.length>100)bad('UNKNOWN_CREDENTIAL',404);
  const raw=b.credential.trim();
  const credential=type==='RFID' && /^[a-f0-9]+$/i.test(raw)?raw.toLowerCase():raw;
  if(type!=='RFID'&&!/^kpw_[A-Za-z0-9_-]{43}$/.test(credential))bad('UNKNOWN_CREDENTIAL',404);
  if(!/^[1-9]\d*$/.test(String(b.unit_id))||Number(b.unit_id)>2147483647)bad('UNIT_REQUIRED');
  if(b.wallet_account_id!=null||b.account_id!=null||b.balance!=null)bad('CLIENT_WALLET_AUTHORITY_REJECTED',403);
  return {type,credential,hash:digest(credential),unit:Number(b.unit_id)};
 }
 async function authority(c,a,unit,type='BARCODE') {
  if(!a.member.integration_enabled||!a.member.wallet_enabled)bad('WALLET_INTEGRATION_DENIED',403);
  const allowed=await c.query(`SELECT u.id FROM pos_business_units bu JOIN unit_pendidikan u ON u.id=bu.unit_id AND u.tenant_id=bu.tenant_id
   WHERE bu.business_id=$1 AND bu.tenant_id=$2 AND bu.unit_id=$3 AND u.is_active FOR SHARE OF bu,u`,[a.business,a.member.tenant_id,unit]);
  if(!allowed.rowCount)bad('WALLET_UNIT_DENIED',403);
  if(!await featureEnabled(a.member.tenant_id,unit,'wallet',c)||type==='RFID'&&!await featureEnabled(a.member.tenant_id,unit,'rfid',c))bad('FEATURE_DISABLED',403);
 }
 async function eligible(c,a,unit,person) {
  const rows=(await c.query(`SELECT s.id,s.nama FROM santri s JOIN santri_units su ON su.santri_id=s.id AND su.tenant_id=s.tenant_id
   WHERE s.id=$1 AND s.tenant_id=$2 AND su.unit_id=$3 AND su.status='active' AND su.left_at IS NULL
   AND lower(btrim(s.status)) IN('active','aktif') FOR SHARE OF s,su`,[person,a.member.tenant_id,unit])).rows;
  if(rows.length!==1)bad('MEMBERSHIP_INACTIVE',403);return rows[0];
 }
 async function resolve(c,a,f,lock=true) {
  await authority(c,a,f.unit,f.type);let person;
  if(f.type==='RFID') {
   const people=(await c.query(`SELECT id FROM santri WHERE tenant_id=$1 AND
    CASE WHEN btrim(uid_rfid) ~ '^[0-9a-fA-F]+$' THEN lower(btrim(uid_rfid)) ELSE btrim(uid_rfid) END=$2 LIMIT 2 FOR SHARE`,[a.member.tenant_id,f.credential])).rows;
   if(!people.length)bad('UNKNOWN_CREDENTIAL',404);if(people.length!==1)bad('AMBIGUOUS_CREDENTIAL',409);person=people[0].id;
  } else {
   const card=(await c.query('SELECT santri_id,active FROM pos_wallet_credentials WHERE tenant_id=$1 AND token_hash=$2 FOR SHARE',[a.member.tenant_id,f.hash])).rows[0];
   if(!card)bad('UNKNOWN_CREDENTIAL',404);if(!card.active)bad('CREDENTIAL_DISABLED',403);person=card.santri_id;
  }
  const p=await eligible(c,a,f.unit,person);
  const w=await require('./walletUnitService').getWalletAccountForSantri(c,{tenantId:a.member.tenant_id,unitId:f.unit,santriId:person,lock});
  if(!w)bad('WALLET_ACCOUNT_REQUIRED',409);if(w.status!=='active')bad('WALLET_NOT_ACTIVE',403);
  return {w,p};
 }
 async function clearing(c,a) {
  await c.query(`INSERT INTO pos_business_accounts(id,business_id,name,kind) VALUES($1,$2,'Dompet Santri clearing — unsettled','WALLET_CLEARING')
   ON CONFLICT(business_id) WHERE kind='WALLET_CLEARING' DO NOTHING`,[makeId(),a.business]);
  return (await c.query("SELECT id FROM pos_business_accounts WHERE business_id=$1 AND kind='WALLET_CLEARING' AND active FOR UPDATE",[a.business])).rows[0]?.id || bad('WALLET_CLEARING_REQUIRED',409);
 }
 async function movement(c,a,w,value,direction,operation,payment) {
  const balance=BigInt(w.current_balance)+(direction==='credit'?value:-value);if(balance<0n)bad('INSUFFICIENT_BALANCE',409);
  const id=makeId();
  const tx=(await c.query(`INSERT INTO wallet_transactions(wallet_account_id,tenant_id,unit_id,santri_id,type,direction,amount,balance_after,
   source,reference_type,reference_id,location_unit_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pos_business_v2','pos_business_wallet',$9,$3,$10) RETURNING id`,
   [w.id,w.tenant_id,w.unit_id,w.santri_id,direction==='debit'?'payment':'refund',direction,value.toString(),balance.toString(),id,'pos-business-wallet:'+id])).rows[0].id;
  await c.query('UPDATE wallet_accounts SET current_balance=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND unit_id=$4',[balance.toString(),w.id,w.tenant_id,w.unit_id]);
  await c.query(`INSERT INTO pos_business_wallet_links(id,business_id,operation_id,payment_id,tenant_id,unit_id,wallet_account_id,wallet_transaction_id,direction,amount)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,a.business,operation,payment,w.tenant_id,w.unit_id,w.id,tx,direction,value.toString()]);
  w.current_balance=balance.toString();await afterStage('wallet');return tx;
 }
 async function refund(c,a,source,operation,value) {
  const debit=(await c.query(`SELECT l.* FROM pos_business_wallet_links l JOIN pos_business_payments p ON p.id=l.payment_id
   WHERE l.business_id=$1 AND l.operation_id=$2 AND l.direction='debit' AND p.method='DOMPET_SANTRI'`,[a.business,source])).rows[0];
  if(!debit)bad('WALLET_REFUND_SOURCE_REQUIRED',409);
  const used=BigInt((await c.query("SELECT coalesce(sum(amount),0) n FROM pos_business_wallet_links WHERE payment_id=$1 AND direction='credit'",[debit.payment_id])).rows[0].n);
  if(used+value>BigInt(debit.amount))bad('WALLET_OVER_REFUND',409);
  // Refund original account, never resolve a new credential or choose another unit.
  const w=(await c.query('SELECT * FROM wallet_accounts WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 FOR UPDATE',[debit.wallet_account_id,debit.tenant_id,debit.unit_id])).rows[0];
  if(!w||w.status==='closed')bad('REFUND_WALLET_UNAVAILABLE',409);
  return movement(c,a,w,value,'credit',operation,debit.payment_id);
 }
 const preview=req=>run(req,'wallet.preview',async(c,a)=>{const f=input(req.body),{w,p}=await resolve(c,a,f,false);
  return {name:p.nama,unit_id:f.unit,available_balance:w.current_balance,eligible:true,credential_method:f.type};});
 const provision=req=>run(req,'wallet.credentials.manage',async(c,a)=>{
  const unit=Number(amount(req.body.unit_id,true)),person=Number(amount(req.body.santri_id,true));
  await authority(c,a,unit);await eligible(c,a,unit,person);
  const token='kpw_'+crypto.randomBytes(32).toString('base64url'),id=makeId();
  await c.query(`INSERT INTO pos_wallet_credentials(id,tenant_id,santri_id,created_business_id,created_by,token_hash) VALUES($1,$2,$3,$4,$5,$6)`,[id,a.member.tenant_id,person,a.business,a.user,digest(token)]);
  await c.query("INSERT INTO pos_wallet_credential_audits(id,credential_id,business_id,actor_id,action) VALUES($1,$2,$3,$4,'PROVISION')",[makeId(),id,a.business,a.user]);
  return {id,token,one_time:true};
 });
 const revoke=req=>run(req,'wallet.credentials.manage',async(c,a)=>{
  const card=(await c.query('SELECT * FROM pos_wallet_credentials WHERE id=$1 AND created_business_id=$2 AND tenant_id=$3 FOR UPDATE',[uuid(req.params.credentialId),a.business,a.member.tenant_id])).rows[0];
  if(!card)bad('CREDENTIAL_DENIED',403);await authority(c,a,Number(amount(req.body.unit_id,true)));
  if(card.active){await c.query('UPDATE pos_wallet_credentials SET active=false,revoked_at=now() WHERE id=$1',[card.id]);
   await c.query("INSERT INTO pos_wallet_credential_audits(id,credential_id,business_id,actor_id,action) VALUES($1,$2,$3,$4,'REVOKE')",[makeId(),card.id,a.business,a.user]);}
  return {id:card.id,active:false};
 });
 return {input,resolve,clearing,movement,refund,preview,provision,revoke};
}
module.exports={createBusinessWallet};
