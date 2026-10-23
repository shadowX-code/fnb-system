import {publishingMediaEligible,isVideoFormat} from './publishingMedia.js';
export const POST_FORMATS={facebook:['text','image','carousel','video','reel'],instagram:['image','carousel','reel']};
export function variantIssues(variant,assets,brand) {
 const issues=[],ids=variant.asset_ids||[],limit=variant.channel==='instagram'?2200:63206;
 if(!POST_FORMATS[variant.channel]?.includes(variant.format))issues.push('This format is not supported for publishing on this channel. Choose another format.');
 if(!variant.caption?.trim())issues.push('Add a caption before submitting for review.');
 if(variant.caption?.length>limit)issues.push(`Shorten the caption to ${limit.toLocaleString('en-MY')} characters.`);
 if(variant.format==='text'&&ids.length)issues.push('Remove media from this text post.');
 if(['image','video','reel'].includes(variant.format)&&ids.length!==1)issues.push(`Choose one ${isVideoFormat(variant.format)?'MP4 video':'image'}.`);
 if(variant.format==='carousel'&&(ids.length<2||ids.length>10))issues.push('Choose 2–10 images for the carousel.');
 for(const id of ids){const asset=assets.find(a=>a.id===id);
  if(!asset){issues.push('Selected media details are unavailable. Reopen the Media Library to verify the selection.');break;}
  if(asset.brand_id!==brand.id||asset.organization_id!==brand.organization_id||!publishingMediaEligible(asset,variant.format,variant.channel)){issues.push('Replace incompatible media. Use ready Brand images up to 8 MB (JPEG for Instagram), or an MP4 video up to 50 MB.');break;}
 }
 return issues;
}
export function publishingAccount(variant,connections,brand,now=Date.now()) {
 return connections?.find(c=>c.brand_id===brand.id&&c.organization_id===brand.organization_id&&c.channel===variant.channel&&['test_authorized','production_authorized'].includes(c.status)&&Date.parse(c.expires_at)>now&&c.capabilities?.publishing&&c.capabilities?.formats?.includes(variant.format));
}
