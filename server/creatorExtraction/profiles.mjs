import {load} from 'cheerio';
import {recognizeCreatorProfile} from '../../src/features/marketing/creatorProfiles.js';
import {boundedGet,networkBudget} from './network.mjs';
import {renderPublic} from './browser.mjs';
import {publicThumbnail} from './urls.mjs';
function profileAvatar(value,platform){const url=publicThumbnail(value,platform);return url&&/^https:\/\/([a-z0-9-]+\.)*(cdninstagram\.com|fbcdn\.net|xhscdn\.com|sns-i11\.rednotecdn\.com|tiktokcdn\.com|tiktokcdn-us\.com|tiktokv\.com|ibytedtos\.com)\//i.test(url)?url:null}
export function profileIdentity(url){const p=recognizeCreatorProfile(url);return {...p,request_url:p.profile_url,canonical_url:p.profile_url};}
export function extractProfile(html,url){
 const input=profileIdentity(url),$=load(html);const meta=k=>$(`meta[property="${k}"],meta[name="${k}"]`).attr('content');
 const advertised=meta('og:url')||$('link[rel="canonical"]').attr('href');
 if(advertised&&profileIdentity(advertised).profile_url!==input.profile_url)throw new Error('profile_identity_changed');
 const result={...input,avatar_url:profileAvatar(meta('og:image'),input.platform),display_name:'',followers:null,captured_at:new Date().toISOString(),source:'Public profile metadata',identity_verified:false};
 let avatarBound=false;
 const title=meta('og:title')||$('title').text();
 if(input.platform==='instagram'){
  const named=title?.match(/^(.*?)\s*\(@([\w.]+)\)/);if(named&&named[2].toLowerCase()===input.handle){result.display_name=named[1].trim().slice(0,160);avatarBound=true;}
 }
 if(input.platform==='facebook'&&title?.endsWith(' | Facebook'))result.display_name=title.slice(0,-11).trim().slice(0,160);
 if(input.platform==='xhs'&&title&&/[-–]\s*(小红书|rednote)$/i.test(title))result.display_name=title.replace(/\s*[-–]\s*(小红书|rednote)$/i,'').trim().slice(0,160);
 for(const node of $('script#__UNIVERSAL_DATA_FOR_REHYDRATION__,script#SIGI_STATE').toArray())try{
  const data=JSON.parse($(node).text()),info=data.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
  if(input.platform==='tiktok'&&info?.user?.uniqueId?.toLowerCase()===input.handle){const u=info.user;result.display_name=String(u.nickname||'').slice(0,160);result.external_id=/^\d+$/.test(u.id||'')?u.id:'';result.avatar_url=profileAvatar(u.avatarLarger||u.avatarMedium,'tiktok')||result.avatar_url;}
 }catch{}
 for(const node of $('script[type="application/ld+json"]').toArray())try{const d=JSON.parse($(node).text());if(d['@type']==='Person'&&d.url&&profileIdentity(d.url).profile_url===input.profile_url){avatarBound=true;result.display_name=result.display_name||String(d.name||'').slice(0,160);result.avatar_url=result.avatar_url||profileAvatar(d.image,input.platform)}}catch{}
 if(/captcha|access denied|security verification|^login|^log in|^sign in/i.test(title||''))throw new Error('profile_restricted');
 if(input.platform==='instagram'){if(!avatarBound)result.avatar_url=null;if(result.avatar_url){result.avatar_kind='profile_picture';}}
 result.metadata_status=result.display_name||result.avatar_url?'public_extracted':'unavailable';
 result.unavailable=Object.fromEntries(['display_name','avatar_url'].filter(k=>result[k]==null||result[k]==='').map(k=>[k,'Not exposed by the accessible public profile']));
 result.unavailable.followers='Followers require a separate authorized API sync.';
 return result;
}
const profileFailures={
 profile_restricted:'The platform restricted public profile access. Existing saved details remain unchanged.',
 provider_access_restricted:'The platform requires sign-in to view this profile. FeedX does not bypass sign-in restrictions.',
 profile_identity_changed:'The platform returned a different profile. Its picture was not accepted.',
 provider_timeout:'The public profile request timed out. Existing saved details remain unchanged.',
 inspection_limit:'The bounded public inspection limit was reached. No additional requests were made.',
 profile_metadata_unavailable:'The accessible public page did not expose usable profile details. Initials remain available.',
 profile_fetch_failed:'The public profile could not be retrieved. Existing saved details remain unchanged.'
};
export async function inspectProfile(url,options={}){
 const input=profileIdentity(url),started=Date.now(),budget=networkBudget(30000);let method='public_html',status=null;
 const unavailable=reason=>({...input,request_url:undefined,canonical_url:undefined,metadata_status:'unavailable',followers:null,reason,method,http_status:status,unavailable:{profile:profileFailures[reason]},source:'Profile URL recognized; details unavailable',runtime_ms:Date.now()-started});
 try{
  const r=await boundedGet(input.profile_url,input.platform,budget,true,undefined,profileIdentity);status=r.status;
  if(r.status!==200)return unavailable('profile_restricted');
  let result=extractProfile(r.body.toString('utf8'),r.url);
  if(result.metadata_status==='unavailable'){
   method='public_browser';
   const page=await renderPublic(input.profile_url,input.platform,budget,{...options,urlResolver:profileIdentity});status=page.status;
   if(page.status!==200)return unavailable('profile_restricted');
   result=extractProfile(page.html,page.url);
  }
  if(result.metadata_status==='unavailable')return unavailable('profile_metadata_unavailable');
  return {...result,method,http_status:status,runtime_ms:Date.now()-started,request_url:undefined,canonical_url:undefined};
 }catch(error){return unavailable(Object.hasOwn(profileFailures,error?.message)?error.message:'profile_fetch_failed')}
}
