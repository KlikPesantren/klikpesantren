const assert=require('node:assert/strict');
const fs=require('node:fs');
let device,backup,audits,referenced=false,unknown=0,fail=false;
const db={release(){},async query(text,p=[]){
  const sql=text.replace(/\s+/g,' ').trim();
  if(sql==='BEGIN'){backup=structuredClone({device,audits});return {rows:[]};}
  if(sql==='COMMIT')return {rows:[]};
  if(sql==='ROLLBACK'){({device,audits}=backup);return {rows:[]};}
  if(sql.startsWith('SELECT id,device_id'))return {rows:device&&device.tenant_id===p[0]&&device.device_id===p[1]?[{...device}]:[]};
  if(sql.startsWith('UPDATE devices SET nama_device')){device.nama_device=p[2];return {rows:[Object.fromEntries(Object.entries(device).filter(([k])=>!k.includes('secret')&&k!=='deletion_candidate'))]};}
  if(sql.startsWith('INSERT INTO audit_logs')){if(fail)throw Error('synthetic failure');audits.push(p);return {rows:[]};}
  if(sql.startsWith('SELECT EXISTS'))return {rows:[{referenced}]};
  if(sql.startsWith('SELECT count'))return {rows:[{n:unknown}]};
  if(sql.startsWith('DELETE FROM devices')){if(fail)throw Error('synthetic failure');device=null;return {rows:[{}],rowCount:1};}
  throw Error('Unexpected synthetic query');
}};
function stub(name,value){const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports:value};}
stub('../db',{connect:async()=>db});
stub('../services/unitAccessService',{
  accessError:(message,status=403,code='UNIT_ACCESS_DENIED')=>Object.assign(Error(message),{status,code}),
  resolveActiveUnit:async req=>{
    if(req.body?.unit_id===99)throw Object.assign(Error('denied'),{status:403});
    return {mode:req.body?.unit_id?'UNIT':'ALL',unitId:req.body?.unit_id,tenantId:req.tenantId};
  },
});
const service=require('../services/deviceManagementService');
const original={id:1,tenant_id:901,unit_id:2,device_id:'SYNTHETIC-DEVICE',nama_device:'Original',enabled:false,deletion_candidate:true,attendance_mode:'ATTENDANCE',device_secret_hash:null};
const req={tenantId:901,user:{id:11},params:{deviceId:original.device_id},body:{unit_id:2,nama_device:'  Baru  ',confirmation:'DELETE',confirmation_device_id:original.device_id}};
function reset(){device=structuredClone(original);audits=[];referenced=false;unknown=0;fail=false;}
(async()=>{
  reset();const before=structuredClone(device);const renamed=await service.rename(req);assert.equal(renamed.nama_device,'Baru');
  delete before.nama_device;const after={...device};delete after.nama_device;assert.deepEqual(after,before);assert(!JSON.stringify(renamed).includes('secret'));
  for(const nama_device of ['', '   ', 'x'.repeat(81),12])await assert.rejects(()=>service.rename({...req,body:{unit_id:2,nama_device}}),e=>e.status===400);
  await assert.rejects(()=>service.rename({...req,body:{...req.body,unit_id:99}}),e=>e.status===403);
  await assert.rejects(()=>service.rename({...req,tenantId:902}),e=>e.status===404);
  await assert.rejects(()=>service.rename({...req,body:{nama_device:'A'}}),e=>e.code==='UNIT_REQUIRED');
  reset();device.unit_id=3;await assert.rejects(()=>service.rename(req),e=>e.status===403);
  reset();fail=true;await assert.rejects(()=>service.rename(req));assert.equal(device.nama_device,'Original');assert.equal(audits.length,0);
  reset();await service.remove(req);assert.equal(device,null);assert.equal(audits.length,1);
  for(const reason of ['reference','legacy','unknown FK']){reset();if(reason==='reference')referenced=true;else if(reason==='legacy')device.deletion_candidate=false;else unknown=1;await assert.rejects(()=>service.remove(req),e=>e.status===409);assert(device);assert.equal(audits.length,0);}
  reset();await assert.rejects(()=>service.remove({...req,body:{...req.body,confirmation_device_id:'OTHER'}}),e=>e.status===400);assert(device);
  const source=fs.readFileSync(require.resolve('../services/deviceManagementService'),'utf8');
  for(const table of ['attendance_events','wallet_transactions','transaksi_rfid','rfid_sync_queue','attendance_device_pairings','audit_logs'])assert(source.includes(`FROM ${table}`));
  assert(source.includes('FOR UPDATE'));assert(source.includes("device_secret='__UNPAIRED__'"));assert(source.includes('last_authenticated_at IS NULL'));
  assert.equal((source.match(/DELETE FROM/g)||[]).length,1);assert(!/DELETE FROM (attendance|wallet|audit|transaksi|rfid_)/.test(source));
  const routes=fs.readFileSync(require.resolve('../routes/rfidDeviceRoutes'),'utf8');
  assert(routes.includes('requireTenantFeature("rfid"),requirePermission("rfid.manage")'));
  assert(routes.includes('router.patch("/:deviceId/name", ...manageDevice, pairing.rename)'));
  assert(routes.includes('router.delete("/:deviceId", ...manageDevice, pairing.remove)'));
  const side=fs.readFileSync('frontend/src/components/Sidebar.jsx','utf8');assert.equal((side.match(/path: "\/rfid-devices"/g)||[]).length,1);
  assert(side.match(/id: "sistem"[\s\S]*?items: \[([^\]]*)\]/)[1].includes('"Perangkat"'));
  assert(!side.match(/id: "keuangan"[\s\S]*?items: \[([^\]]*)\]/)[1].includes('"Perangkat"'));
  console.log('PASS device lifecycle: name-only/identity preserved, validation, unit/tenant rejection, rollback, conservative unused delete, historical/unknown FK rejection, references protected, navigation/route guard static checks (synthetic only)');
})().catch(e=>{console.error({status:'FAIL',error:e.name,assertion:e.message,stack:e.stack});process.exitCode=1;});
