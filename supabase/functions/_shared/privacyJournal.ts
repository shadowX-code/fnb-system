import { hash, seal, unseal, STAGING_SUPABASE } from './metaSecurity.ts';

export const journalPrefix='feedx/ujkzdaaadnvcfayuldmh/erasure/v1/';
export type JournalStore={put:(path:string,body:string)=>Promise<void>;get:(path:string)=>Promise<string>};
export function journalPayload(raw:string,id:string) {
 const p=JSON.parse(raw);
 const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
 const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
 const keys=['version','project','id','case_hash','verification_hash','method','created_at','receipt','grants','peers','oauth_session_ids','conversation_id','evidence'];
 if(!digest(id)||p.id!==id||p.project!=='ujkzdaaadnvcfayuldmh'||p.version!==1||!date(p.created_at)||Object.keys(p).some(k=>!keys.includes(k))||!['meta_signed_request','operator_identity_review','hold_release'].includes(p.method))throw new Error('journal_evidence_invalid');
 if(p.method==='hold_release'){
  if(!uuid(p.conversation_id)||!digest(p.evidence))throw new Error('journal_evidence_invalid');
 }else{
  if(!digest(p.case_hash)||!digest(p.verification_hash)||!Array.isArray(p.peers)||!Array.isArray(p.grants)||(p.receipt!==null&&p.receipt!==undefined&&!digest(p.receipt)))throw new Error('journal_evidence_invalid');
  for(const g of p.grants)if(!uuid(g.connection_id)||!Number.isInteger(g.generation)||g.generation<0||Object.keys(g).some(k=>!['connection_id','generation'].includes(k)))throw new Error('journal_evidence_invalid');
  for(const peer of p.peers){
   if(!uuid(peer.conversation_id)||!uuid(peer.connection_id)||!Number.isInteger(peer.generation)||peer.generation<0||!digest(peer.peer_hash)||!date(peer.erased_at)||typeof peer.opted_out!=='boolean'||Object.keys(peer).some(k=>!['conversation_id','connection_id','generation','peer_hash','erased_at','opted_out','hold'].includes(k)))throw new Error('journal_evidence_invalid');
   if(peer.hold&&(!['statutory_record','court_order','legal_claim'].includes(peer.hold.basis)||!digest(peer.hold.evidence)||!date(peer.hold.created_at)||!date(peer.hold.review_at)||Object.keys(peer.hold).some(k=>!['basis','evidence','created_at','review_at'].includes(k))))throw new Error('journal_evidence_invalid');
  }
  if(p.oauth_session_ids!==undefined&&(!Array.isArray(p.oauth_session_ids)||p.oauth_session_ids.some((v:unknown)=>!uuid(v))))throw new Error('journal_evidence_invalid');
 }
 return p;
}
// Immutable object keys; authenticated encryption binds evidence to Staging and its event ID.
// A duplicate write must contain identical evidence, not overwrite an earlier intent.
export async function persistJournal(intent:{id:string;payload:string},store:JournalStore,keys:string[]) {
 journalPayload(intent.payload,intent.id);
 const path=`${journalPrefix}${intent.id}.json`,digest=await hash(intent.payload);
 const envelope=await seal({payload:intent.payload,digest},keys[0],`${STAGING_SUPABASE}:privacy:${intent.id}`);
 await store.put(path,JSON.stringify(envelope));
 const record=await readJournal(path,store,keys);
 if(record.raw!==intent.payload)throw new Error('journal_content_changed');
 return {path,digest};
}
export async function readJournal(path:string,store:Pick<JournalStore,'get'>,keys:string[]) {
 if(!path.startsWith(journalPrefix)||!/^[a-f0-9]{64}\.json$/.test(path.slice(journalPrefix.length)))throw new Error('journal_path_invalid');
 const id=path.slice(journalPrefix.length,-5);
 const record=await unseal(JSON.parse(await store.get(path)),keys,`${STAGING_SUPABASE}:privacy:${id}`);
 if(await hash(record.payload)!==record.digest)throw new Error('journal_digest_invalid');
 return {raw:record.payload,payload:journalPayload(record.payload,id)};
}
