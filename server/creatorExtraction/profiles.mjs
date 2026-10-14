import {load} from 'cheerio';
import {recognizeCreatorProfile} from '../../src/features/marketing/creatorProfiles.js';
import {boundedGet,networkBudget} from './network.mjs';
import {renderPublic} from './browser.mjs';
import {publicThumbnail} from './urls.mjs';
import {metric} from './extract.mjs';
export function profileIdentity(url){const p=recognizeCreatorProfile(url);return {...p,request_url:p.profile_url,canonical_url:p.profile_url};}
export function extractProfile(html,url){
 const input=profileIdentity(url),$=load(html);const meta=k=>$(`meta[property="${k}"],meta[name="${k}"]`).attr('content');
 const advertised=meta('og:url')||$('link[rel="canonical"]').attr('href');
 if(advertised&&profileIdentity(advertised).profile_url!==input.profile_url)throw new Error('profile_identity_changed');
 const result={...input,avatar_url:publicThumbnail(meta('og:image'),input.platform),display_name:'',followers:null,captured_at:new Date().toISOString(),source:'Public profile metadata',identity_verified:false};
 const title=meta('og:title')||$('title').text(),description=meta('og:description')||meta('description')||'';
 if(input.platform==='instagram'){
  const named=title?.match(/^(.*?)\s*\(@([\w.]+)\)/);if(named&&named[2].toLowerCase()===input.handle)result.display_name=named[1].trim().slice(0,160);
  const followers=description.match(/^([\d,.]+\s*[KkMm]?)\s+Followers\b/);if(followers)result.followers=metric(followers[1]);
 }
 if(input.platform==='facebook'&&title?.endsWith(' | Facebook'))result.display_name=title.slice(0,-11).trim().slice(0,160);
 if(input.platform==='xhs'&&title&&/[-–]\s*(小红书|rednote)$/i.test(title))result.display_name=title.replace(/\s*[-–]\s*(小红书|rednote)$/i,'').trim().slice(0,160);
 for(const node of $('script#__UNIVERSAL_DATA_FOR_REHYDRATION__,script#SIGI_STATE').toArray())try{
  const data=JSON.parse($(node).text()),info=data.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
  if(input.platform==='tiktok'&&info?.user?.uniqueId?.toLowerCase()===input.handle){const u=info.user;result.display_name=String(u.nickname||'').slice(0,160);result.external_id=/^\d+$/.test(u.id||'')?u.id:'';result.avatar_url=publicThumbnail(u.avatarLarger||u.avatarMedium,'tiktok')||result.avatar_url;result.followers=metric(info.stats?.followerCount);}
 }catch{}
 for(const node of $('script[type="application/ld+json"]').toArray())try{const d=JSON.parse($(node).text());if(d['@type']==='Person'&&d.url&&profileIdentity(d.url).profile_url===input.profile_url){result.display_name=result.display_name||String(d.name||'').slice(0,160);result.avatar_url=result.avatar_url||publicThumbnail(d.image,input.platform)}}catch{}
 if(/captcha|access denied|security verification|^login|^log in|^sign in/i.test(title||''))throw new Error('profile_restricted');
 result.metadata_status=result.display_name||result.avatar_url||result.followers!==null?'public_extracted':'unavailable';
 result.unavailable=Object.fromEntries(['display_name','avatar_url','followers'].filter(k=>result[k]==null||result[k]==='').map(k=>[k,'Not exposed by the accessible public profile']));
 return result;
}
export async function inspectProfile(url,options={}){
 const input=profileIdentity(url),started=Date.now(),budget=networkBudget(30000);
 try{
  const r=await boundedGet(input.profile_url,input.platform,budget,true,undefined,profileIdentity);
  if(r.status!==200)throw new Error('profile_restricted');
  let result=extractProfile(r.body.toString('utf8'),r.url);
  if(result.metadata_status==='unavailable')try{const page=await renderPublic(input.profile_url,input.platform,budget,{...options,urlResolver:profileIdentity});if(page.status===200)result=extractProfile(page.html,page.url)}catch{}
  return {...result,runtime_ms:Date.now()-started,request_url:undefined,canonical_url:undefined};
 }catch{return {...input,request_url:undefined,canonical_url:undefined,metadata_status:'unavailable',followers:null,unavailable:{profile:'Public profile details are unavailable. Complete the optional fields manually.'},source:'Profile URL recognized; details unavailable',runtime_ms:Date.now()-started}}
}
