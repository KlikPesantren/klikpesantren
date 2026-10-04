// Real production router/controller, synthetic authenticated middleware context.
const assert=require('node:assert/strict'),express=require('express');
function stub(name,value){const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports:value};}
let mutations=0;
stub('../db',{query:async()=>({rows:[]})});
stub('../services/deviceManagementService',{
  rename:async req=>{mutations++;return {device_id:req.params.deviceId,nama_device:req.body.nama_device};},
  remove:async req=>{mutations++;return {deleted:true};},
});
stub('../middleware/authMiddleware',(req,res,next)=>{
  const role=req.headers.authorization?.replace('Bearer synthetic-','');
  if(!['admin','reader'].includes(role))return res.status(401).json({code:'UNAUTHORIZED'});
  req.user={id:11,role};req.tenantId=901;next();
});
stub('../middleware/tenantMiddleware',(req,res,next)=>next());
stub('../middleware/requireTenantFeature',()=>((req,res,next)=>req.headers['x-test-feature']==='off'?res.status(403).json({code:'FEATURE_DISABLED'}):next()));
const permission=key=>(req,res,next)=>req.user.role==='admin'?next():res.status(403).json({code:'FORBIDDEN'});
permission.requireAnyPermission=()=>permission('view');stub('../middleware/requirePermission',permission);
const app=express();app.use(express.json());app.use('/rfid/device',require('../routes/rfidDeviceRoutes'));
(async()=>{const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const origin=`http://127.0.0.1:${server.address().port}`;
    for(const [method,path] of [['PATCH','/SYNTHETIC/name'],['DELETE','/SYNTHETIC']]){
      for(const [token,status,feature] of [[null,401],['reader',403],['admin',403,'off'],['admin',200]]){
        const before=mutations;
        const r=await fetch(origin+'/rfid/device'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer synthetic-'+token}:{}),...(feature?{'x-test-feature':feature}:{})},body:JSON.stringify({unit_id:2,nama_device:'Synthetic'})});
        assert.equal(r.status,status);assert.equal(mutations-before,status===200?1:0);
        if(status===200){assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('pragma'),'no-cache');}
      }
    }
    console.log('PASS real router/controller localhost: unauthenticated 401, non-manager 403, feature-off 403, manager 200, mutations unreachable on rejection, no-store/no-cache response. Synthetic contexts ONLY; unit/tenant SQL tested separately.');
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error({status:'FAIL',error:e.name});process.exitCode=1;});
