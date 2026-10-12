import {supabase} from '../../lib/supabase';
import {throwSupabaseError} from '../../services/supabaseError.js';
async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);throwSupabaseError(`marketing.${name}`,error);return data;}
// Adapters return verified stored evidence or an explicit unavailable result, never scraped guesses.
export const creatorPostAdapters={
 facebook:{mode:'authorized_meta_cache'},instagram:{mode:'authorized_meta_cache'},xhs:{mode:'manual'},tiktok:{mode:'manual'},
};
export const creatorService={
 read:(org,brand)=>rpc('marketing_creators_read',{p_org:org,p_brand:brand||null}),
 preview:(org,brand,url)=>rpc('marketing_creator_post_preview',{p_org:org,p_brand:brand,p_url:url}),
 command:({request,org,brand,action,id=null,revision=0,payload={}})=>rpc('marketing_creator_command',{p_request:request,p_org:org,p_brand:brand,p_action:action,p_id:id,p_revision:revision,p_payload:payload}),
};
