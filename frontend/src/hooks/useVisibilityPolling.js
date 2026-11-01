import {useEffect,useRef} from 'react';

export default function useVisibilityPolling(load,intervalMs){
  const loadRef=useRef(load);
  useEffect(()=>{
    loadRef.current=load;
  },[load]);
  useEffect(()=>{
    let timer=null,disposed=false,running=false;
    const clear=()=>{if(timer){window.clearTimeout(timer);timer=null;}};
    const schedule=()=>{
      clear();
      if(!disposed&&document.visibilityState==='visible')timer=window.setTimeout(run,intervalMs);
    };
    const run=async()=>{
      if(disposed||running||document.visibilityState!=='visible')return;
      running=true;
      try{await loadRef.current();}finally{running=false;schedule();}
    };
    const onVisibility=()=>{clear();if(document.visibilityState==='visible')void run();};
    document.addEventListener('visibilitychange',onVisibility);
    void run();
    return()=>{disposed=true;clear();document.removeEventListener('visibilitychange',onVisibility);};
  },[intervalMs]);
}
