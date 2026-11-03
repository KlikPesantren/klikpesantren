async function verifyWalletPreview({request,scan,unit_id,isCurrent=()=>true,commit}){
 if(!unit_id)throw Object.assign(Error('UNIT_REQUIRED'),{code:'UNIT_REQUIRED'});
 if(!isCurrent())throw Object.assign(Error('WALLET_PREVIEW_STALE'),{code:'WALLET_PREVIEW_STALE'});
 const preview=await request('/wallet/preview',{method:'POST',body:{...scan,unit_id}});
 if(!isCurrent())throw Object.assign(Error('WALLET_PREVIEW_STALE'),{code:'WALLET_PREVIEW_STALE'});
 if(!preview?.eligible||String(preview.unit_id)!==String(unit_id)||!/^\d+$/.test(String(preview.available_balance)))throw Object.assign(Error('INVALID_WALLET_PREVIEW'),{code:'INVALID_WALLET_PREVIEW'});
 commit({...scan,unit_id,wallet_preview:preview});return preview;
}
module.exports={verifyWalletPreview};
