import {useEffect,useRef,useState} from 'react';
import api from '../services/api';
export function usePosResource(url,params,revision=0){
 const encoded=JSON.stringify(params),key=url+encoded+revision;
 const [state,setState]=useState({key:null,data:null,error:'',loading:true});
 useEffect(()=>{
  const controller=new AbortController();
  api.get(url,{params:JSON.parse(encoded),signal:controller.signal}).then(res=>{
   if(!controller.signal.aborted)setState({key,data:res.data.data,error:'',loading:false});
  }).catch(e=>{if(!controller.signal.aborted)setState({key,data:null,error:e.response?.data?.code||'Gagal memuat POS.',loading:false});});
  return()=>controller.abort();
 },[url,encoded,key]);
 return state.key===key?state:{data:null,error:'',loading:true};
}
export function usePosMutation(onSaved){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const lock=useRef(false),mounted=useRef(false),retry=useRef(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function mutate(method,url,body){
  if(lock.current)return false;
  lock.current=true;setBusy(true);setMessage('');setError('');
  const fingerprint=JSON.stringify([method,url,body]);
  if(url==='/pos/refunds'){
   if(retry.current?.fingerprint!==fingerprint)retry.current={fingerprint,key:crypto.randomUUID()};
   body={...body,request_id:retry.current.key};
  }
  try{const response=await api.request({method,url,data:body});retry.current=null;if(mounted.current){setMessage('Berhasil disimpan.');onSaved?.();}return response.data.data;}
  catch(e){if(mounted.current)setError(e.response?.data?.code||e.message||'Gagal menyimpan.');return false;}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 return {mutate,busy,message,error};
}
