import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.105.4';
import {list} from 'https://esm.sh/@vercel/blob@2.8.1?target=es2022';
import {STAGING_SUPABASE,hash} from '../_shared/metaSecurity.ts';
import {blobJournalStore,commitJournal,journalKeys} from '../_shared/privacyBlob.ts';
import {journalPrefix,readJournal} from '../_shared/privacyJournal.ts';
const env=(n:string)=>Deno.env.get(n)||'';
async function rpc(db:any,name:string,args:any={}){const {data,error}=await db.rpc(name,args);if(error)throw new Error('privacy_authority_rejected');return data;}
Deno.serve(async req=>{
 const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(env('SUPABASE_URL')!==STAGING_SUPABASE)return reply({error:'Staging only.'},403);
 const secret=env('MARKETING_WORKER_SECRET'),supplied=req.headers.get('x-marketing-worker-secret')||'';
 const a=await hash(secret),b=await hash(supplied);let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 if(!secret||!supplied||diff)return reply({error:'Privacy operator authorization required.'},401);
 if(req.method!=='POST')return reply({error:'Endpoint unavailable.'},404);
 const raw=await req.text();if(raw.length>4000)return reply({error:'Request too large.'},413);
 const db=createClient(STAGING_SUPABASE,env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const body=JSON.parse(raw),path=new URL(req.url).pathname.split('/marketing-privacy')[1];
  if(path==='/erase-customer'){
   // Only a privacy operator with independently verified identity/scope evidence may call this.
   const intent=await rpc(db,'marketing_privacy_prepare_customer',{p_org:body.organizationId,p_brand:body.brandId,p_conversation:body.conversationId,p_case:body.caseHash,p_verification:body.verificationHash});
   await commitJournal(db,intent);
   return reply(await rpc(db,'marketing_inbox_privacy_erase_verified',{p_org:body.organizationId,p_brand:body.brandId,p_conversation:body.conversationId,p_case_hash:body.caseHash,p_verification_hash:body.verificationHash}));
  }
  if(path==='/release-hold'){
   const intent=await rpc(db,'marketing_privacy_prepare_release',{p_conversation:body.conversationId,p_evidence:body.evidenceHash});await commitJournal(db,intent);
   await rpc(db,'marketing_privacy_release_hold',{p_conversation:body.conversationId,p_evidence:body.evidenceHash});return reply({status:'released'});
  }
  if(path==='/restore-replay'){
   if(body.quarantineConfirmed!==true)return reply({error:'Restore quarantine must be confirmed.'},409);
   // Scan the independent object index, never a restored database manifest. Validate ALL before mutations.
   let cursor:string|undefined;const records:any[]=[];const store=blobJournalStore();
   do{const page=await list({token:env('MARKETING_ERASURE_JOURNAL_READ_WRITE_TOKEN'),prefix:journalPrefix,cursor,limit:100});
    for(const item of page.blobs)records.push(await readJournal(item.pathname,store,journalKeys()));
    cursor=page.hasMore?page.cursor:undefined;
    if(records.length>10000)throw new Error('recovery_volume_requires_operator_batching');
   }while(cursor);
   records.sort((a,b)=>Date.parse(a.payload.created_at)-Date.parse(b.payload.created_at)||(a.payload.method==='hold_release'?1:b.payload.method==='hold_release'?-1:0));
   let erased=0;for(const record of records){const result=await rpc(db,'marketing_privacy_replay',{p_payload:record.payload});erased+=result.erased_conversations||0;}
   return reply({status:'replayed',records:records.length,erased_conversations:erased,access_reopened:false,backup_followup:'pending'});
  }
  return reply({error:'Endpoint unavailable.'},404);
 }catch{return reply({error:'Privacy operation incomplete; keep restore quarantined.'},503);}
});
