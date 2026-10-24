import {publishingFormatKey,publishingFormatEnabled} from '../_shared/publishingFormatPolicy.mjs';
import {facebookVideoConfigured,facebookReceiptRecoveryAllowed,instagramExtendedConfigured} from '../_shared/marketingExecution.mjs';
import {runInboxAutomatic} from '../_shared/inboxAutomatic.ts';
import {runInboxProfile} from '../_shared/metaInboxProfile.ts';
import {runCreatorFollowers} from '../_shared/metaCreatorProfile.ts';
import {publishingConfigured, publishingAccountAllowed} from '../_shared/marketingExecution.mjs';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.4';
import { STAGING_SUPABASE, connectionBinding, unseal, hash } from '../_shared/metaSecurity.ts';
import { MetaError, MetaGraph } from '../_shared/metaGraph.ts';
import {publishingAssetIds,verifyCoverFrame} from '../_shared/metaReelCover.ts';
import { advanceMetaPublish, verifyMetaMedia } from '../_shared/metaPublishing.ts';
import { diagnoseMetaConnection } from '../_shared/metaConnectionDiagnostics.ts';
import { runConnectionHealth } from '../_shared/metaConnectionHealth.ts';
import { runInboxHistory } from '../_shared/metaInboxHistory.ts';
import {observePostAvailability} from '../_shared/metaPostAvailability.ts';
import { readMetaPosts } from '../_shared/metaSynchronization.ts';
import { processAdsSync } from '../_shared/metaAds.ts';
import { cleanupTemporaryMedia } from '../_shared/marketingMediaCleanup.ts';
import { commitJournal } from '../_shared/privacyBlob.ts';
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
 await call(db,'marketing_ads_change_expire');
 // Retain failed write-ahead intents for retry; journal failures never alter publishing gates.
 try{for(const intent of await call(db,'marketing_privacy_journal_pending'))await commitJournal(db,intent);}catch{console.warn('marketing_privacy_journal_pending');}
 await call(db,'marketing_inbox_process_events',{p_limit:20});

 const configured=['MARKETING_META_APP_ID','MARKETING_META_APP_SECRET','MARKETING_META_LOGIN_CONFIG_ID','MARKETING_META_GRAPH_VERSION','MARKETING_META_TOKEN_ENCRYPTION_KEY'].every(n=>env(n));
 if(!configured){await call(db,'marketing_worker_health',{p_error:'meta_not_configured',p_completed:true});return reply({status:'blocked',reason:'meta_not_configured'});}
 const graph=new MetaGraph({appId:env('MARKETING_META_APP_ID'),appSecret:env('MARKETING_META_APP_SECRET'),configId:env('MARKETING_META_LOGIN_CONFIG_ID'),version:env('MARKETING_META_GRAPH_VERSION')});
 await call(db,'marketing_ads_schedule');
 const checkHealth=()=>runConnectionHealth(db,graph,{appId:env('MARKETING_META_APP_ID'),appSecret:env('MARKETING_META_APP_SECRET')},[env('MARKETING_META_TOKEN_ENCRYPTION_KEY'),env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')]);
 const started=Date.now();
 async function tokenFor(connection:any) {
  const material=await call(db,'marketing_meta_connection_material',{p_connection:connection.id});
  if(!material||material.credential_generation!==connection.credential_generation)throw new Error('connection_changed');
  const value=await unseal(material.sealed_token,[env('MARKETING_META_TOKEN_ENCRYPTION_KEY'),env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],connectionBinding(material));return value.token;
 }
 try {
  const job=publishingConfigured(env) ? await call(db,'marketing_claim_reconciliation')||await call(db,'marketing_claim_job') : null;
  if(job) {
   const guard=async(submission=false)=>{
    const c=await call(db,'marketing_job_guard',{p_job:job.id,p_lease:job.lease_token,p_submission:submission});
    if(!publishingAccountAllowed(c,env))throw new MetaError('external_account_not_enabled');
    return c;
   };
   let result:any;
   try {
    const connection=await guard(),token=await tokenFor(connection),variant=job.payload.variants.find((v:any)=>v.channel===job.channel);
    const facebookVideo=variant?.channel==='facebook'&&['video','reel'].includes(variant.format);
    const switches=()=>({facebook_video_execution_enabled:facebookVideoConfigured(env),instagram_extended_execution_enabled:instagramExtendedConfigured(env)});
    const videoReadOnly=facebookVideo&&!publishingFormatEnabled(variant,[],connection.format_authorizations,switches());
    if(videoReadOnly&&!job.provider_state?.objects?.fb_video&&!job.provider_state?.pending&&!job.provider_state?.post_id)throw new MetaError('facebook_video_not_enabled');
    const material=await call(db,'marketing_meta_connection_material',{p_connection:connection.id});
    const retained=await unseal(material.sealed_token,[env('MARKETING_META_TOKEN_ENCRYPTION_KEY'),env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],connectionBinding(material));
    const eligibility=await diagnoseMetaConnection(graph,env('MARKETING_META_APP_ID'),`${env('MARKETING_META_APP_ID')}|${env('MARKETING_META_APP_SECRET')}`,material,retained.token,async()=>{await guard();},true,retained.authorizerAssignment,retained.oauthTaskEvidence,undefined,variant.format==='story');
    if(eligibility.publishing_evidence?.eligibility!=='verified')throw new MetaError('publishing_eligibility_unverified');
    if(!variant||!connection.capabilities.formats?.includes(variant.format))throw new MetaError('channel_format_unavailable');
    const state=job.provider_state||{},assets=await call(db,'marketing_job_assets',{p_job:job.id,p_lease:job.lease_token});
    const mediaTypes=variant.asset_ids.map((id:string)=>assets.find((a:any)=>a.id===id)?.mime_type);
    const extendedInstagram=job.channel==='instagram'&&(variant.format==='story'||variant.format==='carousel'&&mediaTypes.includes('video/mp4'));
    const key=publishingFormatKey(variant,mediaTypes),kind=key&&connection.format_authorizations?.[key];
    const prepared=Boolean(state.pending||state.post_id||Object.keys(state.objects||{}).length);
    const sourceChanged=Boolean(key&&((state.format_authorization_kind&&state.format_authorization_kind!==kind)||(!state.format_authorization_kind&&prepared)));
    const extendedReadOnly=extendedInstagram&&!publishingFormatEnabled(variant,mediaTypes,connection.format_authorizations,switches());
    const formatReadOnly=videoReadOnly||extendedReadOnly||sourceChanged;
    if(extendedReadOnly&&!state.pending&&!state.post_id&&!state.objects?.container&&!Object.keys(state.objects||{}).some(k=>/^child_\d+$/.test(k)))throw new MetaError('instagram_extended_not_enabled');
    if(key&&formatReadOnly&&!prepared)throw new MetaError('format_execution_disabled');
    const checkpoint=(s:any)=>call(db,'marketing_job_checkpoint',{p_job:job.id,p_lease:job.lease_token,p_state:s});
    if(key&&!formatReadOnly&&!state.format_authorization_kind&&job.state!=='reconciling'){state.format_authorization_kind=kind;await checkpoint(state);}
    state.verified_assets||=[];
    // One immutable asset per tick bounds downloads. All bytes are validated before
    // the first Meta write; previews alone never establish publishing compatibility.
    const pinnedIds=publishingAssetIds(variant);
    const next=pinnedIds.find((id:string)=>!state.verified_assets.includes(id));
    if(next&&!formatReadOnly&&!job.provider_state?.pending&&!job.provider_state?.post_id&&job.state!=='reconciling') {
     const asset=assets.find((a:any)=>a.id===next);
     if(!asset||asset.size_bytes>(asset.mime_type==='video/mp4'?52428800:8388608))throw new MetaError('media_size_unsupported');
     await guard();const {data:blob,error}=await db.storage.from('marketing-media').download(asset.object_path);
     if(error||!blob||blob.size!==Number(asset.size_bytes))throw new MetaError('media_source_unavailable',false,true);
     const bytes=new Uint8Array(await blob.arrayBuffer()),coverAsset=variant.reel_cover?.mode==='image'&&next===variant.reel_cover.asset_id;
     verifyMetaMedia(bytes,asset.mime_type,job.channel,coverAsset?'reel_cover':variant.format);
     if(next===variant.asset_ids[0]&&variant.reel_cover?.mode==='frame')verifyCoverFrame(variant,bytes);
     state.verified_assets.push(next);await checkpoint(state);result={outcome:'waiting',code:'media_verifying'};
    } else {
     const mediaUrls=[];let coverUrl:string|undefined;
     // Do not request signed URLs while only reconciling an existing receipt.
     if(job.state!=='reconciling'&&!formatReadOnly&&!state.pending&&!state.post_id)for(const id of pinnedIds) {
      const asset=assets.find((a:any)=>a.id===id);if(!asset)throw new MetaError('media_source_unavailable');
      const {data,error}=await db.storage.from('marketing-media').createSignedUrl(asset.object_path,3600);
      if(error||!data)throw new MetaError('media_source_unavailable',false,true);if(variant.reel_cover?.mode==='image'&&id===variant.reel_cover.asset_id)coverUrl=data.signedUrl;else mediaUrls.push(data.signedUrl);
     }
     result=await advanceMetaPublish({graph,accountId:connection.provider_account_id,token,variant,mediaUrls,mediaTypes,coverUrl,state,checkpoint,guard:async()=>{await guard();},allowFacebookReceiptLookup:(postId)=>job.state!=='reconciling'||facebookReceiptRecoveryAllowed(job,env,Date.now(),postId),submissionGuard:async()=>{const fresh=await guard(true);if(!publishingFormatEnabled(variant,mediaTypes,fresh.format_authorizations,switches())||key&&fresh.format_authorizations?.[key]!==state.format_authorization_kind)throw new MetaError('format_execution_disabled');},reconcileOnly:job.state==='reconciling'||formatReadOnly});
    }
   }catch(error){result={outcome:error instanceof MetaError&&!error.uncertain?(error.retryable?'retryable_failure':'permanent_failure'):'uncertain',code:error instanceof MetaError?error.code:'publishing_authority_changed'};}
   if(job.state==='reconciling'&&result.outcome!=='published')result={outcome:'uncertain',code:result.code||'manual_reconciliation_required'};
   if(result.outcome==='waiting')await call(db,'marketing_defer_job',{p_job:job.id,p_lease:job.lease_token,p_seconds:60,p_code:result.code});
   else await call(db,'marketing_finish_job',{p_job:job.id,p_lease:job.lease_token,p_outcome:result.outcome,p_provider_post_id:result.postId||null,p_error_code:result.code||null});
   // Completed jobs release their lease before a bounded health turn. Slow jobs
   // leave health to an idle tick; health can never prevent the next job claim.
   if(Date.now()-started<15000)try{await checkHealth();}catch{console.warn('marketing_connection_health_pending');}
   await call(db,'marketing_worker_health',{p_completed:true});return reply({status:'processed',outcome:result.outcome});
  }
  // Reserve alternating idle minutes for existing health/Social/Ads/profile work.
  if(Math.floor(started/60000)%2===0&&await runInboxAutomatic(db,graph,env)){await call(db,'marketing_worker_health',{p_completed:true});return reply({status:'inbox_ai_turn'});}
  // Independent four-second profile read; failure never blocks message ingestion or publishing.
  try{await runInboxProfile(db,graph.withSignal(AbortSignal.timeout(4000)),[env('MARKETING_META_TOKEN_ENCRYPTION_KEY'),env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')]);}catch{console.warn('marketing_inbox_profile_pending');}
  // One API read per idle tick; publishing always claims first. A separate deadline
  // bounds follower work without consuming connection-health or publishing leases.
  try{const followerGraph=new MetaGraph({appId:env('MARKETING_META_APP_ID'),appSecret:env('MARKETING_META_APP_SECRET'),configId:env('MARKETING_META_LOGIN_CONFIG_ID'),version:env('MARKETING_META_GRAPH_VERSION')},fetch,undefined,AbortSignal.timeout(8000));await runCreatorFollowers(db,followerGraph,[env('MARKETING_META_TOKEN_ENCRYPTION_KEY'),env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')]);}catch{console.warn('marketing_creator_followers_pending');}
  // Publishing claims win; cleanup is bounded to three seconds on idle ticks.
  try{await cleanupTemporaryMedia(db,async(path,signal)=>{
   const response=await fetch(STAGING_SUPABASE+'/storage/v1/object/marketing-media',{method:'DELETE',headers:{Authorization:'Bearer '+env('SUPABASE_SERVICE_ROLE_KEY'),apikey:env('SUPABASE_SERVICE_ROLE_KEY'),'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]}),signal});
   if(!response.ok)throw new Error('cleanup_storage_pending');
  });}catch{console.warn('marketing_media_cleanup_pending');}
  const health=await checkHealth();
  if(health){await call(db,'marketing_worker_health',{p_completed:true});return reply({status:'connection_checked'});}
  // Reserve a bounded Ads reporting turn every five minutes, after publishing authority.
  if(new Date().getUTCMinutes()%5===0&&await processAdsSync(db,graph,env)){await call(db,'marketing_worker_health',{p_completed:true});return reply({status:'ads_synchronized'});}
  if(await runInboxHistory(db,graph,tokenFor)){await call(db,'marketing_worker_health',{p_completed:true});return reply({status:'history_import_page'});}
  const connection=await call(db,'marketing_meta_sync_claim');
  if(connection) {
   const guard=async()=>{if(!await call(db,'marketing_meta_sync_guard',{p_connection:connection.id,p_generation:connection.credential_generation,p_lease:connection.sync_lease}))throw new Error('synchronization_authority_changed');};
   let posts:any[]=[],after:string|null=null,errorCode:string|null=null,availability:any[]=[];
   try{const token=await tokenFor(connection);const result=await readMetaPosts(graph,connection,token,guard);posts=result.posts;after=result.after;const targets=await call(db,'marketing_meta_availability_targets',{p_connection:connection.id,p_generation:connection.credential_generation,p_lease:connection.sync_lease});availability=await observePostAvailability(graph,connection,token,posts,targets||[],guard);}catch(error){errorCode=error instanceof MetaError?error.code:'sync_unavailable';}
   await call(db,'marketing_meta_sync_finish',{p_connection:connection.id,p_generation:connection.credential_generation,p_lease:connection.sync_lease,p_posts:posts,p_after:after,p_error:errorCode,p_availability:availability});
  }
  const adsProcessed=connection?false:await processAdsSync(db,graph,env);
  await call(db,'marketing_worker_health',{p_completed:true});return reply({status:connection?'synchronized':adsProcessed?'ads_synchronized':'idle'});
 }catch{await call(db,'marketing_worker_health',{p_error:'worker_authority_or_network_failure'});return reply({error:'Worker needs investigation.'},503);}
});
