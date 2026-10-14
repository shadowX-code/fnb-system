import {supabase} from '../../lib/supabase';
const base=`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketing-drive`;
async function command(action,organizationId,brandId,body={}){
 const {data,error}=await supabase.functions.invoke(`marketing-drive/${action}`,{body:{organizationId,brandId,...body}});
 if(error){let message='Media request could not be completed.';if(error.context instanceof Response)try{message=(await error.context.json()).error||message;}catch{}throw new Error(message);}return data;
}
export const driveService={
 async configuration(){const response=await fetch(base+'/configuration',{cache:'no-store'});if(!response.ok)throw new Error('Google Drive configuration unavailable.');return response.json();},
 context:(org,brand)=>command('context',org,brand),
 authorize:org=>command('authorize',org,null),disconnect:org=>command('disconnect',org,null),
 folders:(org,body)=>command('folders',org,null,body),map:(org,brand,body)=>command('map',org,brand,{...body,confirmOwnership:true}),
 browse:(org,brand,body)=>command('browse',org,brand,body),async preview(org,brand,file,{representation,signal}={}){
  const {data,error}=await supabase.auth.getSession();if(error||!data.session)throw new Error('Sign in again.');
  const response=await fetch(base+'/preview',{method:'POST',headers:{Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({organizationId:org,brandId:brand,fileId:file.selection_id||file.id,version:file.version,representation}),signal,cache:'no-store'});
  if(!response.ok){let message='Media preview unavailable.';try{message=(await response.json()).error||message;}catch{}throw new Error(message);}return response.blob();
 },
 import:(org,brand,file,channel)=>command('import',org,brand,{fileId:file.selection_id||file.id,version:file.version,channel}),
 async upload(org,brand,file,channel){
  if(!['image/jpeg','image/png','image/webp','video/mp4'].includes(file.type)||file.size<1||file.size>104857600)throw new Error('Use JPG, PNG, WebP or MP4 up to 100 MB.');
  const asset=await command('prepare-upload',org,brand,{filename:file.name,mime:file.type,size:file.size});
  const {error}=await supabase.storage.from('marketing-media').upload(asset.object_path,file,{contentType:file.type,upsert:false});if(error)throw new Error('Media upload failed. Try again.');
  return command('finalize-upload',org,brand,{assetId:asset.id,channel});
 }
};
