import {verifyFacebookVideo} from './metaVideoMedia.ts';
import {advanceFacebookVideo} from './metaFacebookVideo.ts';
import { MetaError, MetaGraph } from './metaGraph.ts';
export type MetaVariant={channel:'facebook'|'instagram';format:string;caption:string;asset_ids:string[]};
export type MetaLedger={pending?:string;objects?:Record<string,string>;post_id?:string;polls?:number;started_at?:string;facebook_receipt?:{source:'video_post_id'|'page_posts_video_permalink';video_id:string;post_id:string;video_post_id:string|null}};
export type MetaPublishResult={outcome:'published';postId:string}|{outcome:'waiting';code:string}|{outcome:'uncertain'|'retryable_failure'|'permanent_failure';code:string};
// Each invocation advances one durable operation. No in-memory polling or blind POST retries.
export async function advanceMetaPublish(input:{graph:MetaGraph;accountId:string;token:string;variant:MetaVariant;mediaUrls:string[];mediaTypes?:string[];state:MetaLedger;checkpoint:(s:MetaLedger)=>Promise<void>;guard:()=>Promise<void>;submissionGuard?:()=>Promise<void>;allowFacebookReceiptLookup?:(postId?:string)=>boolean;reconcileOnly?:boolean}):Promise<MetaPublishResult> {
 const {graph,accountId,token,variant:v,mediaUrls,checkpoint,guard}=input;
 if(v.channel==='facebook'&&['video','reel'].includes(v.format))return advanceFacebookVideo(input);
 const s:MetaLedger=structuredClone(input.state);s.objects||={};s.started_at||=new Date().toISOString();
 const read=async(id:string,params:any)=>{await guard();return graph.request(id,token,params);};
 if(s.post_id) {
  try {const receipt=await read(s.post_id,{fields:'id'});return String(receipt.id)===s.post_id?{outcome:'published',postId:s.post_id}:{outcome:'uncertain',code:'receipt_identity_mismatch'};}
  catch{return {outcome:'uncertain',code:'receipt_verification_unavailable'};}
 }
 if(s.pending) {
  // An accepted write may have lost its response. Even a FINISHED container does not
  // prove a timed-out media_publish was rejected; never send it again automatically.
  if(v.channel==='instagram'&&s.objects.container) {
   try {const status=await read(s.objects.container,{fields:'status_code'});return {outcome:'uncertain',code:status.status_code==='PUBLISHED'?'published_receipt_unavailable':'meta_write_response_uncertain'};}
   catch {/* Keep the durable uncertainty. */}
  }
  return {outcome:'uncertain',code:'meta_write_response_uncertain'};
 }
 if(input.reconcileOnly)return {outcome:'uncertain',code:'manual_reconciliation_required'};
 async function write(operation:string,path:string,params:any):Promise<MetaPublishResult> {
  let providerCall=false;
  try {
   await guard();s.pending=operation;await checkpoint(s);
   await guard();providerCall=true;const result=await graph.request(path,token,params,'POST');providerCall=false;
   if(!/^\d+(?:_\d+)?$/.test(String(result.id)))return {outcome:'uncertain',code:'missing_provider_evidence'};
   if(operation==='publish')s.post_id=String(result.id);else s.objects![operation]=String(result.id);
   delete s.pending;await checkpoint(s);
   return s.post_id?{outcome:'published',postId:s.post_id}:{outcome:'waiting',code:'media_preparing'};
  } catch(error) {
   if(providerCall&&error instanceof MetaError&&!error.uncertain) {
    // A definite API rejection permits retry; an interrupted checkpoint does not.
    delete s.pending;await checkpoint(s);
    return {outcome:error.retryable?'retryable_failure':'permanent_failure',code:error.code};
   }
   return {outcome:'uncertain',code:'meta_write_response_uncertain'};
  }
 }
 if(v.channel==='facebook') {
  if(!['text','image','carousel'].includes(v.format))return {outcome:'permanent_failure',code:'facebook_format_unavailable'};
  for(let i=0;i<mediaUrls.length;i++)if(!s.objects[`photo_${i}`])return write(`photo_${i}`,`${accountId}/photos`,{url:mediaUrls[i],published:false});
  return write('publish',`${accountId}/feed`,{message:v.caption,...(mediaUrls.length?{attached_media:mediaUrls.map((_,i)=>({media_fbid:s.objects![`photo_${i}`]}))}:{})});
 }
 if(!['image','carousel','reel','story'].includes(v.format))return {outcome:'permanent_failure',code:'instagram_format_unavailable'};
 if(v.format==='carousel') {
  for(let i=0;i<mediaUrls.length;i++)if(!s.objects[`child_${i}`])return write(`child_${i}`,`${accountId}/media`,input.mediaTypes?.[i]==='video/mp4'?{media_type:'VIDEO',video_url:mediaUrls[i],is_carousel_item:true}:{image_url:mediaUrls[i],is_carousel_item:true});
  for(let i=0;i<mediaUrls.length;i++)if(input.mediaTypes?.[i]==='video/mp4'&&!s.objects[`ready_${i}`]){
   try{const status=await read(s.objects[`child_${i}`],{fields:'status_code'});if(status.status_code==='FINISHED'){s.objects[`ready_${i}`]=s.objects[`child_${i}`];await checkpoint(s);return {outcome:'waiting',code:'carousel_child_ready'};}if(['ERROR','EXPIRED'].includes(status.status_code))return {outcome:'permanent_failure',code:'meta_media_rejected'};if(status.status_code==='PUBLISHED')return {outcome:'uncertain',code:'unexpected_child_publication'};s.polls=(s.polls||0)+1;await checkpoint(s);return s.polls>60||Date.now()-Date.parse(s.started_at!)>3600000?{outcome:'permanent_failure',code:'meta_media_processing_expired'}:{outcome:'waiting',code:'carousel_child_processing'};}catch(error){return {outcome:error instanceof MetaError&&!error.uncertain&&!error.retryable?'permanent_failure':'retryable_failure',code:error instanceof MetaError?error.code:'meta_status_unavailable'};}
  }
  if(!s.objects.container)return write('container',`${accountId}/media`,{media_type:'CAROUSEL',children:mediaUrls.map((_,i)=>s.objects![`child_${i}`]),caption:v.caption});
 } else if(!s.objects.container) return write('container',`${accountId}/media`,v.format==='story'?{media_type:'STORIES',...(input.mediaTypes?.[0]==='video/mp4'?{video_url:mediaUrls[0]}:{image_url:mediaUrls[0]})}:v.format==='reel'?{media_type:'REELS',video_url:mediaUrls[0],caption:v.caption,share_to_feed:true}:{image_url:mediaUrls[0],caption:v.caption});
 try {
  const status=await read(s.objects.container,{fields:'status_code'});
  if(status.status_code==='FINISHED')return write('publish',`${accountId}/media_publish`,{creation_id:s.objects.container});
  if(status.status_code==='PUBLISHED')return {outcome:'uncertain',code:'published_receipt_unavailable'};
  if(['ERROR','EXPIRED'].includes(status.status_code))return {outcome:'permanent_failure',code:'meta_media_rejected'};
  s.polls=(s.polls||0)+1;await checkpoint(s);
  if(s.polls>60||Date.now()-Date.parse(s.started_at!)>3600000)return {outcome:'permanent_failure',code:'meta_media_processing_expired'};
  return {outcome:'waiting',code:'meta_media_processing'};
 } catch(error) {return {outcome:error instanceof MetaError&&!error.uncertain&&!error.retryable?'permanent_failure':'retryable_failure',code:error instanceof MetaError?error.code:'meta_status_unavailable'};}
}
export function testAccountEnabled(accountId:string,allowlist:string):boolean {
 return /^\d+$/.test(accountId)&&allowlist.split(',').map(s=>s.trim()).filter(s=>/^\d+$/.test(s)).includes(accountId);
}
// Check bytes, not browser MIME assertions. Instagram images currently use this
// adapter's conservative JPEG subset; other library formats remain previewable.
export function verifyMetaMedia(bytes:Uint8Array,mime:string,channel:string,format?:string):void {
 const signature=mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
 mime==='image/png'?[137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x):
 mime==='image/webp'?new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP':
 mime==='video/mp4'?new TextDecoder().decode(bytes.slice(4,8))==='ftyp':false;
 if(!signature||!bytes.length||bytes.length>104857600)throw new MetaError('media_bytes_invalid');
 if(channel==='facebook'&&['video','reel'].includes(format||'')){if(mime!=='video/mp4'||bytes.length>52428800)throw new MetaError('facebook_video_requires_mp4_under_50mb');verifyFacebookVideo(bytes,format!);}
 if(channel==='instagram'&&mime==='video/mp4'&&['carousel','story'].includes(format||'')){
  if(bytes.length>52428800)throw new MetaError('instagram_video_size_unsupported');const m=verifyFacebookVideo(bytes,'video');const ratio=m.width/m.height;
  if(m.duration<3||m.duration>60||m.width>1920||(format==='story'?(Math.abs(ratio-9/16)>.005||m.width<540):ratio<.8||ratio>1.91))throw new MetaError('instagram_extended_video_dimensions_or_duration_unsupported');
 }
 if(channel==='instagram'&&mime.startsWith('image/')) {
  if(mime!=='image/jpeg'||bytes.length>8388608)throw new MetaError('instagram_requires_jpeg_under_8mb');
  let offset=2,dimensions:{width:number;height:number}|null=null;
  while(offset+8<bytes.length) {
   if(bytes[offset++]!==255)break;
   let marker=bytes[offset++];while(marker===255)marker=bytes[offset++];
   if(marker===217||marker===218)break;
   const length=(bytes[offset]<<8)|bytes[offset+1];if(length<2||offset+length>bytes.length)break;
   if([192,193,194].includes(marker)){dimensions={height:(bytes[offset+3]<<8)|bytes[offset+4],width:(bytes[offset+5]<<8)|bytes[offset+6]};break;}
   offset+=length;
  }
  if(!dimensions||format==='story'&&dimensions.width<540||dimensions.width<320||dimensions.width>1440||(format==='story'?Math.abs(dimensions.width/dimensions.height-9/16)>.005:dimensions.width/dimensions.height<0.8||dimensions.width/dimensions.height>1.91))throw new MetaError('instagram_image_dimensions_unsupported');
 }
}
