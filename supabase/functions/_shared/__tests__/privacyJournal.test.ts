import {describe,it,expect} from 'vitest';
import {persistJournal,readJournal,journalPrefix} from '../privacyJournal';
import {base64url} from '../metaSecurity';
const key=base64url(new Uint8Array(32).fill(7)),id='a'.repeat(64);
const raw=JSON.stringify({id,version:1,project:'ujkzdaaadnvcfayuldmh',method:'operator_identity_review',case_hash:id,verification_hash:id,created_at:'2026-10-10T12:00:00Z',peers:[],grants:[]});
function memoryStore(){const files=new Map<string,string>();return {files,put:async(p:string,b:string)=>{if(!files.has(p))files.set(p,b);},get:async(p:string)=>{if(!files.has(p))throw new Error('missing');return files.get(p)!;}};}
describe('independent erasure journal',()=>{
 it('verifies encrypted durable read-back and retries without overwrite',async()=>{
  const store=memoryStore(),receipt=await persistJournal({id,payload:raw},store,[key]);
  expect(store.files.get(receipt.path)).not.toContain('operator_identity_review');
  const original=store.files.get(receipt.path);await persistJournal({id,payload:raw},store,[key]);expect(store.files.get(receipt.path)).toBe(original);
  expect((await readJournal(receipt.path,store,[key])).raw).toBe(raw);
 });
 it('rejects changed retry evidence and failed durable writes',async()=>{
  const store=memoryStore();await persistJournal({id,payload:raw},store,[key]);
  await expect(persistJournal({id,payload:raw.replace('2026-10-10T12:00:00Z','2026-10-10T12:01:00Z')},store,[key])).rejects.toThrow('journal_content_changed');
  await expect(persistJournal({id,payload:raw},{...store,put:async()=>{throw new Error('offline');}},[key])).rejects.toThrow('offline');
 });
 it('rejects corruption, wrong keys, wrong tenant and untrusted paths',async()=>{
  const store=memoryStore(),{path}=await persistJournal({id,payload:raw},store,[key]);
  await expect(readJournal(path,store,[base64url(new Uint8Array(32).fill(8))])).rejects.toThrow();
  await expect(readJournal(`${journalPrefix}../other.json`,store,[key])).rejects.toThrow('journal_path_invalid');
  await expect(persistJournal({id,payload:raw.replace('ujkzdaaadnvcfayuldmh','production')},store,[key])).rejects.toThrow('journal_evidence_invalid');
  await expect(persistJournal({id,payload:raw.replace('"peers":[]','"peers":[{"body":"must never be journaled"}]')},store,[key])).rejects.toThrow('journal_evidence_invalid');
  const envelope=JSON.parse(store.files.get(path)!);envelope.ciphertext=envelope.ciphertext.slice(0,-2)+'AA';store.files.set(path,JSON.stringify(envelope));
  await expect(readJournal(path,store,[key])).rejects.toThrow();
 });
});
