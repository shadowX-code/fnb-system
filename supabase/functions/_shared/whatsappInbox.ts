/** WhatsApp wire contracts only. No credentials, customer linking, model calls or sends. */
export type WhatsAppInboxEvent = {
 channel:'whatsapp'; account_id:string; waba_id:string; peer_id:string;
 kind:'incoming'|'attachment'|'echo'|'status'|'edit'|'revoke'; event_id:string;
 occurred_at:string; body:string; medium:'dm';
 target_message_id?:string; target_direction?:'incoming'|'outgoing';
 provider_status?:'sent'|'delivered'|'read'|'failed'; error_code?:string;
};
const numeric=(v:unknown):v is string=>typeof v==='string'&&/^\d{1,32}$/.test(v);
const messageId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9._=+\/-]{1,300}$/.test(v);
function timestamp(v:unknown,now:number){
 if(typeof v!=='string'||!/^\d{1,12}$/.test(v))throw new Error('invalid_whatsapp_timestamp');
 const ms=Number(v)*1000;
 if(!Number.isSafeInteger(ms)||ms<=0||ms>now+300000)throw new Error('invalid_whatsapp_timestamp');
 return new Date(ms).toISOString();
}
function list(v:unknown):any[]{
 if(v===undefined)return [];
 if(!Array.isArray(v)||v.length>1000)throw new Error('invalid_whatsapp_batch');
 return v;
}
/** Envelope limits remain fail-closed; individual entries/changes have independent trust boundaries. */
export function whatsappChanges(payload:any,reject:()=>void=()=>{}){
 if(payload?.object!=='whatsapp_business_account'||!Array.isArray(payload.entry))throw new Error('invalid_whatsapp_webhook');
 const changes:{entry:any;change:any}[]=[];
 for(const entry of list(payload.entry)){
  if(!numeric(entry?.id)){reject();continue;}
  let rows;try{rows=list(entry.changes);}catch{reject();continue;}
  for(const change of rows){
   if(!change||typeof change!=='object'){reject();continue;}
   changes.push({entry,change});
   if(changes.length>1000)throw new Error('invalid_whatsapp_batch');
  }
 }
 return changes;
}
function content(m:any){
 if(m?.type==='text'){
  if(typeof m.text?.body!=='string'||m.text.body.length>8000)throw new Error('invalid_whatsapp_text');
  return m.text.body;
 }
 if(['image','audio','video','document','sticker','location','contacts','interactive','button','reaction','unsupported'].includes(m?.type))return `[WhatsApp ${m.type}]`;
 throw new Error('unsupported_whatsapp_message');
}
export function normalizeWhatsAppWebhook(payload:any,now=Date.now(),reject:()=>void=()=>{}):WhatsAppInboxEvent[]{
 const events:WhatsAppInboxEvent[]=[];
 for(const {entry,change} of whatsappChanges(payload,reject)){
  if(!['messages','smb_message_echoes'].includes(change.field))continue;
  const value=change.value;
  if(value?.messaging_product!=='whatsapp'||!numeric(value?.metadata?.phone_number_id)){reject();continue;}
  const base={channel:'whatsapp' as const,account_id:value.metadata.phone_number_id,waba_id:entry.id,medium:'dm' as const};
  const echo=change.field==='smb_message_echoes';
  let messages:any[]=[],statuses:any[]=[];
  try{messages=list(echo?value.message_echoes:value.messages);}catch{reject();}
  if(!echo)try{statuses=list(value.statuses);}catch{reject();}
  for(const m of messages)try{
   const peer=echo?m?.to:m?.from;
   if(!numeric(peer)||!messageId(m?.id))throw new Error('invalid_whatsapp_message');
   const identity={...base,peer_id:peer,event_id:m.id,occurred_at:timestamp(m.timestamp,now)};
   if(['edit','revoke'].includes(m.type)){
    const target=m[m.type]?.original_message_id;
    if(!messageId(target))throw new Error('invalid_whatsapp_target');
    events.push({...identity,kind:m.type,target_message_id:target,target_direction:echo?'outgoing':'incoming',body:m.type==='edit'?content(m.edit.message):''});
   }else events.push({...identity,kind:echo?'echo':m.type==='text'?'incoming':'attachment',body:content(m)});
  }catch{reject();}
  for(const s of statuses)try{
   if(!messageId(s?.id)||!numeric(s?.recipient_id)||!['sent','delivered','read','failed'].includes(s?.status))throw new Error('invalid_whatsapp_status');
   const code=s.errors?.[0]?.code;
   if(code!==undefined&&!/^\d{1,12}$/.test(String(code)))throw new Error('invalid_whatsapp_error');
   events.push({...base,peer_id:s.recipient_id,kind:'status',event_id:s.id,occurred_at:timestamp(s.timestamp,now),body:'',provider_status:s.status,...(code===undefined?{}:{error_code:String(code)})});
  }catch{reject();}
  if(events.length>1000)throw new Error('invalid_whatsapp_batch');
 }
 return events;
}
export const whatsappConnectorContract=Object.freeze({
 channel:'whatsapp',onboarding_enabled:false,sending_enabled:false,ai_enabled:false,
 webhook_fields:['messages','smb_message_echoes'],history_import_enabled:false,
 required_permissions:['whatsapp_business_management','whatsapp_business_messaging'],
});
