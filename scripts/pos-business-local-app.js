// Explicit LOCAL composition; never imports .env/db or opens a production target.
const express=require('express');
const {createPosBusinessService}=require('../services/posBusinessService');
const {createPosBusinessRouter}=require('../routes/posBusinessRoutes');
const {createPosStorefrontRouter}=require('../routes/posStorefrontRoutes');
async function createLocalPosApp(db){
 const i=(await db.query('SELECT current_database() db,current_user,host(inet_server_addr()) host,inet_server_port() port')).rows[0];
 if(i.db!=='pos_business_v2_test'||i.current_user!=='pos_test_owner'||i.host!=='127.0.0.1'||i.port!==55439)throw Error('LOCAL_DATABASE_REQUIRED');
 const app=express(),service=createPosBusinessService({db});
 app.use((req,res,next)=>{const origin=req.headers.origin;
  if(origin&&/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)){
   res.set({'Access-Control-Allow-Origin':origin,Vary:'Origin','Access-Control-Allow-Headers':'Content-Type,Authorization,X-Order-Access,X-Customer-Access','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});
  }if(req.method==='OPTIONS')return res.sendStatus(204);next();});
 app.get('/health',(_req,res)=>res.json({local:true}));
 app.use('/pos-business',createPosBusinessRouter({db,service}));app.use('/store-api',createPosStorefrontRouter({service}));
 return {app,service};
}
if(require.main===module){
 const {Pool}=require('pg'),db=new Pool({host:'127.0.0.1',port:55439,user:'pos_test_owner',database:'pos_business_v2_test'});
 createLocalPosApp(db).then(({app})=>{const server=app.listen(55440,'127.0.0.1',()=>console.log('Local POS V2 API: http://127.0.0.1:55440'));
  const stop=()=>server.close(()=>db.end());process.on('SIGINT',stop);process.on('SIGTERM',stop);
 }).catch(()=>{console.error('Local POS V2 composition refused');db.end();process.exitCode=1;});
}
module.exports={createLocalPosApp};
