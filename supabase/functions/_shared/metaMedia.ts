import {MetaError} from './metaGraph.ts';
import {verifyFacebookVideo} from './metaVideoMedia.ts';
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
 if(format==='reel_cover'&&(channel!=='instagram'||mime!=='image/jpeg'))throw new MetaError('reel_cover_requires_jpeg');
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
  if(!dimensions||['story','reel_cover'].includes(format||'')&&dimensions.width<540||dimensions.width<320||dimensions.width>1440||(['story','reel_cover'].includes(format||'')?Math.abs(dimensions.width/dimensions.height-9/16)>.005:dimensions.width/dimensions.height<0.8||dimensions.width/dimensions.height>1.91))throw new MetaError('instagram_image_dimensions_unsupported');
 }
}
