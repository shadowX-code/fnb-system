import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.4';
import { STAGING_SUPABASE, connectionBinding, unseal, hash } from '../_shared/metaSecurity.ts';
import { MetaError, MetaGraph } from '../_shared/metaGraph.ts';
import { advanceMetaPublish, testAccountEnabled, verifyMetaMedia } from '../_shared/metaPublishing.ts';
import { diagnoseMetaConnection } from '../_shared/metaConnectionDiagnostics.ts';
import { readMetaPosts } from '../_shared/metaSynchronization.ts';
const env=(name:string)=>Deno.env.get(name)||'';
async function call(db:any,name:string,args:any={}) {const {data,error}=await db.rpc(name,args);if(error)throw new Error('marketing_authority_rejected');return data;}
Deno.serve(async(req)=>{
 const reply=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(env('SUPABASE_URL')!==STAGING_SUPABASE)return reply({error:'Staging worker only.'},403);
 if(req.method!=='POST'||!new URL(req.url).pathname.endsWith('/tick'))return reply({error:'Endpoint unavailable.'},404);
 // Fixed-length constant-time digest comparison; the scheduler key never enters a URL.
 const supplied=req.headers.get('x-marketing-worker-secret')||'',secret=env('MARKETING_WORKER_SECRET');
 const a=new TextEncoder().encode(await hash(supplied)),b=new TextEncoder().encode(await hash(secret));let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
 if(!secret||!supplied||difference)return reply({error:'Scheduler authorization required.'},401);
 const db=createClient(STAGING_SUPABASE,env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 await call(db,'marketing_worker_health');
 await call(db,'marketing_inbox_process_events',{p_limit:20});
 const configured=['MARKETING_META_APP_ID','MARKETING_META_APP_SECRET','MARKETING_META_LOGIN_CONFIG_ID','MARKETING_META_GRAPH_VERSION','MARKETING_META_TOKEN_ENCRYPTION_KEY'].every(n=>env(n));
 if(!configured){await call(db,'marketing_worker_health',{p_error:'meta_not_configured',p_completed:true});return reply({status:'blocked',reason:'meta_not_configured'});}
 const graph=new MetaGraph({appId:env('MARKETING_META_APP_ID'),appSecret:env('MARKETING_META_APP_SECRET'),configId:env('MARKETING_META_LOGIN_CONFIG_ID'),version:env('MARKETING_META_GRAPH_VERSION')});
 async function tokenFor(connection:any) {
  const material=await call(db,'marketing_meta_connection_material',{p_connection:connection.id});
  if(!material||material.credential_generation!==connection.credential_generation)throw new Error('connection_changed');
  const value=await unseal(material.sealed_token,[env('MARKETING_META_TOKEN_ENCRYPTION_KEY'),env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],connectionBinding(material));return value.token;
 }
 try {
  const job=await call(db,'marketing_claim_reconciliation')||await call(db,'marketing_claim_job');
  if(job) {
   const guard=async()=>{
    const c=await call(db,'marketing_job_guard',{p_job:job.id,p_lease:job.lease_token});
    if(c.status!=='test_authorized'||!testAccountEnabled(c.provider_account_id,env('MARKETING_META_TEST_ACCOUNT_IDS')))throw new MetaError('external_account_not_enabled');
    return c;
   };
   let result:any;
   try {
    const connection=await guard(),token=await tokenFor(connection),variant=job.payload.variants.find((v:any)=>v.channel===job.channel);
    const material=await call(db,'marketing_meta_connection_material',{p_connection:connection.id});
    const retained=await unseal(material.sealed_token,[env('MARKETING_META_TOKEN_ENCRYPTION_KEY'),env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],connectionBinding(material));
    const eligibility=await diagnoseMetaConnection(graph,env('MARKETING_META_APP_ID'),`${env('MARKETING_META_APP_ID')}|${env('MARKETING_META_APP_SECRET')}`,material,retained.token,async()=>{await guard();},true,retained.authorizerAssignment,retained.oauthTaskEvidence);
    if(eligibility.publishing_evidence?.eligibility!=='verified')throw new MetaError('publishing_eligibility_unverified');
    if(!variant||!connection.capabilities.formats?.includes(variant.format))throw new MetaError('channel_format_unavailable');
    const state=job.provider_state||{},assets=await call(db,'marketing_job_assets',{p_job:job.id,p_lease:job.lease_token});
    const checkpoint=(s:any)=>call(db,'marketing_job_checkpoint',{p_job:job.id,p_lease:job.lease_token,p_state:s});
    state.verified_assets||=[];
    // One immutable asset per tick bounds downloads. All bytes are validated before
    // the first Meta write; previews alone never establish publishing compatibility.
    const next=variant.asset_ids.find((id:string)=>!state.verified_assets.includes(id));
    if(next&&!job.provider_state?.pending&&!job.provider_state?.post_id&&job.state!=='reconciling') {
     const asset=assets.find((a:any)=>a.id===next);
     if(!asset||asset.size_bytes>(asset.mime_type==='video/mp4'?52428800:8388608))throw new MetaError('media_size_unsupported');
     await guard();const {data:blob,error}=await db.storage.from('marketing-media').download(asset.object_path);
     if(error||!blob||blob.size!==Number(asset.size_bytes))throw new MetaError('media_source_unavailable',false,true);
     verifyMetaMedia(new Uint8Array(await blob.arrayBuffer()),asset.mime_type,job.channel);
     state.verified_assets.push(next);await checkpoint(state);result={outcome:'waiting',code:'media_verifying'};
    } else {
     const mediaUrls=[];
     // Do not request signed URLs while only reconciling an existing receipt.
     if(job.state!=='reconciling'&&!state.pending&&!state.post_id)for(const id of variant.asset_ids) {
      const asset=assets.find((a:any)=>a.id===id);if(!asset)throw new MetaError('media_source_unavailable');
      const {data,error}=await db.storage.from('marketing-media').createSignedUrl(asset.object_path,3600);
      if(error||!data)throw new MetaError('media_source_unavailable',false,true);mediaUrls.push(data.signedUrl);
     }
     result=await advanceMetaPublish({graph,accountId:connection.provider_account_id,token,variant,mediaUrls,state,checkpoint,guard:async()=>{await guard();},reconcileOnly:job.state==='reconciling'});
    }
   }catch(error){result={outcome:error instanceof MetaError&&!error.uncertain?(error.retryable?'retryable_failure':'permanent_failure'):'uncertain',code:error instanceof MetaError?error.code:'publishing_authority_changed'};}
   if(job.state==='reconciling'&&result.outcome!=='published')result={outcome:'uncertain',code:result.code||'manual_reconciliation_required'};
   if(result.outcome==='waiting')await call(db,'marketing_defer_job',{p_job:job.id,p_lease:job.lease_token,p_seconds:60,p_code:result.code});
   else await call(db,'marketing_finish_job',{p_job:job.id,p_lease:job.lease_token,p_outcome:result.outcome,p_provider_post_id:result.postId||null,p_error_code:result.code||null});
   // Publishing and synchronization are separate ticks, bounding wall time.
   await call(db,'marketing_worker_health',{p_completed:true});return reply({status:'processed',outcome:result.outcome});
  }
  const connection=await call(db,'marketing_meta_sync_claim');
  if(connection) {
   const guard=async()=>{if(!await call(db,'marketing_meta_sync_guard',{p_connection:connection.id,p_generation:connection.credential_generation,p_lease:connection.sync_lease}))throw new Error('synchronization_authority_changed');};
   let posts:any[]=[],after:string|null=null,errorCode:string|null=null;
   try{const token=await tokenFor(connection);const result=await readMetaPosts(graph,connection,token,guard);posts=result.posts;after=result.after;}catch(error){errorCode=error instanceof MetaError?error.code:'sync_unavailable';}
   await call(db,'marketing_meta_sync_finish',{p_connection:connection.id,p_generation:connection.credential_generation,p_lease:connection.sync_lease,p_posts:posts,p_after:after,p_error:errorCode});
  }
  await call(db,'marketing_worker_health',{p_completed:true});return reply({status:connection?'synchronized':'idle'});
 }catch{await call(db,'marketing_worker_health',{p_error:'worker_authority_or_network_failure'});return reply({error:'Worker needs investigation.'},503);}
});
