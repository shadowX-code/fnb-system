import {describe,it,expect} from 'vitest';
import {hash,base64url} from '../metaSecurity';
import {journalPrefix,persistJournal} from '../privacyJournal';
import {checkpointPrefix,compactJournal,recoveryRecords,readCheckpoint} from '../privacyRetention';
const key=base64url(new Uint8Array(32).fill(5)),id='a'.repeat(64);
const raw=JSON.stringify({version:1,project:'ujkzdaaadnvcfayuldmh',id,method:'operator_identity_review',created_at:'2026-01-01T00:00:00Z',case_hash:id,verification_hash:id,peers:[],grants:[]});
async function fixture(){
 const digest=await hash(raw),batch=await hash(`${id}:${digest}`),files=new Map<string,string>();
 const calls:string[]=[];let fail='';
 const store={put:async(p:string,b:string)=>{calls.push('put');if(fail==='put')throw Error('offline');if(!files.has(p))files.set(p,b);},get:async(p:string)=>{if(fail==='get')throw Error('offline');if(!files.has(p))throw Error('missing');return files.get(p)!;},remove:async(p:string)=>{calls.push('delete');if(fail==='delete')throw Error('offline');files.delete(p);}};
 const material={batch_id:batch,path:`${checkpointPrefix}${batch}.json`,manifest:[{id,digest}],records:[{id,raw,path:`${journalPrefix}${id}.json`}]};
 const rpc=async(action:string)=>{calls.push(action);if(fail===action)throw Error('authority_rejected');return action==='finish'?{status:'compacted'}:material;};
 return {batch,files,store,calls,material,rpc,setFail:(v:string)=>{fail=v;}};
}
async function* paths(values:Iterable<string>){yield* values;}
describe('reviewed journal compaction',()=>{
 it('verifies encrypted checkpoint before coordinated deletion and completion',async()=>{
  const f=await fixture();await persistJournal({id,payload:raw},f.store,[key]);f.calls.length=0;
  expect(await compactJournal(f.batch,f.store,[key],f.rpc)).toEqual({status:'compacted'});
  expect(f.calls).toEqual(['material','put','ack','material','delete','finish']);
  expect(f.files.size).toBe(1);expect(f.files.get(f.material.path)).not.toContain('operator_identity_review');
  expect((await recoveryRecords(paths(f.files.keys()),f.store,[key]))[0].raw).toBe(raw);
 });
 for(const fail of ['put','get','ack'])it(`never deletes on ${fail} failure`,async()=>{
  const f=await fixture();f.setFail(fail);await expect(compactJournal(f.batch,f.store,[key],f.rpc)).rejects.toThrow();expect(f.calls).not.toContain('delete');
 });
 it('preserves checkpoint and resumes after deletion or SQL completion failure',async()=>{
  for(const fail of ['delete','finish']){
   const f=await fixture();f.setFail(fail);await expect(compactJournal(f.batch,f.store,[key],f.rpc)).rejects.toThrow();
   expect(f.files.has(f.material.path)).toBe(true);const before=f.files.get(f.material.path);f.setFail('');
   await compactJournal(f.batch,f.store,[key],f.rpc);expect(f.files.get(f.material.path)).toBe(before);
  }
 });
 it('rejects changed material, foreign paths and expired authority before cleanup',async()=>{
  const f=await fixture();f.material.records[0].path='unrelated/file';
  await expect(compactJournal(f.batch,f.store,[key],f.rpc)).rejects.toThrow('checkpoint_scope_changed');expect(f.calls).not.toContain('delete');
  f.material.records[0].path=`${journalPrefix}${id}.json`;let reads=0;
  await expect(compactJournal(f.batch,f.store,[key],async(a)=>{if(a==='material'&&++reads===2)throw Error('review_expired');return f.rpc(a);})).rejects.toThrow('review_expired');expect(f.calls).not.toContain('delete');
 });
 it('deduplicates checkpoint/original overlap; rejects corruption, wrong keys and conflicts',async()=>{
  const f=await fixture();await compactJournal(f.batch,f.store,[key],f.rpc);await persistJournal({id,payload:raw},f.store,[key]);
  expect(await recoveryRecords(paths(f.files.keys()),f.store,[key])).toHaveLength(1);
  await expect(readCheckpoint(f.material.path,f.store,[base64url(new Uint8Array(32).fill(6))])).rejects.toThrow();
  f.files.delete(`${journalPrefix}${id}.json`);await persistJournal({id,payload:raw.replace('2026-01-01','2026-01-02')},f.store,[key]);
  await expect(recoveryRecords(paths(f.files.keys()),f.store,[key])).rejects.toThrow('recovery_evidence_conflict');
  f.files.set(f.material.path,'{}');await expect(recoveryRecords(paths(f.files.keys()),f.store,[key])).rejects.toThrow();
 });
 it('retains real suppression and hold-release evidence without inventing anonymous data',async()=>{
  const f=await fixture();const u='11111111-1111-4111-8111-111111111111';
  const payload=JSON.parse(raw);payload.peers=[{conversation_id:u,connection_id:u,generation:3,peer_hash:id,erased_at:payload.created_at,opted_out:true,hold:{basis:'legal_claim',evidence:id,created_at:payload.created_at,review_at:'2026-02-01T00:00:00Z'}}];
  const evidence=JSON.stringify(payload);await persistJournal({id,payload:evidence},f.store,[key]);
  expect((await recoveryRecords(paths(f.files.keys()),f.store,[key]))[0].payload.peers[0].opted_out).toBe(true);
 });
});
