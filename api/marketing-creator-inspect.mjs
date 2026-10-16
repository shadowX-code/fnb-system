import {callReader} from '../server/xhsReaderPilot/client.mjs';
import {inspectProfile,profileIdentity} from '../server/creatorExtraction/profiles.mjs';
import {inspectPublic} from '../server/creatorExtraction/inspect.mjs';
import {platformUrl} from '../server/creatorExtraction/urls.mjs';
const STAGING='https://ujkzdaaadnvcfayuldmh.supabase.co';
export const config={maxDuration:60};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
 if(process.env.VITE_SUPABASE_URL!==STAGING||process.env.VERCEL_PROJECT_ID&&process.env.VERCEL_PROJECT_ID!=='prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi'||process.env.VERCEL_GIT_COMMIT_REF&&process.env.VERCEL_GIT_COMMIT_REF!=='dev')return res.status(403).json({error:'Staging extractor only.'});
 if(!/^Bearer [\w.-]+$/.test(req.headers.authorization||''))return res.status(401).json({error:'Sign in to inspect a post.'});
 let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body}catch{return res.status(400).json({error:'Invalid request.'})}
 if(!body||JSON.stringify(body).length>5000||!/^[-\da-f]{36}$/i.test(body.org||'')||!/^[-\da-f]{36}$/i.test(body.brand||''))return res.status(400).json({error:'Choose an authorized Brand and post URL.'});
 let lease;
 async function rpc(name,args){const r=await fetch(STAGING+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:process.env.VITE_SUPABASE_ANON_KEY||'',Authorization:req.headers.authorization,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(r.status===401?'signed_out':'access_or_limit');return r.json()}
 const scope={p_org:body.org,p_brand:body.brand};
 try{
  const profileMode=body.kind==='profile';
  const input=profileMode?profileIdentity(body.url):platformUrl(body.url);
  if(profileMode){
   await rpc('marketing_creator_directory',scope);
   if(input.platform==='instagram'){
    const official=await fetch(STAGING+'/functions/v1/marketing-meta/creator-profile',{method:'POST',headers:{apikey:process.env.VITE_SUPABASE_ANON_KEY||'',Authorization:req.headers.authorization,'Content-Type':'application/json'},body:JSON.stringify({org:body.org,brand:body.brand,handle:input.handle}),signal:AbortSignal.timeout(30000)});
    if(!official.ok)throw new Error('official_profile_unavailable');
    const result=await official.json();
    if(result.applicable===true){await rpc('marketing_creator_directory',scope);const {applicable,...profile}=result;return res.status(200).json(profile);}
    return res.status(200).json({metadata_status:'unavailable',reason:'official_profile_connection_unavailable',unavailable:{profile:'Connect an eligible Instagram account for this Brand. No public profile request was made; saved details and initials remain available.'}});
   }
   lease=await rpc('marketing_creator_inspection_access',{...scope,p_begin:true});
   const profile=await inspectProfile(body.url);
   await rpc('marketing_creator_directory',scope);
   return res.status(200).json(profile);
  }
  const readerScope=input.platform==='xhs'&&process.env.MARKETING_XHS_READER_ENABLED==='true'&&body.org===process.env.MARKETING_XHS_READER_ORG&&body.brand===process.env.MARKETING_XHS_READER_BRAND;
  const readerPilot=readerScope&&await rpc('current_user_has_permission',{permission_code:'platform_organizations.manage'})===true;
  const original=input.share?null:await rpc('marketing_creator_post_preview',{...scope,p_url:input.canonical_url});
  if(original?.duplicate&&!readerPilot)return res.status(200).json({...original,original_url:input.original_url||input.request_url});
  if(!readerPilot)lease=await rpc('marketing_creator_inspection_access',{...scope,p_begin:true});
  let result;
  if(readerPilot){
   result=await callReader({action:'inspect',org:body.org,brand:body.brand,url:body.url,authorization:req.headers.authorization});
  }else result=await inspectPublic(body.url,{organization:body.org,brand:body.brand,allowPaid:false});
  if(input.platform==='xhs'&&!result.post_id)return res.status(422).json({error:'The short link could not be resolved. Paste the complete Xiaohongshu share URL; no Post was saved.'});
  const canonical=await rpc('marketing_creator_post_preview',{...scope,p_url:result.canonical_url});
  if(result.metadata_status==='unavailable'&&canonical.metadata_status==='authorized_meta')return res.status(200).json({...canonical,public_extraction_reason:result.reason});
  if(canonical.duplicate&&!readerPilot)return res.status(200).json({...canonical,original_url:input.original_url||input.request_url});
  if(readerPilot&&await rpc('current_user_has_permission',{permission_code:'platform_organizations.manage'})!==true)throw new Error('access_or_limit');
  const data=await rpc('marketing_creator_directory',scope);
  const matches=result.author_external_id?(data.accounts||[]).filter(a=>!a.archived&&a.platform===result.platform&&a.external_id===result.author_external_id):[];
  const verified=matches.filter(a=>a.identity_verified);
  return res.status(200).json({platform:canonical.platform,post_key:canonical.post_key,canonical_url:canonical.canonical_url,...result,duplicate:canonical.duplicate,matched_creator_id:verified.length===1?verified[0].creator_id:null,matched_account_id:verified.length===1?verified[0].id:null,identity_verified:verified.length===1,author_identity_observed:Boolean(result.author_external_id),source:result.source||'Public post · review and confirm before saving',message:result.unavailable?.post||result.message});
 }catch(error){return res.status(error.message==='signed_out'?401:400).json({error:error.message==='access_or_limit'?'Access changed or the inspection limit was reached. Try later.':'Post inspection is unavailable. Check the URL and use manual details if necessary.'})}
 finally{if(lease)await rpc('marketing_creator_inspection_access',{...scope,p_begin:false,p_lease:lease}).catch(()=>{})}
}
