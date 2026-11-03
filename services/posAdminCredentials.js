const crypto=require('node:crypto');
function createAdminCredentials({run,requireTenantSuperadmin,fail,number,businessId,requestId,hash}) {
 const credentialAction=req=>run(req,'pos.config.manage',true,async(c,a)=>{
  requireTenantSuperadmin(a);
  const b=req.body||{},business=businessId(b.business_id),person=number(b.santri_id),action=b.action,request=requestId(b.request_id);
  if(!['ISSUE','REPLACE','REVOKE'].includes(action))fail('INVALID_CREDENTIAL_ACTION');
  const source=action==='ISSUE'?null:businessId(b.credential_id);
  const reason=String(b.reason||'').trim();if(!reason||reason.length>500)fail('CREDENTIAL_REASON_REQUIRED');
  const f={actor:a.user.id,unit:a.unitId,person,action,source,reason};const digest=hash(JSON.stringify(f));
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`pos-admin-card:${a.tenantId}:${person}`]);
  const old=(await c.query('SELECT payload,request_hash FROM pos_business_policy_events WHERE business_id=$1 AND kind=$2 AND request_id=$3',[business,'CREDENTIAL_'+action,request])).rows[0];
  if(old){if(old.request_hash!==digest)fail('IDEMPOTENCY_CONFLICT',409);return {...old.payload,replay:true,token:null,one_time:false};}
  if(!(await c.query(`SELECT b.id FROM pos_businesses b JOIN pos_business_units u ON u.business_id=b.id AND u.tenant_id=b.tenant_id JOIN unit_pendidikan unit ON unit.id=u.unit_id AND unit.tenant_id=u.tenant_id WHERE b.id=$1 AND b.tenant_id=$2 AND u.unit_id=$3 AND ($4::boolean OR (b.active AND b.integration_enabled AND b.wallet_enabled)) AND unit.is_active FOR SHARE OF b,unit`,[business,a.tenantId,a.unitId,action==='REVOKE'])).rowCount)fail('MERCHANT_SCOPE_DENIED',403);
  let previous;
  if(source){previous=(await c.query('SELECT id,santri_id,active FROM pos_wallet_credentials WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[source,a.tenantId])).rows[0];if(!previous||previous.santri_id!==person)fail('CREDENTIAL_DENIED',403);if(!previous.active)fail('CREDENTIAL_DISABLED',409);}
  // Revocation must remain possible after enrollment/student status becomes inactive.
  if(action!=='REVOKE'){
   if(!(await c.query(`SELECT s.id FROM santri s JOIN santri_units u ON u.santri_id=s.id AND u.tenant_id=s.tenant_id WHERE s.id=$1 AND s.tenant_id=$2 AND u.unit_id=$3 AND u.status='active' AND u.left_at IS NULL AND lower(btrim(s.status)) IN('active','aktif') FOR SHARE OF s,u`,[person,a.tenantId,a.unitId])).rowCount)fail('MEMBERSHIP_INACTIVE',403);
   if(!await require('./unitFeatureService').isUnitFeatureEnabled(a.tenantId,a.unitId,'wallet',c))fail('FEATURE_DISABLED',403);
  }
  let token=null,id=source;
  if(previous)await c.query('UPDATE pos_wallet_credentials SET active=false,revoked_at=now() WHERE id=$1',[source]);
  if(action!=='REVOKE'){
   id=crypto.randomUUID();token='kpw_'+crypto.randomBytes(32).toString('base64url');
   await c.query('INSERT INTO pos_wallet_credentials(id,tenant_id,santri_id,created_business_id,created_by,admin_created_by,token_hash) VALUES($1,$2,$3,$4,NULL,$5,$6)',[id,a.tenantId,person,business,a.user.id,hash(token)]);
  }
  const result={id,action,previous_id:source,unit_id:a.unitId,reason};
  await c.query(`INSERT INTO pos_business_policy_events(id,business_id,tenant_id,admin_actor_id,kind,request_id,request_hash,subject_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[crypto.randomUUID(),business,a.tenantId,a.user.id,'CREDENTIAL_'+action,request,digest,id,JSON.stringify(result)]);
  return {...result,token,one_time:!!token,replay:false};
 });
 return {credentialAction};
}
module.exports={createAdminCredentials};
