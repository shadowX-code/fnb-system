import {supabase} from '../lib/supabase';
import {throwSupabaseError} from './supabaseError.js';
async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);throwSupabaseError(`platform.${name}`,error);return data;}
export const brandService={
 logoUrl:(path,version)=>{if(!path)return '';const {data}=supabase.storage.from('outlet-logos').getPublicUrl(path);return data?.publicUrl?`${data.publicUrl}?v=${version||''}`:'';},
 async uploadLogo(brand,revision,request,file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>2097152)throw new Error('Choose a PNG, JPG or WebP logo up to 2 MB.');
  const prepared=await rpc('platform_brand_logo_prepare',{p_brand:brand,p_revision:revision,p_request:request,p_filename:file.name,p_mime_type:file.type,p_size:file.size});
  const {error}=await supabase.storage.from(prepared.bucket).upload(prepared.object_path,file,{contentType:file.type,upsert:false});
  throwSupabaseError('brands.logo.upload',error);return prepared.id;
 },
 read:()=>rpc('platform_brand_management_read',{}),
 outletBrands:()=>rpc('platform_outlet_brands_read',{}),
 command:(command,scopeBrand,payload)=>rpc('platform_brand_command',{p_command:command,p_scope_brand:scopeBrand||null,p_payload:payload}),
};
export function mappingChanges(before=[],after=[]){return {added:after.filter(id=>!before.includes(id)),removed:before.filter(id=>!after.includes(id))};}

export function isQaOutlet(outlet){return /(^|[\s—_-])(qa|demo)(?=$|[\s—_-])/i.test(`${outlet.name||''} ${outlet.code||''}`);}
