import {hash,seal} from './metaSecurity.ts';
/** Signed sync payloads are quarantined, never live conversation, CRM or consent input. */
export async function whatsappLifecycle(payload:any,key:string,now=Date.now()){
 const result:any[]=[];
 for(const entry of payload.entry||[])for(const change of entry.changes||[]){
  if(!['account_update','history','smb_app_state_sync'].includes(change.field))continue;
  if(!/^\d{1,32}$/.test(entry.id))throw new Error('invalid_lifecycle_waba');
  const value=change.value;if(!value||typeof value!=='object')throw new Error('invalid_lifecycle_value');
  const phone=value.metadata?.phone_number_id;
  if(change.field!=='account_update'&&(typeof phone!=='string'||!/^\d{1,32}$/.test(phone)))throw new Error('invalid_lifecycle_phone');
  const ts=entry.time===undefined?now:Number(entry.time)*1000;
  if(!Number.isFinite(ts)||ts<=0||ts>now+300000)throw new Error('invalid_lifecycle_time');
  const fingerprint=await hash(JSON.stringify({waba:entry.id,change}));
  let progress=0,declined=false;
  if(change.field==='history'){
   if(!Array.isArray(value.history)||value.history.length>1000)throw new Error('invalid_history');
   for(const h of value.history){
    const p=h.metadata?.progress;
    if(p!==undefined&&(!Number.isInteger(p)||p<0||p>100))throw new Error('invalid_history_progress');
    progress=Math.max(progress,p||0);
    if(h.errors?.some((e:any)=>e.code===2593109))declined=true;
   }
   if(value.errors?.some((e:any)=>e.code===2593109))declined=true;
  }
  result.push({waba_id:entry.id,phone_id:phone||null,field:change.field,hash:fingerprint,occurred_at:new Date(ts).toISOString(),
   event:['PARTNER_REMOVED','ACCOUNT_OFFBOARDED','ACCOUNT_RECONNECTED'].includes(value.event)?value.event:null,
   ...(change.field==='history'?{progress,declined}:{}),
   ...(change.field==='account_update'?{}:{sealed_payload:await seal(change,key,`whatsapp-sync:${entry.id}:${phone}:${fingerprint}`)})});
 }
 if(result.length>1000)throw new Error('invalid_lifecycle_batch');return result;
}
