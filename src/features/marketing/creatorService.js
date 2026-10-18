import {creatorAccountConflict} from './creatorProfiles.js';
import {redactUrlQueries} from '../../../server/creatorExtraction/urls.mjs';
import {supabase} from '../../lib/supabase';
import {throwSupabaseError} from '../../services/supabaseError.js';
async function rpc(name,args){
 const controller=new AbortController();let timer;
 try{const {data,error}=await Promise.race([supabase.rpc(name,args).abortSignal(controller.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('The request took too long. Your edits are kept. Retry to check the same save safely.'))},30000)})]);const conflict=creatorAccountConflict(error);if(conflict){const problem=new Error(error.message);problem.identityConflict=conflict;throw problem;}throwSupabaseError(`marketing.${name}`,error?{code:error.code,message:redactUrlQueries(error.message),details:redactUrlQueries(error.details),hint:redactUrlQueries(error.hint)}:null);return data;}finally{clearTimeout(timer)}
}
// Public extraction retains field evidence; authorized Meta fallback stays read-only.
export const creatorPostAdapters={
 facebook:{mode:'public_inspection',fallback:'authorized_meta_cache'},instagram:{mode:'public_inspection',fallback:'authorized_meta_cache'},xhs:{mode:'public_inspection',fallback:'manual'},tiktok:{mode:'public_inspection',fallback:'manual'},
};
export const creatorService={
 followersStatus:(org,account)=>rpc('marketing_creator_followers_status',{p_org:org,p_account:account}),
 refreshFollowers:(org,account)=>rpc('marketing_creator_followers_refresh',{p_org:org,p_account:account}),
 manualPreview:(org,brand,url)=>rpc('marketing_creator_post_preview',{p_org:org,p_brand:brand,p_url:url}),
 directory:(org)=>rpc('marketing_creator_directory',{p_org:org,p_brand:null}),
 history:(org,post,after=null)=>rpc('marketing_creator_metric_history',{p_org:org,p_post:post,p_after:after,p_size:25}),
 read:(org,brand)=>rpc('marketing_creator_workspace',{p_org:org,p_brand:brand||null}),
 profile:async(org,brand,url,{officialOnly=false}={})=>{
 const {data:{session}}=await supabase.auth.getSession();
 const response=await fetch('/api/marketing-creator-inspect',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(session?.access_token||'')},body:JSON.stringify({org,brand,url,kind:'profile',...(officialOnly?{officialOnly:true}:{})})});
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
