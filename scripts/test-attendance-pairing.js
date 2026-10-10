const assert=require("node:assert/strict");
const bcrypt=require("bcryptjs");
let devices=[],pairings=[],audits=[],backup,failUpdate=false,feature=true;
const publicDevice=d=>Object.fromEntries(Object.entries(d).filter(([k])=>!k.includes("secret")));
const db={release(){},async query(raw,p=[]){
  const sql=raw.replace(/\s+/g," ").trim();
  if(sql==="BEGIN"){backup=structuredClone({devices,pairings,audits});return {rows:[]};}
  if(sql==="COMMIT")return {rows:[]};
  if(sql==="ROLLBACK"){({devices,pairings,audits}=backup);return {rows:[]};}
  if(sql.startsWith("INSERT INTO devices")){
    const d={id:devices.length+1,tenant_id:p[0],unit_id:p[1],device_id:p[2],nama_device:p[3],enabled:false,attendance_mode:"ATTENDANCE"};
    devices.push(d);return {rows:[publicDevice(d)]};
  }
  if(sql.startsWith("UPDATE attendance_device_pairings SET used_at=NOW() WHERE tenant_id")){
    pairings.filter(r=>r.tenant_id===p[0] && r.device_id===p[1] && !r.used_at).forEach(r=>r.used_at=new Date());return {rows:[]};
  }
  if(sql.startsWith("INSERT INTO attendance_device_pairings")){
    const row={id:pairings.length+1,tenant_id:p[0],device_id:p[1],verifier:p[2],issued_by:p[3],expires_at:new Date(Date.now()+p[4]*1000),used_at:null};
    pairings.push(row);return {rows:[{expires_at:row.expires_at}]};
  }
  if(sql.startsWith("INSERT INTO audit_logs")){audits.push(p);return {rows:[]};}
  if(sql.startsWith("SELECT p.tenant_id,p.device_id,p.issued_by,u.role")){
    return {rows:pairings.filter(r=>r.verifier===p[0]).map(r=>({tenant_id:r.tenant_id,device_id:r.device_id,issued_by:r.issued_by,role:"superadmin"}))};
  }
  if(sql.startsWith("SELECT d.id,d.device_id"))return {rows:devices.filter(d=>d.tenant_id===p[0]&&d.id===p[1]).map(d=>({...d,slug:"synthetic-only"}))};
  if(sql.startsWith("SELECT id,issued_by FROM attendance_device_pairings"))return {rows:pairings.filter(r=>r.verifier===p[0]&&r.tenant_id===p[1]&&r.device_id===p[2]&&!r.used_at&&r.expires_at>Date.now())};
  if(sql.startsWith("SELECT role FROM users"))return {rows:[{role:"superadmin"}]};
  if(sql.startsWith("UPDATE devices SET device_secret=")){
    if(failUpdate)throw Object.assign(new Error("synthetic failure"),{code:"TEST_FAILURE"});
    const d=devices.find(d=>d.tenant_id===p[0]&&d.id===p[1]);d.device_secret_hash=p[2];d.enabled=true;return {rows:[]};
  }
  if(sql.startsWith("UPDATE attendance_device_pairings SET used_at=NOW() WHERE id")){
    pairings.find(r=>r.id===p[0]).used_at=new Date();return {rows:[]};
  }
  if(sql.includes("FROM devices")&&sql.includes("device_id=$2"))return {rows:devices.filter(d=>d.tenant_id===p[0]&&d.device_id===p[1]).map(publicDevice)};
  if(sql.includes("FROM devices")&&sql.includes("unit_id=$2"))return {rows:devices.filter(d=>d.tenant_id===p[0]&&d.unit_id===p[1]).map(publicDevice)};
  throw new Error("Unexpected pairing query (values suppressed)");
}};
function stub(module,value){const file=require.resolve(module);require.cache[file]={id:file,filename:file,loaded:true,exports:value};}
stub("../db",{connect:async()=>db,query:db.query});
stub("../services/unitAccessService",{
  accessError:(message,status=403,code="UNIT_ACCESS_DENIED")=>Object.assign(new Error(message),{status,code}),
  resolveActiveUnit:async req=>{
    if(req.body?.unit_id===999)throw Object.assign(new Error("denied"),{status:403});
    return {mode:req.body?.unit_id?"UNIT":"ALL",unitId:req.body.unit_id,tenantId:req.tenantId};
  },assertUnitAccess:async()=>({id:2}),
});
stub("../services/tenantFeatureService",{isFeatureEnabled:async()=>feature});
stub("../middleware/requirePermission",{getPermissionList:async()=>["rfid.manage"]});
const service=require("../services/attendancePairingService");
const req={tenantId:901,user:{id:11},body:{unit_id:2,nama_device:"Perangkat Sintetis"}};
async function rejects(work,code){await assert.rejects(work,e=>e.code===code);}
(async()=>{
  const issued=await service.create(req);assert.equal(issued.pairing_code.length,43);
  assert.equal(pairings[0].verifier.length,64);assert(!JSON.stringify({devices,pairings,audits}).includes(issued.pairing_code));
  const response=await service.redeem(issued.pairing_code);
  assert(await bcrypt.compare(response.device_secret,devices[0].device_secret_hash));
  assert.equal(bcrypt.getRounds(devices[0].device_secret_hash),12);assert(devices[0].enabled);
  assert(!(await bcrypt.compare("synthetic-old-not-production",devices[0].device_secret_hash)));
  await rejects(()=>service.redeem(issued.pairing_code),"PAIRING_INVALID");
  const oldHash=devices[0].device_secret_hash;
  const target={...req,params:{deviceId:devices[0].device_id}};
  const replacement=await service.reissue(target);
  failUpdate=true;await assert.rejects(()=>service.redeem(replacement.pairing_code));failUpdate=false;
  assert.equal(devices[0].device_secret_hash,oldHash);assert.equal(pairings.at(-1).used_at,null);
  feature=false;await rejects(()=>service.redeem(replacement.pairing_code),"FEATURE_DISABLED");feature=true;
  pairings.at(-1).expires_at=new Date(0);await rejects(()=>service.redeem(replacement.pairing_code),"PAIRING_INVALID");
  await rejects(()=>service.redeem("synthetic-invalid"),"PAIRING_INVALID");
  await rejects(()=>service.create({...req,body:{nama_device:"no unit"}}),"UNIT_REQUIRED");
  await assert.rejects(()=>service.create({...req,body:{unit_id:999,nama_device:"spoof"}}),e=>e.status===403);
  await rejects(()=>service.reissue({...target,tenantId:902}),"DEVICE_NOT_FOUND");
  const listed=await service.list(req);assert(!JSON.stringify(listed).includes(oldHash));
  console.log("PASS pairing: hash-only verifier, bcrypt12, one-time replay rejection, expiry, feature guard, unit-required/spoof/cross-tenant, transaction rollback, audit/no credential response leakage (synthetic ONLY)");
})().catch(e=>{console.error("FAIL pairing",e.code || e.name);process.exitCode=1;});
