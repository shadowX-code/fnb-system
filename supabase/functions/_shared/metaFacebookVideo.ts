import {MetaError,MetaGraph} from './metaGraph.ts';
import type {MetaVariant,MetaLedger,MetaPublishResult} from './metaPublishing.ts';
const numeric=(id:unknown)=>typeof id==='string'&&/^\d{1,30}$/.test(id);
// Meta Video and Reel writes return different receipts. Persist intent before each
// write; only an exact Page-owned published video + provider post ID can complete.
export async function advanceFacebookVideo(input:{graph:MetaGraph;accountId:string;token:string;variant:MetaVariant;mediaUrls:string[];state:MetaLedger;checkpoint:(s:MetaLedger)=>Promise<void>;guard:()=>Promise<void>;submissionGuard?:()=>Promise<void>;allowFacebookReceiptLookup?:(postId?:string)=>boolean;reconcileOnly?:boolean}):Promise<MetaPublishResult>{
 const {graph,accountId,token,variant:v,guard,checkpoint}=input,s=structuredClone(input.state);
 s.objects||={};s.started_at||=new Date().toISOString();
 const writeGraph=input.submissionGuard?graph.withWriteGuard(input.submissionGuard):null;
 const video=s.objects.fb_video,finished=Boolean(s.objects.fb_finish),publishingPending=['fb_finish','fb_publish'].includes(s.pending||'');
 const uncertain=(code:string):MetaPublishResult=>({outcome:'uncertain',code});
 async function write(operation:string,action:()=>Promise<any>,receipt:(r:any)=>string|null):Promise<MetaPublishResult>{
  let providerCall=false;
  try{
   // Reads may reconcile after revocation; every new provider write requires a fresh database authorization.
   if(!input.submissionGuard||!writeGraph)throw new MetaError('facebook_video_authorization_required');
   await input.submissionGuard();s.pending=operation;await checkpoint(s);await input.submissionGuard();providerCall=true;const result=await action();providerCall=false;const id=receipt(result);
   if(!id)return uncertain('facebook_video_write_evidence_missing');
   if(operation==='fb_start'||operation==='fb_video_upload')s.objects!.fb_video=id;
   else s.objects![operation==='fb_reel_upload'?'fb_uploaded':'fb_finish']=id;
   delete s.pending;await checkpoint(s);return {outcome:'waiting',code:'facebook_video_preparing'};
  }catch(error){if(providerCall&&error instanceof MetaError&&!error.uncertain){delete s.pending;await checkpoint(s);return {outcome:error.retryable?'retryable_failure':'permanent_failure',code:error.code};}return uncertain('meta_write_response_uncertain');}
 }
 if(!video){
  if(s.pending||input.reconcileOnly)return uncertain('meta_write_response_uncertain');
  if(input.mediaUrls.length!==1)return {outcome:'permanent_failure',code:'facebook_video_requires_one_asset'};
  return v.format==='reel'?write('fb_start',()=>writeGraph!.request(`${accountId}/video_reels`,token,{upload_phase:'start'},'POST'),r=>numeric(r.video_id)?r.video_id:null)
   :write('fb_video_upload',()=>writeGraph!.request(`${accountId}/videos`,token,{file_url:input.mediaUrls[0],description:v.caption,published:false},'POST'),r=>numeric(r.id)?r.id:null);
 }
 if(!numeric(video))return uncertain('facebook_video_identity_mismatch');
 // Unknown upload/start writes are never repeated, even if the worker restarts.
 if(s.pending&&!publishingPending)return uncertain('meta_write_response_uncertain');
 let evidence:any;
 try{await guard();evidence=await graph.request(video,token,{fields:'id,from,published,post_id,status'});}
 catch(error){return finished||s.pending||s.post_id?uncertain('facebook_video_receipt_unavailable'):{outcome:error instanceof MetaError&&!error.uncertain&&!error.retryable?'permanent_failure':'retryable_failure',code:error instanceof MetaError?error.code:'facebook_video_status_unavailable'};}
 if(evidence.id!==video||evidence.from?.id!==accountId)return uncertain('facebook_video_identity_mismatch');
 if(evidence.published===true&&evidence.status?.video_status==='ready'){
  if(!finished&&!publishingPending&&!s.post_id)return uncertain('facebook_video_publication_unexpected');
  let post=evidence.post_id,receiptSource='video_post_id' as 'video_post_id'|'page_posts_video_permalink';
  const ownedPost=(id:unknown):id is string=>typeof id==='string'&&id.startsWith(accountId+'_')&&/^\d+_\d+$/.test(id);
  if(!ownedPost(post)){
   // A conflicting explicit Page post must never be replaced by a guessed identity.
   if(typeof post==='string'&&/^\d+_\d+$/.test(post))return uncertain('facebook_video_identity_mismatch');
   if(!input.allowFacebookReceiptLookup?.())return uncertain('facebook_video_post_receipt_missing');
   let posts:any;
   try{await guard();if(!input.allowFacebookReceiptLookup?.())return uncertain('facebook_video_post_receipt_missing');posts=await graph.request(`${accountId}/posts`,token,{fields:'id,permalink_url',limit:25});}
   catch(error){return uncertain(error instanceof MetaError?error.code:'facebook_video_post_receipt_unavailable');}
   if(!Array.isArray(posts?.data)||posts.data.length>25)return uncertain('facebook_video_post_receipt_unavailable');
   const matches=posts.data.filter((row:any)=>{
    if(typeof row?.permalink_url!=='string'||row.permalink_url.length>2048)return false;
    try{const url=new URL(row.permalink_url);return url.protocol==='https:'&&['facebook.com','www.facebook.com'].includes(url.hostname)
     &&!url.username&&!url.password&&!url.port&&url.pathname.replace(/\/$/,'')===`/reel/${video}`;}catch{return false;}
   });
   if(matches.some((row:any)=>!ownedPost(row.id)))return uncertain('facebook_video_identity_mismatch');
   const ids=[...new Set(matches.map((row:any)=>row.id))];
   if(ids.length!==1)return uncertain(ids.length?'facebook_video_post_receipt_ambiguous':'facebook_video_post_receipt_missing');
   post=ids[0];
   if(!input.allowFacebookReceiptLookup?.(post))return uncertain('facebook_video_post_receipt_mismatch');
   receiptSource='page_posts_video_permalink';
  }
  if(s.post_id&&s.post_id!==post)return uncertain('facebook_video_identity_mismatch');
  // A retained video ID allows read-only recovery of a lost finish response.
  s.facebook_receipt={source:receiptSource,video_id:video,post_id:post,video_post_id:typeof evidence.post_id==='string'&&/^\d+(?:_\d+)?$/.test(evidence.post_id)&&evidence.post_id.length<=61?evidence.post_id:null};
  s.post_id=post;delete s.pending;await checkpoint(s);return {outcome:'published',postId:post};
 }
 if(s.post_id||s.pending||input.reconcileOnly)return uncertain('facebook_video_publication_unverified');
 const status=evidence.status;
 if(['error','upload_failed','expired'].includes(status?.video_status)||status?.processing_phase?.status==='error'||status?.publishing_phase?.status==='error')return finished?uncertain('facebook_video_publication_unverified'):{outcome:'permanent_failure',code:'facebook_video_rejected'};
 if(!finished&&v.format==='reel'&&!s.objects.fb_uploaded){
  if(input.mediaUrls.length!==1)return {outcome:'permanent_failure',code:'facebook_video_requires_one_asset'};
  return write('fb_reel_upload',()=>writeGraph!.uploadReel(video,token,input.mediaUrls[0]),r=>r.success===true?video:null);
 }
 if(!finished&&(v.format==='video'?status?.video_status==='ready':status?.uploading_phase?.status==='complete')){
  return v.format==='reel'?write('fb_finish',()=>writeGraph!.request(`${accountId}/video_reels`,token,{upload_phase:'finish',video_id:video,video_state:'PUBLISHED',description:v.caption},'POST'),r=>r.success===true?video:null)
   :write('fb_publish',()=>writeGraph!.request(video,token,{published:true},'POST'),r=>r.success===true||r.id===video?video:null);
 }
 s.polls=(s.polls||0)+1;await checkpoint(s);
 if(s.polls>60||Date.now()-Date.parse(s.started_at!)>3600000)return finished?uncertain('facebook_video_publication_unverified'):{outcome:'permanent_failure',code:'facebook_video_processing_expired'};
 return {outcome:'waiting',code:'facebook_video_processing'};
}
