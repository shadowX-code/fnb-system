import {instagramPngPreparation} from './publishingMedia.js';
import {prepareInstagramImage} from './instagramImagePreparation.js';
import {supabase} from '../../lib/supabase';
const base=`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketing-drive`;
async function command(action,organizationId,brandId,body={},signal){
 const {data,error}=await supabase.functions.invoke(`marketing-drive/${action}`,{body:{organizationId,brandId,...body},signal});
 if(error){let message='Media request could not be completed.';if(error.context instanceof Response)try{message=(await error.context.json()).error||message;}catch{}throw new Error(message);}return data;
}
const preparations=new Map();
async function prepareMedia(org,brand,asset,channel,format){
 if(!instagramPngPreparation(asset,format,channel))return asset;
 const key=JSON.stringify([org,brand,asset.id]);if(preparations.has(key))return preparations.get(key);
 const operation=(async()=>{
  const source=await command('image-source',org,brand,{assetId:asset.id});
  if(source.prepared)return source.prepared;
  const response=await fetch(source.url,{cache:'no-store'});if(!response.ok)throw new Error('The original image could not be read. Reopen the Media Library and try again.');
  const jpeg=await prepareInstagramImage(await response.blob());
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await jpeg.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
  const reserved=await command('prepare-image-upload',org,brand,{assetId:asset.id,size:jpeg.size,sha256});
  if(reserved.state==='ready')return reserved;
  if(reserved.source_metadata.output_sha256!==sha256)throw new Error('This image is being prepared in another session. Retry shortly.');
  const {error}=await supabase.storage.from('marketing-media').uploadToSignedUrl(reserved.object_path,reserved.upload_token,jpeg,{contentType:'image/jpeg'});
  // A duplicate object may be a completed upload with a lost acknowledgement. Only canonical
  // byte verification can acknowledge it; never overwrite an existing object.
  if(error&&!['409','400'].includes(String(error.statusCode)))throw new Error('Prepared image upload failed. Your original is unchanged. Retry media preparation.');
  return command('finalize-image-upload',org,brand,{assetId:asset.id,preparedId:reserved.id});
 })();preparations.set(key,operation);
 try{return await operation;}finally{preparations.delete(key);}
}
export const driveService={
 prepareMedia,
 async configuration(){const response=await fetch(base+'/configuration',{cache:'no-store'});if(!response.ok)throw new Error('Google Drive configuration unavailable.');return response.json();},
 context:(org,brand)=>command('context',org,brand),
 authorize:org=>command('authorize',org,null),disconnect:org=>command('disconnect',org,null),
 folders:(org,body)=>command('folders',org,null,body),map:(org,brand,body)=>command('map',org,brand,{...body,confirmOwnership:true}),
 browse:(org,brand,{signal,...body})=>command('browse',org,brand,body,signal),async preview(org,brand,file,{representation,signal}={}){
  const {data,error}=await supabase.auth.getSession();if(error||!data.session)throw new Error('Sign in again.');
  const response=await fetch(base+'/preview',{method:'POST',headers:{Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({organizationId:org,brandId:brand,fileId:file.selection_id||file.id,version:file.version,representation}),signal,cache:'no-store'});
  if(!response.ok){let message='Media preview unavailable.';try{message=(await response.json()).error||message;}catch{}throw new Error(message);}return response.blob();
 },
 async import(org,brand,file,channel,format){const convert=instagramPngPreparation({mime_type:file.mimeType},format,channel);const asset=await command('import',org,brand,{fileId:file.selection_id||file.id,version:file.version,channel:convert?undefined:channel,...(format==='reel_cover'?{format}:{})});return prepareMedia(org,brand,asset,channel,format);},
 async upload(org,brand,file,channel,format){
  if(!['image/jpeg','image/png','image/webp','video/mp4','application/pdf'].includes(file.type)||file.size<1||file.size>104857600)throw new Error('Use JPG, PNG, WebP, MP4 or PDF up to 100 MB.');
  const asset=await command('prepare-upload',org,brand,{filename:file.name,mime:file.type,size:file.size});
  const {error}=await supabase.storage.from('marketing-media').upload(asset.object_path,file,{contentType:file.type,upsert:false});if(error)throw new Error('Media upload failed. Try again.');
  const convert=instagramPngPreparation({mime_type:file.type},format,channel);
  const original=await command('finalize-upload',org,brand,{assetId:asset.id,channel:convert?undefined:channel,...(format==='reel_cover'?{format}:{})});
  return prepareMedia(org,brand,original,channel,format);
 }
};
