const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const {verifyWalletPreview}=require('../src/walletPreview.cjs'),{nfcFailureCode}=require('../src/nfcFeedback.cjs');
test('Wallet preview preserves HTTP rejection code and never commits rejected/stale/unit-mismatched data',async()=>{
 let commits=0,current=true,resolve;const args={scan:{credential_method:'RFID',credential:'00aabbcc'},unit_id:2,isCurrent:()=>current,commit:()=>commits++};
 await assert.rejects(verifyWalletPreview({...args,request:async()=>{throw Object.assign(Error('NO'),{status:403,code:'CREDENTIAL_DISABLED'});}}),e=>e.code==='CREDENTIAL_DISABLED');
 const pending=verifyWalletPreview({...args,request:()=>new Promise(r=>resolve=r)});current=false;resolve({eligible:true,unit_id:2,available_balance:'1000'});await assert.rejects(pending,e=>e.code==='WALLET_PREVIEW_STALE');
 current=true;await assert.rejects(verifyWalletPreview({...args,request:async()=>({eligible:true,unit_id:3,available_balance:'1000'})}),e=>e.code==='INVALID_WALLET_PREVIEW');assert.equal(commits,0);
});
test('offline preview fails closed; valid explicit-unit preview commits once with no debit request',async()=>{
 const {createBusinessWalletContract}=require('../src/businessWallet.cjs');let calls=0;const api=async()=>{calls++;throw Object.assign(Error('OFFLINE'),{code:'NETWORK'});};await assert.rejects(verifyWalletPreview({request:api,scan:{},unit_id:2,commit:()=>assert.fail()}),e=>e.code==='NETWORK');assert.equal(calls,1);
 const paths=[],patches=[];await verifyWalletPreview({unit_id:2,scan:{credential_method:'RFID',credential:'00aabbcc'},request:async(p)=>{paths.push(p);return{eligible:true,unit_id:2,available_balance:'1000'};},commit:p=>patches.push(p)});assert.deepEqual(paths,['/wallet/preview']);assert.equal(patches.length,1);assert.equal(typeof createBusinessWalletContract,'function');
});
function scanner(overrides={},onScan=async()=>({eligible:true})){
 const sdk=process.env.POS_EXPO_SDK_ROOT||'C:/sqpromo7/node_modules/expo',native=createRequire(path.join(sdk,'package.json')),babel=native('@babel/core');
 let slots=[],index=0,pending=[],tree,background,cleared=0;const effects=[],timers=new Set(),calls={request:0,cancel:0};
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'Fragment'};
 const useState=initial=>{const n=index++;if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial;return[slots[n],v=>slots[n]=typeof v==='function'?v(slots[n]):v];};
 const memo=(fn,deps)=>{const n=index++;if(!slots[n]||deps.some((v,i)=>!Object.is(v,slots[n].deps[i])))slots[n]={deps,value:fn()};return slots[n].value;};
 const useEffect=(fn,deps)=>{const n=index++;if(!effects[n]||deps.some((v,i)=>!Object.is(v,effects[n].deps[i]))){pending.push(()=>{effects[n]?.cleanup?.();effects[n]={deps,cleanup:fn()};});}};
 const manager={start:async()=>{},isSupported:async()=>true,isEnabled:async()=>true,requestTechnology:async()=>{calls.request++;},getTag:async()=>({id:'00AABBCC'}),cancelTechnologyRequest:async()=>{calls.cancel++;},...overrides};
 const props={disabled:false,scanContext:'merchant:unit2',onScan};let code=fs.readFileSync(path.join(__dirname,'../src/WalletCredentialScanner.jsx'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function WalletCredentialScanner','function WalletCredentialScanner').replaceAll('await import("react-native-nfc-manager")','await loadNative()')+';return WalletCredentialScanner;';
 code=babel.transformSync(code,{configFile:false,babelrc:false,plugins:[native.resolve('@babel/plugin-transform-react-jsx')],parserOpts:{allowReturnOutsideFunction:true}}).code;
 const names=['React','useState','useRef','useCallback','useEffect','AppState','Modal','Platform','Pressable','View','CameraView','useCameraPermissions','Text','Button','Icon','colors','s','require','loadNative','setTimeout','clearTimeout'];
 const Component=new Function(...names,code)(React,useState,v=>useState(()=>({current:v}))[0],(fn,deps)=>memo(()=>fn,deps),useEffect,{addEventListener:(_name,fn)=>{background=fn;return{remove(){}};}},'Modal',{OS:'android'},'Pressable','View','CameraView',()=>[{granted:true},async()=>({granted:true})],'Text','Button','Icon',{}, {},createRequire(path.join(__dirname,'../src/WalletCredentialScanner.jsx')),async()=>({default:manager,NfcTech:{NfcA:'NfcA'}}),fn=>{const t={fn};timers.add(t);return t;},t=>{if(timers.delete(t))cleared++;});
 function render(){index=0;tree=Component(props);const work=pending;pending=[];work.forEach(fn=>fn());return tree;}
 function nodes(type){const all=[];const walk=n=>{if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;if(n.type==='Modal'&&!n.props.visible)return;if(n.type===type)all.push(n);walk(n.props.children);};walk(tree);return all;}
 const button=title=>{const n=nodes('Button').find(n=>n.props.title===title);assert(n,'missing '+title);return n.props;};
 const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
 render();return{render,flush,button,nodes,props,calls,timers,get cleared(){return cleared;},background:()=>background('background'),unmount:()=>effects.forEach(e=>e?.cleanup?.())};
}
test('actual NFC handler preserves UID bytes, verifies online and clears native request/timeout',async()=>{
 const scans=[],ui=scanner({},async(scan,current)=>{assert(current());scans.push(scan);});await ui.flush();ui.render();await ui.button('Baca NFC').onPress();ui.render();assert.equal(scans[0].credential,'00aabbcc');assert.equal(ui.calls.cancel,1);assert.equal(ui.timers.size,0);assert.equal(ui.cleared,1);
});
test('cancel during native setup cannot register a late listener',async()=>{
 let release;const ui=scanner({start:()=>new Promise(r=>release=r)});await ui.flush();ui.render();const pending=ui.button('Baca NFC').onPress();await ui.flush();ui.render();await ui.button('Batalkan NFC').onPress();release();await pending;assert.equal(ui.calls.request,0);
});
test('cancel during getTag ignores old tag and cannot cancel a subsequent scan',async()=>{
 let release,read=0,scans=0;const ui=scanner({getTag:()=>++read===1?new Promise(r=>release=r):Promise.resolve({id:'00AABBCC'})},async()=>scans++);await ui.flush();ui.render();const old=ui.button('Baca NFC').onPress();await ui.flush();ui.render();await ui.button('Batalkan NFC').onPress();ui.render();await ui.button('Baca NFC').onPress();const count=ui.calls.cancel;release({id:'00FFEEDD'});await old;assert.equal(scans,1);assert.equal(ui.calls.cancel,count);
});
test('disabled/unit change cancels native read and background cleanup removes active request',async()=>{
 let release;const ui=scanner({requestTechnology:()=>new Promise(r=>release=r)});await ui.flush();ui.render();const pending=ui.button('Baca NFC').onPress();await ui.flush();ui.props.disabled=true;ui.props.scanContext='other-unit';ui.render();await ui.flush();release();await pending;ui.render();assert.equal(ui.button('Baca NFC').disabled,true);assert.equal(ui.calls.cancel,1);ui.background();await ui.flush();ui.unmount();
});
test('timeout, unsupported tag, unknown/revoked credential and server error keep distinct feedback',async()=>{
 for(const code of ['NFC_TIMEOUT','UNSUPPORTED_NFC_TAG','UNKNOWN_CREDENTIAL','CREDENTIAL_DISABLED','WALLET_NOT_ACTIVE','NETWORK_TIMEOUT','POS_INTERNAL_ERROR'])assert.equal(nfcFailureCode({code},'PREVIEW'),code);
 let resolve;const ui=scanner({requestTechnology:()=>new Promise(r=>resolve=r)});await ui.flush();ui.render();const pending=ui.button('Baca NFC').onPress();await ui.flush();[...ui.timers][0].fn();await pending;resolve();assert.equal(ui.calls.cancel,1);assert.equal(ui.timers.size,0);
});

test("queued rescan cannot register after context is disabled during cleanup",async()=>{let readRelease,cancelRelease,requests=0;const ui=scanner({requestTechnology:()=>++requests===1?new Promise(r=>readRelease=r):Promise.resolve(),cancelTechnologyRequest:()=>new Promise(r=>cancelRelease=r)});await ui.flush();ui.render();const start=ui.button("Baca NFC").onPress,first=start();await ui.flush();ui.render();const cancel=ui.button("Batalkan NFC").onPress();await ui.flush();const queued=start();ui.props.disabled=true;ui.props.scanContext="changed";ui.render();await ui.flush();cancelRelease();await cancel;await queued;readRelease();await first;assert.equal(requests,1);});
