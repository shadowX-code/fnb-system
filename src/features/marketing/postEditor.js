import {publishingMediaEligible,isVideoFormat} from './publishingMedia.js';
export const POST_FORMATS={facebook:['text','image','carousel','video','reel'],instagram:['image','carousel','reel','story']};
export function variantIssues(variant,assets,brand) {
 const issues=[],ids=variant.asset_ids||[],limit=variant.channel==='instagram'?2200:63206;
 if(!POST_FORMATS[variant.channel]?.includes(variant.format))issues.push('This format is not supported for publishing on this channel. Choose another format.');
 if(!variant.caption?.trim())issues.push('Add a caption before submitting for review.');
 if(variant.caption?.length>limit)issues.push(`Shorten the caption to ${limit.toLocaleString('en-MY')} characters.`);
 if(variant.format==='text'&&ids.length)issues.push('Remove media from this text post.');
 if(['image','video','reel','story'].includes(variant.format)&&ids.length!==1)issues.push(`Choose one ${variant.format==='story'?'JPEG or MP4 Story':isVideoFormat(variant.format)?'MP4 video':'image'}.`);
 if(variant.format==='carousel'&&(ids.length<2||ids.length>10))issues.push('Choose 2–10 compatible items for the carousel.');
 for(const id of ids){const asset=assets.find(a=>a.id===id);
  if(!asset){issues.push('Selected media details are unavailable. Reopen the Media Library to verify the selection.');break;}
  if(asset.brand_id!==brand.id||asset.organization_id!==brand.organization_id||!publishingMediaEligible(asset,variant.format,variant.channel)){issues.push('Replace incompatible media. Use ready Brand images up to 8 MB (JPEG for Instagram), or an MP4 video up to 50 MB.');break;}
 }
 const cover=variant.reel_cover;
 if(cover&&cover.mode!=='automatic'){
  if(variant.channel!=='instagram'||variant.format!=='reel'||cover.video_asset_id!==ids[0])issues.push('Choose the cover again for this Instagram video.');
  if(cover.mode==='frame'&&(!Number.isSafeInteger(cover.offset_ms)||cover.offset_ms<0||cover.offset_ms>3600000))issues.push('Enter a valid cover frame time.');
  if(cover.mode==='image'){const image=assets.find(a=>a.id===cover.asset_id);if(!image||image.brand_id!==brand.id||image.organization_id!==brand.organization_id||!publishingMediaEligible(image,'reel_cover','instagram'))issues.push('Choose a ready Brand JPEG cover up to 8 MB.');}
 }
 return issues;
}
export function publishingAccount(variant,connections,brand,now=Date.now()) {
 return connections?.find(c=>c.brand_id===brand.id&&c.organization_id===brand.organization_id&&c.channel===variant.channel&&['test_authorized','production_authorized'].includes(c.status)&&Date.parse(c.expires_at)>now&&c.capabilities?.publishing&&c.capabilities?.formats?.includes(variant.format));
}

export function mediaMetadataIssues(variant,assets,observations){
 return [...(variant.asset_ids||[]),...(variant.reel_cover?.mode==='image'?[variant.reel_cover.asset_id]:[])].flatMap(id=>{const m=observations[id],a=assets.find(a=>a.id===id);if(!m?.width||!m.height||!a)return [];const ratio=m.width/m.height;
  if(variant.reel_cover?.mode==='image'&&id===variant.reel_cover.asset_id&&(m.width<540||m.width>1440||Math.abs(ratio-9/16)>.005))return ['Use a 9:16 JPEG cover, 540–1440 pixels wide.'];
  if(variant.reel_cover?.mode==='frame'&&id===variant.asset_ids[0]&&Number.isFinite(m.duration)&&variant.reel_cover.offset_ms>=m.duration*1000)return ['Choose a cover frame before the end of the video.'];
  if(variant.channel==='facebook'&&variant.format==='reel'&&(m.duration<4||m.duration>60||m.width<540||m.height<960||Math.abs(ratio-9/16)>.005))return [`${a.filename}: Facebook Reels require 9:16, at least 540×960 and 4–60 seconds.`];
  if(variant.channel==='instagram'&&variant.format==='story'&&(Math.abs(ratio-9/16)>.005||m.width<540||a.mime_type==='video/mp4'&&(m.duration<3||m.duration>60)))return [`${a.filename}: this Story subset requires 9:16, at least 540 pixels wide and 3–60 seconds for video.`];
  if(variant.channel==='instagram'&&variant.format==='carousel'&&a.mime_type==='video/mp4'&&(m.duration<3||m.duration>60||ratio<.8||ratio>1.91))return [`${a.filename}: carousel video requires 3–60 seconds and a 4:5–1.91:1 aspect ratio.`];
  return [];
 });
}
