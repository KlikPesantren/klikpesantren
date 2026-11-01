const assert=require('node:assert/strict');
const stub=(name,exports)=>{const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};};
let idleSql=0;
stub('../db',{connect:async()=>({release(){},query:async()=>{idleSql++;return {rows:[]};}}),query:async()=>{idleSql++;return {rows:[]};}});
stub('../services/tenantFeatureService',{isFeatureEnabled:async()=>true});
stub('../services/attendanceCoreService',{resolveOccurrence:async()=>{throw Error('Unexpected fixture access');},closeOccurrence:async()=>{throw Error('Unexpected fixture access');}});
const auto=require('../services/attendanceAutoAlfaService');
const flush=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
class Clock {
 constructor(){this.time=0;this.next=0;this.timers=new Map();}
 set=(fn,ms)=>{const id=++this.next;this.timers.set(id,{fn,at:this.time+ms});return id;};
 clear=id=>this.timers.delete(id);
 async advance(ms){const end=this.time+ms;let steps=0;while(true){const entry=[...this.timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry||entry[1].at>end)break;assert(++steps<2000,'unbounded timer loop');this.time=entry[1].at;this.timers.delete(entry[0]);entry[1].fn();await flush();}this.time=end;await flush();}
 nextAt(){return [...this.timers.values()].sort((a,b)=>a.at-b.at)[0]?.at;}
}
let checks=0;const check=(v,msg)=>{assert(v,msg);checks++;};
function setup(enforce,nextDeadline){const c=new Clock(),events=[];return {c,events,s:auto.createAutoAlfaScheduler({enforce:()=>enforce(c),nextDeadline:()=>nextDeadline(c),now:()=>c.time,setTimer:c.set,clearTimer:c.clear,logger:{info:(...args)=>events.push(args),error:(...args)=>events.push(args)}})};}
(async()=>{
 let calls=0,deadlines=0;
 const normal=setup(async()=>{calls++;return {closed:0};},async c=>{deadlines++;return new Date(c.time+10_000);});normal.s.start();await flush();check(normal.c.nextAt()===11_500,'deadline plus grace');await normal.c.advance(11_499);check(calls===1,'never close early');await normal.c.advance(1);check(calls===2,'deadline executes');normal.s.stop();check(!normal.c.timers.size,'stop removes timer');
 calls=0;deadlines=0;const idle=setup(async()=>{calls++;return {closed:0};},async()=>{deadlines++;return null;});idle.s.start();await flush();await idle.c.advance(86_400_000);check(calls===1&&deadlines===1&&!idle.c.timers.size,'zero idle SQL polling for no deadline');idle.s.reschedule();await flush();check(calls===2,'schedule creation wakes idle scheduler');idle.s.stop();
 calls=0;deadlines=0;let unavailable=true;
 const failure=setup(async()=>{calls++;if(unavailable)throw Object.assign(Error('password=DO_NOT_LOG'),{code:'53000'});return {closed:0};},async c=>{deadlines++;return new Date(c.time+60_000);});failure.s.start();await flush();check(failure.c.nextAt()===300_000,'first retry five minutes');for(let i=0;i<100;i++)failure.s.reschedule();await flush();check(calls===1,'reschedule cannot bypass outage cooldown');await failure.c.advance(86_400_000);check(calls===27&&deadlines===0,'24h continuous failure has 27 attempts, not 288');check(!JSON.stringify(failure.events).includes('DO_NOT_LOG'),'no raw errors or credentials logged');check(failure.events.some(e=>String(e[1]).includes('insufficient_resources')),'resource error category is explicit, not successful work');unavailable=false;await failure.c.advance(failure.c.nextAt()-failure.c.time);check(deadlines===1,'recovery re-arms business deadline');unavailable=true;await failure.c.advance(failure.c.nextAt()-failure.c.time);check(failure.c.nextAt()-failure.c.time===300_000,'success resets failure backoff');failure.s.stop();
 calls=0;const partial=setup(async()=>{calls++;return calls===1?{closed:0,failed:[{code:'AMBIGUOUS_SESSION_WINDOW'}]}:{closed:1};},async c=>new Date(c.time+10_000));partial.s.start();await flush();check(partial.c.nextAt()===11_500,'failed candidate does not delay another tenant deadline');await partial.c.advance(11_500);check(calls===2,'other tenant completes before candidate retry');partial.s.stop();
 let finish;calls=0;const busy=setup(()=>{calls++;return new Promise(resolve=>{finish=resolve;});},async()=>null);busy.s.start();await flush();busy.s.reschedule();busy.s.reschedule();check(calls===1,'in-process overlap is coalesced');finish({closed:0});await flush();check(calls===2,'one pending schedule change is replayed');busy.s.stop();finish({closed:0});await flush();check(!busy.c.timers.size,'stop during in-flight run does not resurrect timer');
 const invalid=setup(async()=>({closed:0}),async()=>new Date('invalid'));invalid.s.start();await flush();check(invalid.c.nextAt()===300_000,'invalid deadline retries safely, never tight-loop');invalid.s.stop();
 const first=auto.startAutoAlfa();await flush();first.stop();const before=idleSql;check(auto.startAutoAlfa()===first,'singleton handle retained');await flush();check(idleSql===before+2,'stopped singleton restarts rather than silently remaining stopped');first.stop();
 console.log(JSON.stringify({status:'PASS',checks,simulation:{idle24hRuns:1,outage24hAttempts:27,previousFixedFiveMinuteAttempts:288},realNeonQueries:0}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
