import {hash,seal,unseal} from './metaSecurity.ts';
import {journalPrefix,journalPayload,readJournal,type JournalStore} from './privacyJournal.ts';
export const checkpointPrefix=journalPrefix.replace('/v1/','/checkpoints/v1/');
type RecordEvidence={id:string;raw:string};
type RetentionStore=JournalStore&{remove:(path:string)=>Promise<void>};
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
async function manifestId(records:RecordEvidence[]) {
 if(!Array.isArray(records)||records.length<1||records.length>25)throw new Error('checkpoint_scope_invalid');
 let previous='';const entries:string[]=[];
 for(const r of records){
  if(!hex(r.id)||r.id<=previous||typeof r.raw!=='string')throw new Error('checkpoint_scope_invalid');
  journalPayload(r.raw,r.id);previous=r.id;entries.push(`${r.id}:${await hash(r.raw)}`);
 }
 return hash(entries.join('\n'));
}
export async function readCheckpoint(path:string,store:Pick<JournalStore,'get'>,keys:string[]) {
 if(!path.startsWith(checkpointPrefix)||!hex(path.slice(checkpointPrefix.length,-5))||!path.endsWith('.json'))throw new Error('checkpoint_path_invalid');
 const id=path.slice(checkpointPrefix.length,-5);
 const envelope=JSON.parse(await store.get(path));
 const body=await unseal(envelope,keys,`${checkpointPrefix}${id}`);
 if(body.version!==1||Object.keys(body).some(k=>!['version','records'].includes(k))||await manifestId(body.records)!==id)throw new Error('checkpoint_digest_invalid');
 return body.records.map((r:RecordEvidence)=>({raw:r.raw,payload:journalPayload(r.raw,r.id)}));
}
// The service returns only verified SQL material. No browser supplies evidence payloads or paths.
export async function compactJournal(batchId:string,store:RetentionStore,keys:string[],rpc:(action:string,batch:string)=>Promise<any>) {
 if(!hex(batchId))throw new Error('checkpoint_scope_invalid');
 const material=await rpc('material',batchId);
 if(material.batch_id!==batchId||material.path!==`${checkpointPrefix}${batchId}.json`||await manifestId(material.records)!==batchId)throw new Error('checkpoint_scope_changed');
 for(let n=0;n<material.records.length;n++){
  const r=material.records[n],m=material.manifest[n];
  if(r.path!==`${journalPrefix}${r.id}.json`||m.id!==r.id||m.digest!==await hash(r.raw))throw new Error('checkpoint_scope_changed');
 }
 const records=material.records.map(({id,raw}:RecordEvidence)=>({id,raw}));
 await store.put(material.path,JSON.stringify(await seal({version:1,records},keys[0],`${checkpointPrefix}${batchId}`)));
 const verified=await readCheckpoint(material.path,store,keys);
 if(JSON.stringify(verified.map(r=>r.raw))!==JSON.stringify(records.map((r:RecordEvidence)=>r.raw)))throw new Error('checkpoint_content_changed');
 await rpc('ack',batchId); // Durable independent recovery evidence BEFORE any routine deletion.
 // Revalidate the review and holds immediately before cleanup. No checkpoint deletion is exposed.
 await rpc('material',batchId);
 for(const r of material.records)await store.remove(r.path);
 return rpc('finish',batchId); // Failed/partial deletes leave a pending batch, safe to resume.
}
// Validate the WHOLE independent index before invoking canonical replay. Duplicate originals
// after interrupted cleanup are expected, but conflicting evidence must quarantine recovery.
export async function recoveryRecords(paths:AsyncIterable<string>,store:Pick<JournalStore,'get'>,keys:string[]) {
 const records=new Map<string,{raw:string;payload:any}>();let objects=0;
 for await(const path of paths){
  if(++objects>10000)throw new Error('recovery_volume_requires_operator_batching');
  const incoming=path.startsWith(checkpointPrefix)?await readCheckpoint(path,store,keys):[await readJournal(path,store,keys)];
  for(const r of incoming){
   const old=records.get(r.payload.id);if(old&&old.raw!==r.raw)throw new Error('recovery_evidence_conflict');
   records.set(r.payload.id,r);if(records.size>10000)throw new Error('recovery_volume_requires_operator_batching');
  }
 }
 return [...records.values()].sort((a,b)=>Date.parse(a.payload.created_at)-Date.parse(b.payload.created_at)||(Number(a.payload.method==='hold_release')-Number(b.payload.method==='hold_release'))||a.payload.id.localeCompare(b.payload.id));
}
