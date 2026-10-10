import { put, get } from 'https://esm.sh/@vercel/blob@2.8.1?target=es2022';
import { persistJournal, type JournalStore } from './privacyJournal.ts';

const env=(n:string)=>Deno.env.get(n)||'';
export function journalKeys(){return [env('MARKETING_ERASURE_JOURNAL_ENCRYPTION_KEY'),env('MARKETING_ERASURE_JOURNAL_PREVIOUS_ENCRYPTION_KEY')].filter(Boolean);}
export function blobJournalStore():JournalStore {
 const token=env('MARKETING_ERASURE_JOURNAL_READ_WRITE_TOKEN');
 if(!token||!journalKeys().length)throw new Error('journal_not_configured');
 return {
  put:async(path,body)=>{try{await put(path,body,{access:'private',token,addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});}catch{const existing=await get(path,{access:'private',token,useCache:false});if(!existing||existing.statusCode!==200)throw new Error('journal_write_unavailable');}},
  get:async(path)=>{const result=await get(path,{access:'private',token,useCache:false});if(!result||result.statusCode!==200||!result.stream)throw new Error('journal_read_unavailable');return await new Response(result.stream).text();}
 };
}
export async function commitJournal(db:any,intent:{id:string;payload:string}) {
 const receipt=await persistJournal(intent,blobJournalStore(),journalKeys());
 const {error}=await db.rpc('marketing_privacy_journal_ack',{p_id:intent.id,p_digest:receipt.digest,p_path:receipt.path});
 if(error)throw new Error('journal_ack_unavailable');
}
