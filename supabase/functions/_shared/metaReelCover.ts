import {MetaError} from './metaGraph.ts';
import {verifyFacebookVideo} from './metaVideoMedia.ts';
export type ReelCover={mode:'automatic'}|{mode:'frame';video_asset_id:string;offset_ms:number}|{mode:'image';video_asset_id:string;asset_id:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateReelCover(v:{channel:string;format:string;asset_ids:string[];reel_cover?:ReelCover}):ReelCover|undefined {
 const c=v.reel_cover;if(c===undefined)return;
 if(!c||typeof c!=='object'||Array.isArray(c))throw new MetaError('reel_cover_invalid');
 const keys=Object.keys(c).sort().join(',');
 if(c.mode==='automatic'&&keys==='mode'&&v.format==='reel')return c;
 if(v.channel!=='instagram'||v.format!=='reel'||v.asset_ids.length!==1||!uuid.test(v.asset_ids[0])||!('video_asset_id' in c)||c.video_asset_id!==v.asset_ids[0])throw new MetaError('reel_cover_identity_or_format_invalid');
 if(c.mode==='frame'&&keys==='mode,offset_ms,video_asset_id'&&Number.isSafeInteger(c.offset_ms)&&c.offset_ms>=0&&c.offset_ms<=3600000)return c;
 if(c.mode==='image'&&keys==='asset_id,mode,video_asset_id'&&uuid.test(c.asset_id)&&c.asset_id!==c.video_asset_id)return c;
 throw new MetaError('reel_cover_invalid');
}
export function publishingAssetIds(v:{channel:string;format:string;asset_ids:string[];reel_cover?:ReelCover}):string[]{
 const cover=validateReelCover(v);return [...new Set([...v.asset_ids,...(cover?.mode==='image'?[cover.asset_id]:[])])];
}
export function verifyCoverFrame(v:{channel:string;format:string;asset_ids:string[];reel_cover?:ReelCover},bytes:Uint8Array):void {
 const cover=validateReelCover(v);if(cover?.mode==='frame'&&cover.offset_ms>=verifyFacebookVideo(bytes,'video').duration*1000)throw new MetaError('reel_cover_frame_outside_video');
}
export function reelCoverParameters(v:{channel:string;format:string;asset_ids:string[];reel_cover?:ReelCover},coverUrl?:string):Record<string,string|number>{
 const cover=validateReelCover(v);
 if(cover?.mode==='frame')return {thumb_offset:cover.offset_ms};
 if(cover?.mode==='image'){
  if(!coverUrl||!/^https:\/\//.test(coverUrl))throw new MetaError('reel_cover_source_unavailable');
  return {cover_url:coverUrl};
 }return {};
}
