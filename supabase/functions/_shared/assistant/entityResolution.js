import {AssistantError} from '../assistantError.js';
import {permittedOutlet} from './readContract.js';

export const entityKey=value=>String(value??'').normalize('NFKD').replace(/\p{M}+/gu,'').toLowerCase()
 .replace(/(\p{Script=Han})([a-z0-9])|([a-z0-9])(\p{Script=Han})/gu,(_,a,b,c,d)=>a?a+' '+b:c+' '+d)
 .replace(/[^\p{L}\p{N}]+/gu,' ').trim();

export function exactEntity(rows,query,fields){
 const key=entityKey(query);
 const matches=key?rows.filter(row=>fields.some(field=>entityKey(row[field])===key)):[];
 if(matches.length>1)throw new AssistantError('entity_ambiguous',409);
 return matches[0]||null;
}

function similarEntity(rows,value,fields){
 const wanted=entityKey(value);
 if(wanted.length<4)return false;
 const distance=(a,b)=>{
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
   const next=[i];
   for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,previous[j]+1,previous[j-1]+Number(a[i-1]!==b[j-1]));
   previous=next;
  }
  return previous[b.length];
 };
 return rows.some(row=>fields.some(field=>{
  const candidate=entityKey(row[field]);
  return candidate.length>=4&&distance(wanted,candidate)<=Math.min(3,Math.floor(Math.max(wanted.length,candidate.length)*.27));
 }));
}

export function normalizedEntity(rows,value,fields){
 const match=exactEntity(rows,value,fields);
 if(!match&&similarEntity(rows,value,fields))throw new AssistantError('entity_ambiguous',409);
 return match;
}

export const exactName=(query,field,value)=>value.includes('*')?query.eq(field,value):query.ilike(field,value.replace(/[\\%_]/g,'\\$&'));

export async function sourceRows(query,signal){
 const {data,error}=await query.abortSignal(signal);
 if(error||!Array.isArray(data))throw new AssistantError(error?.code==='42501'?'business_read_denied':'business_read_unavailable',error?.code==='42501'?403:503);
 return data;
}

// Resolve normalized names only over a complete bounded authorized catalogue.
// A similar transcription can suggest clarification, never select a scope.
export async function resolveOutlet(caller,{outlet_id,outlet_name},signal){
 const outlets=()=>caller.from('outlets').select('id,name,code');
 if(outlet_id&&!outlet_name){
  await permittedOutlet(caller,outlet_id,signal);
  return (await sourceRows(outlets().eq('id',outlet_id).limit(2),signal))[0]||null;
 }
 if(!outlet_name)return null;
 const value=outlet_name.normalize('NFKC').trim();
 for(const field of ['name','code']){
  const rows=await sourceRows(exactName(outlets(),field,value).limit(2),signal);
  if(rows.length>1)throw new AssistantError('entity_ambiguous',409);
  if(rows.length){
   await permittedOutlet(caller,rows[0].id,signal);
   return rows[0];
  }
 }
 const rows=await outletDirectory(caller,signal);
 const outlet=matchOutlet(rows,value);
 if(outlet)await permittedOutlet(caller,outlet.id,signal);
 return outlet;
}

export async function outletDirectory(caller,signal){
 const rows=await sourceRows(caller.from('outlets').select('id,name,code,is_active').order('id').limit(201),signal);
 if(rows.length>200)throw new AssistantError('entity_scope_required',409);
 return rows;
}

function matchOutlet(rows,value){
 const exact=exactEntity(rows,value,['name','code']);
 if(exact)return exact;
 const key=entityKey(value);
 // A multiword abbreviated name can identify a unique outlet. Phonetic or
 // spelling similarities still require confirmation.
 const prefixes=key.split(' ').length>1?rows.filter(row=>entityKey(row.name).startsWith(key+' ')):[];
 if(prefixes.length>1)throw new AssistantError('entity_ambiguous',409);
 return prefixes[0]||normalizedEntity(rows,value,['name','code']);
}

export async function resolveBrand(caller,name,signal){
 const {data,error}=await caller.rpc('marketing_brand_context').abortSignal(signal);
 if(error||!Array.isArray(data?.brands))throw new AssistantError(error?.code==='42501'?'business_read_denied':'business_read_unavailable',error?.code==='42501'?403:503);
 return normalizedEntity(data.brands,name,['name','code']);
}

export function namedOutlets(rows,prompt){
 const key=' '+entityKey(prompt)+' ';
 const words=String(prompt).normalize('NFKC').match(/\b[A-Z][A-Z0-9-]{1,39}\b/g)||[];
 const exact=rows.filter(row=>{
  const name=entityKey(row.name);
  return name&&key.includes(' '+name+' ')||words.includes(row.code);
 });
 if(exact.length)return exact;
 const abbreviated=rows.filter(row=>{
  const parts=entityKey(row.name).split(' ');
  return parts.slice(0,-1).some((_,i)=>{
   const prefix=parts.slice(0,i+1).join(' ');
   return i>=1&&prefix.length>=10&&key.includes(' '+prefix+' ');
  });
 });
 if(abbreviated.length>1)throw new AssistantError('entity_ambiguous',409);
 return abbreviated;
}
