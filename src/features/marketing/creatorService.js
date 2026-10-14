import {supabase} from '../../lib/supabase';
import {throwSupabaseError} from '../../services/supabaseError.js';
async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);throwSupabaseError(`marketing.${name}`,error);return data;}
// Public extraction retains field evidence; authorized Meta fallback stays read-only.
export const creatorPostAdapters={
 facebook:{mode:'public_inspection',fallback:'authorized_meta_cache'},instagram:{mode:'public_inspection',fallback:'authorized_meta_cache'},xhs:{mode:'public_inspection',fallback:'manual'},tiktok:{mode:'public_inspection',fallback:'manual'},
};
export const creatorService={
 directory:(org)=>rpc('marketing_creator_directory',{p_org:org,p_brand:null}),
 history:(org,post,after=null)=>rpc('marketing_creator_metric_history',{p_org:org,p_post:post,p_after:after,p_size:25}),
 read:(org,brand)=>rpc('marketing_creator_workspace',{p_org:org,p_brand:brand||null}),
 profile:async(org,brand,url)=>{
 const {data:{session}}=await supabase.auth.getSession();
 const response=await fetch('/api/marketing-creator-inspect',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(session?.access_token||'')},body:JSON.stringify({org,brand,url,kind:'profile'})});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Profile details unavailable.');return data;
 },
 preview:async(org,brand,url)=>{
 const {data:{session}}=await supabase.auth.getSession();
 const response=await fetch('/api/marketing-creator-inspect',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(session?.access_token||'')},body:JSON.stringify({org,brand,url})});
 if(!response.ok){const problem=await response.json().catch(()=>({}));const fallback=await rpc('marketing_creator_post_preview',{p_org:org,p_brand:brand,p_url:url});return {...fallback,message:problem.error||'Extraction unavailable. Manual entry remains available.'};}
 return response.json();
 },
 command:({request,org,brand,action,id=null,revision=0,payload={}})=>rpc('marketing_creator_command',{p_request:request,p_org:org,p_brand:brand,p_action:action,p_id:id,p_revision:revision,p_payload:payload}),
};
