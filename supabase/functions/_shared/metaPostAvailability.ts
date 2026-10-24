import {MetaError,MetaGraph} from './metaGraph.ts';
export type AvailabilityObservation={id:string;state:'available'|'unavailable'|'access_restricted'|'temporarily_unavailable';source:'owned_feed'|'object_read';reason:string;calendar_control_check?:boolean;calendar_control_id?:string;graph_error_code?:number;graph_error_subcode?:number|null};
const idPattern=/^\d{1,30}(?:_\d{1,30})?$/;
// A missing list row is not deletion evidence. Only one known object is probed per
// existing Social Sync turn; this does not enumerate another feed or fetch Insights.
export async function observePostAvailability(graph:MetaGraph,connection:{channel:string;provider_account_id?:string},token:string,posts:{id:string;media_product_type?:string}[],targets:{id:string;require_object_read?:boolean}[],guard:()=>Promise<void>):Promise<AvailabilityObservation[]>{
 const observations:AvailabilityObservation[]=posts.filter(p=>idPattern.test(p.id)&&p.media_product_type!=='STORY').slice(0,2).map(p=>({id:p.id,state:'available',source:'owned_feed',reason:'provider_observed'}));
 const target=targets.slice(0,1).find(t=>idPattern.test(t.id)&&(t.require_object_read===true||!observations.some(o=>o.id===t.id)));if(!target)return observations;
 const existing=observations.findIndex(o=>o.id===target.id);if(existing>=0)observations.splice(existing,1);
 await guard(); // Authority failures must not become provider availability facts.
 let graphCode:number|null=null,subcode:number|null=null;
 try{
  const result=await graph.withSignal(AbortSignal.timeout(5000)).request(target.id,token,{fields:connection.channel==='facebook'?'id,is_published,permalink_url':'id,permalink'},'GET',(_status,code,evidence)=>{graphCode=code;subcode=evidence?.graph_error_subcode??null;});
  const identity=String(result.id)===target.id;
  const publicPost=connection.channel==='facebook'?result.is_published===true:typeof result.permalink==='string'&&/^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\//.test(result.permalink);
  observations.push({id:target.id,state:identity&&publicPost?'available':'unavailable',source:'object_read',reason:!identity?'identity_unverified':publicPost?'provider_observed':connection.channel==='facebook'&&result.is_published===false?'not_public':'response_unverified'});
 }catch(error){
  const code=error instanceof MetaError?error.graphCode??graphCode:graphCode;
  const restricted=[10,190,200].includes(Number(code));
  // Graph 100/33 explicitly conflates nonexistent objects with unavailable access.
  // Neither this code nor a successful-but-empty response proves deletion.
  const missing=code===100&&(subcode===33||subcode===null);
  const observation:AvailabilityObservation={id:target.id,state:restricted?'access_restricted':missing?'unavailable':'temporarily_unavailable',source:'object_read',reason:restricted?'permission_or_token':missing?'object_missing_or_unreadable':'provider_temporary'};
  observations.push(observation);
  if(connection.provider_account_id){
   observation.graph_error_code=Number(code)||0;observation.graph_error_subcode=subcode;
   const isolated=connection.channel==='facebook'?code===10:code===100&&subcode===33;
   const control=isolated&&posts.find(p=>p.id!==target.id&&idPattern.test(p.id)&&p.media_product_type!=='STORY'&&(connection.channel!=='facebook'||p.id.split('_')[0]===connection.provider_account_id));
   if(control){
    // One additional exact-object GET, same token/fields and lease. No feed absence or error proves deletion.
    observation.calendar_control_id=control.id;
    await guard();
    let healthy=false;
    try{
     const result=await graph.withSignal(AbortSignal.timeout(5000)).request(control.id,token,{fields:connection.channel==='facebook'?'id,is_published,permalink_url':'id,permalink'});
     healthy=String(result.id)===control.id&&(connection.channel==='facebook'?result.is_published===true:typeof result.permalink==='string'&&/^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\//.test(result.permalink));
    }catch{/* Failed control restores visibility; it never supplies an unreadability streak. */}
    const index=observations.findIndex(o=>o.id===control.id);
    const checked:AvailabilityObservation={id:control.id,state:healthy?'available':'temporarily_unavailable',source:'object_read',reason:healthy?'provider_observed':'provider_temporary',calendar_control_check:true};
    if(index>=0)observations[index]=checked;else observations.push(checked);
   }else observation.calendar_control_check=true;
  }
 }
 await guard();return observations;
}
// Called only after the existing webhook HMAC verification. No messages, comments,
// reactions, unsigned API recovery or Instagram change can prove post removal.
export type PublicationRemoval={account_id:string;id:string;occurred_at:number;source:'signed_page_feed_remove';fingerprint:string};
export async function normalizePublicationRemovals(payload:unknown):Promise<PublicationRemoval[]>{
 const body=payload as any;if(body?.object!=='page'||!Array.isArray(body.entry)||body.entry.length>20)return [];
 const events:PublicationRemoval[]=[];
 for(const entry of body.entry){
  if(typeof entry?.id!=='string'||!/^\d{1,30}$/.test(entry.id)||!Number.isSafeInteger(entry.time)||entry.time<946684800||!Array.isArray(entry.changes)||entry.changes.length>100)continue;
  const occurredAt=entry.time>=1000000000000?entry.time/1000:entry.time;
  if(occurredAt<946684800||occurredAt>Date.now()/1000+300)continue;
  for(const change of entry.changes){const value=change?.value;
   if(change?.field!=='feed'||value?.item!=='post'||value?.verb!=='remove'||typeof value.post_id!=='string'||!/^\d{1,30}_\d{1,30}$/.test(value.post_id)||value.post_id.split('_')[0]!==entry.id)continue;
   const source='signed_page_feed_remove' as const,encoded=new TextEncoder().encode(JSON.stringify([entry.id,value.post_id,occurredAt,source]));
   const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoded)),b=>b.toString(16).padStart(2,'0')).join('');
   if(!events.some(e=>e.fingerprint===fingerprint))events.push({account_id:entry.id,id:value.post_id,occurred_at:occurredAt,source,fingerprint});
   if(events.length>=20)return events;
  }
 }return events;
}
