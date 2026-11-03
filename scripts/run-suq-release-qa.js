'use strict';
require('fs').mkdirSync(require('path').resolve(__dirname,'../.tmp'),{recursive:true});
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto');
const {createRequire}=require('module'),pg=require('pg');
const target='suq_production_rc_ac8c7ae9d4_test';
const staged=path.resolve(__dirname,'..');
const legacy=__dirname;
const role='suq_clone_runtime_7d4e9e147f';
const opt={host:'127.0.0.1',port:55439,database:target,user:'kp_acceptance',password:()=>'',ssl:false};
const quote=x=>'"'+x.replaceAll('"','""')+'"';
const report={clone:target,productionChanged:false,tests:[],status:'NOT_RUN',role};
const suffix=process.env.SUQ_TEST_REPORT_SUFFIX||'';assert(/^[a-z0-9-]*$/.test(suffix));
let phase='identity';
async function identity(c){assert.deepEqual((await c.query('SELECT current_database() db,host(inet_server_addr()) host,inet_server_port() port')).rows[0],{db:target,host:'127.0.0.1',port:55439});}
async function fingerprint(c){const result={};const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;for(const {tablename}of tables)result[tablename]=(await c.query('SELECT count(*)::text count,md5(coalesce(string_agg(row_to_json(t)::text,\'\' ORDER BY row_to_json(t)::text),\'\')) hash FROM public.'+quote(tablename)+' t')).rows[0];return result;}
async function runSuite(name){
 const realFile=path.join(legacy,name),virtualFile=path.join(staged,'scripts',name),native=createRequire(virtualFile);
 let ended,primary;const done=new Promise(r=>ended=r);let fixtures=false;
 class BoundPool extends pg.Pool{
  constructor(o){assert.equal(o.host,'127.0.0.1');assert.equal(o.port,55439);assert.equal(o.database,target);assert.equal(o.user,'kp_acceptance');super({...o,password:()=>'',ssl:false});if(!primary)primary=this;}
  async connect(...args){const c=await super.connect(...args);await identity(c);const original=c.query.bind(c);c.query=async(sql,...values)=>{let v;try{v=await original(sql,...values);}catch(e){report.dbFailure={code:e.code,object:(String(e.message).match(/permission denied for (?:table|sequence|schema) [a-z0-9_]+/i)||[])[0]};throw e;}if(!fixtures&&typeof sql==='string'&&sql.trim()==='BEGIN'){fixtures=true;await original('INSERT INTO tenants(id,slug,nama,status,billing_status) VALUES(2,$1,\'Rollback clone tenant\',\'active\',\'active\') ON CONFLICT(id) DO NOTHING',['suq-fixture-'+crypto.randomBytes(5).toString('hex')]);}return v;};return c;}
  end(...args){const r=super.end(...args);if(this===primary)r.then(ended,ended);return r;}
 }
 function scoped(n){if(n==='__suq_runtime_check')return ()=>{report.runtimeTransactions++;};return n==='pg'?{...pg,Pool:BoundPool}:native(n);}
 scoped.resolve=native.resolve;scoped.cache=require.cache;
 let code=fs.readFileSync(realFile,'utf8').replaceAll('pos_business_v2_test',target).replaceAll('pos_test_owner','kp_acceptance').replaceAll('pos_business_v2_fixture_runtime',role);
 // Actual production has bigint membership id / integer santri_id. The old
 // fixture reused one untyped parameter for both, which PostgreSQL rejects.
 code=code.replace("VALUES($1,1,$1,2,'active')","VALUES($1::bigint,1,$1::integer,2,'active')");
 code=code.replace("stack.push(save);return client.query('SAVEPOINT '+save);", "stack.push(save);await client.query('SAVEPOINT '+save);await client.query('SET LOCAL ROLE "+role+"');require('__suq_runtime_check')();return;");
 code=code.replace("if(command==='COMMIT')return client.query('RELEASE SAVEPOINT '+stack.pop());", "if(command==='COMMIT'){await client.query('RESET ROLE');return client.query('RELEASE SAVEPOINT '+stack.pop());}");
 code=code.replaceAll("return client.query('RELEASE SAVEPOINT '+stack.pop());", "await client.query('RESET ROLE');return client.query('RELEASE SAVEPOINT '+stack.pop());");
 // Never log failing SQL/data from a production-derived clone.
 code=code.replace("console.error('QUERY',sql)","console.error('QUERY_FAILED_DETAILS_SUPPRESSED')");
 code=code.replaceAll("console.error('ASSERT',e.actual,e.expected)","console.error('ASSERT_DETAILS_SUPPRESSED')");
 const m={exports:{}};const logs=[];const realLog=console.log,realError=console.error;
 console.log=(...a)=>{const s=a.map(String).join(' ');if(s.startsWith('PASS ')||s.includes('FINGERPRINT UNCHANGED')){logs.push(s);realLog(s);}};
 console.error=(...a)=>{const s=a.map(String).join(' ');if(s.startsWith('FAIL'))realError('SUITE_FAILURE '+name+' '+String(a[1]||''));};
 try{vm.runInThisContext(require('module').wrap(code),{filename:virtualFile})(m.exports,scoped,m,virtualFile,path.dirname(virtualFile));await done;assert(!process.exitCode,'SUITE_FAILED');report.tests.push({name,status:'PASS',checks:logs.filter(x=>x.startsWith('PASS ')).length-1,rollbackFingerprint:logs.some(x=>x.includes('FINGERPRINT UNCHANGED'))});}
 finally{console.log=realLog;console.error=realError;}
}
(async()=>{
 const c=new pg.Client(opt);await c.connect();let before;
 try{await identity(c);assert.equal((await c.query('SELECT count(*)::int n FROM public.schema_migrations')).rows[0].n,88);
  report.requiredSantriColumns=(await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='santri' AND table_schema='public' AND is_nullable='NO' AND column_default IS NULL")).rows.map(x=>x.column_name);
  report.prerequisites=(await c.query('SELECT EXISTS(SELECT 1 FROM tenants WHERE id=1) tenant1,EXISTS(SELECT 1 FROM unit_pendidikan WHERE id=2 AND tenant_id=1) unit2')).rows[0];assert(report.prerequisites.tenant1&&report.prerequisites.unit2,'FIXTURE_PREREQUISITE_MISSING');
  report.runtimeTransactions=0;
  before=await fingerprint(c);
 }finally{await c.end();}
 const suites=process.env.SUQ_TEST_ONLY==='finance'?['test-pos-finance-db.js']:['test-suq-ws4-operations-db.js','test-pos-finance-db.js'];
 for(const name of suites){phase=name;await runSuite(name);}
 phase='all-table-integrity';const check=new pg.Client(opt);await check.connect();try{await identity(check);assert.deepEqual(await fingerprint(check),before,'CLONE_ROWS_CHANGED');report.allTableFingerprints='UNCHANGED';}finally{await check.end();}
 report.status='PASS';
})().catch(e=>{report.status='BLOCKED';report.failure={phase,code:e.code||e.name,table:e.table,column:e.column,constraint:e.constraint,detailsSuppressed:true};process.exitCode=1;}).finally(()=>{fs.writeFileSync(path.join(staged,'.tmp','suq-rc-financial-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
