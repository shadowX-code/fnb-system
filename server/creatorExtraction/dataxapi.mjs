import {metric,profile} from './extract.mjs';
import {publicThumbnail} from './urls.mjs';
const endpoint='https://api.dataxapi.com/v2/xiaohongshu/notes/detail';
const previews=new Map(),pending=new Map();
const text=(value,max=8000)=>typeof value==='string'&&value.trim()?value.trim().slice(0,max):null;
export function normalizeXhsResponse(body,input,grant){
 const item=body.data?.item;
 if(body.code!==200||body.meta?.mode||body.meta?.listing_id!=='xiaohongshu.notes.detail'||body.meta?.version!=='v2'||body.request_id!==grant.request_id)throw new Error('provider_response_unverified');
 if(!item)throw new Error('provider_post_unavailable');
 if(item.platform!=='xiaohongshu'||item.id!==input.post_id)throw new Error('provider_identity_mismatch');
 const authorId=/^[a-f0-9]{24}$/i.test(item.author?.id||'')?item.author.id:null;
 const authorUrl=profile(item.author?.url,'xhs');
 if(authorUrl&&authorId&&new URL(authorUrl).pathname.split('/').pop()!==authorId)throw new Error('provider_identity_mismatch');
 const result={platform:'xhs',post_id:input.post_id,canonical_url:input.canonical_url,metadata_status:'public_extracted',metrics:{},provenance:{},unavailable:{},captured_at:grant.captured_at,source:'DataXAPI · public post · staff confirmation required',message:'Review extracted details and confirm the Creator before saving.'};
 function put(key,value){if(value!==null){result[key]=value;result.provenance[key]={source:'DataXAPI note detail v2',method:'public_api',request_id:body.request_id,captured_at:grant.captured_at}}}
 put('author_external_id',authorId);put('author_display_name',text(item.author?.name,200));put('author_profile_url',authorUrl|| (authorId?'https://www.xiaohongshu.com/user/profile/'+authorId:null));
 put('caption',text([text(item.title,500),text(item.text)].filter(Boolean).join('\n')));put('thumbnail_url',publicThumbnail(item.media?.cover,'xhs'));
 if(typeof item.published_at==='string'&&/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(item.published_at)&&Number.isFinite(Date.parse(item.published_at))&&Date.parse(item.published_at)<=Date.now()+300000){put('published_at',new Date(item.published_at).toISOString());put('date_precision','instant')}
 for(const key of ['likes','comments','shares','views','saves']){const value=metric(item.metrics?.[key]);if(value!==null){result.metrics[key]=value;result.provenance[key]={source:'DataXAPI public counters',method:'public_api',request_id:body.request_id,captured_at:grant.captured_at}}}
 for(const key of ['author_handle','author_display_name','author_profile_url','caption','thumbnail_url','published_at','likes','comments','shares','views','saves'])if(result[key]==null&&result.metrics[key]==null)result.unavailable[key]='Not returned by the XHS data provider';
 if(!result.caption&&!result.thumbnail_url)throw new Error('provider_post_unavailable');
 return result;
}
export async function inspectXhs(input,{organization,brand,env=process.env,fetcher=fetch}={}){
 if(input.platform!=='xhs'||!env.MARKETING_XHS_DATAXAPI_KEY||!env.MARKETING_XHS_DATAXAPI_TRIAL)return null;
 let grant;try{grant=JSON.parse(env.MARKETING_XHS_DATAXAPI_TRIAL)}catch{return null}
 const now=Date.now(),captured=Date.parse(grant.captured_at),expires=Date.parse(grant.expires_at);
 // The approved trial reopens one already-billed request; no new independent paid call.
 if(!input.post_id||grant.note_id!==input.post_id||grant.organization!==organization||!brand||!Number.isFinite(captured)||!Number.isFinite(expires)||captured>now||expires>captured+23*3600000||now>=expires||!/^feedx-xhs-[\w-]{8,100}$/.test(grant.idempotency_key||'')||!/^req_[\w-]+$/.test(grant.request_id||''))return null;
 const key=organization+':'+brand+':'+input.post_id+':'+grant.request_id;
 if(previews.has(key)&&previews.get(key).until>now)return {...structuredClone(previews.get(key).result),cache_hit:true,runtime_ms:0};
 if(pending.has(key))return structuredClone(await pending.get(key));
 const task=(async()=>{const started=Date.now();
  try{
   let response;
   for(let attempt=0;attempt<2;attempt++){
    try{response=await fetcher(endpoint,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+env.MARKETING_XHS_DATAXAPI_KEY,'Content-Type':'application/json','Idempotency-Key':grant.idempotency_key},body:JSON.stringify({note_id:input.post_id}),signal:AbortSignal.timeout(12000)});break}catch(error){if(attempt)throw error}
   }
   if(!response.ok)throw new Error(({401:'provider_auth_required',403:'provider_access_restricted',402:'provider_balance_required',429:'provider_rate_limited'})[response.status]||'provider_unavailable');
   let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>2000000)throw new Error('provider_response_too_large');chunks.push(chunk)}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(body.meta?.currency!=='CNY'||Number(body.meta.charged_amount)>0.19||!Number.isFinite(Number(body.meta?.charged_amount)))throw new Error('provider_response_unverified');
   const result={...normalizeXhsResponse(body,input,grant),runtime_ms:Date.now()-started,browser_used:false,cache_hit:false};
   if(previews.size>=64)previews.delete(previews.keys().next().value);
   previews.set(key,{result,until:Math.min(Date.now()+300000,expires)});return structuredClone(result);
  }catch(error){const reason=error.message;return {platform:'xhs',post_id:input.post_id,canonical_url:input.canonical_url,metadata_status:'unavailable',metrics:{},reason:'xhs_provider_unavailable',unavailable:{post:({provider_auth_required:'The XHS data-provider key needs attention.',provider_access_restricted:'The XHS provider cannot access this post.',provider_balance_required:'The approved XHS trial credit is unavailable.',provider_rate_limited:'The XHS provider is busy. Try later.',provider_post_unavailable:'The XHS provider did not return this post.'})[reason]||'XHS provider details could not be verified. Manual entry is available.'},runtime_ms:Date.now()-started,browser_used:false}}
 })();pending.set(key,task);try{return await task}finally{pending.delete(key)}
}
