import {load} from 'cheerio';
import {inspectXhs} from './dataxapi.mjs';
import {platformUrl,publicThumbnail} from './urls.mjs';
import {boundedGet,networkBudget} from './network.mjs';
import {extractMetadata} from './extract.mjs';
import {renderPublic} from './browser.mjs';
export async function inspectPublic(value,options={}){
 const start=Date.now(),input=platformUrl(value),budget=networkBudget(45000);let result,rendered=false;
 const provider=await inspectXhs(input,options);if(provider)return provider;
 try{
  const response=await boundedGet(input.request_url,input.platform,budget),resolved=platformUrl(response.url);
  if([401,403,429].includes(response.status))throw new Error(response.status===429?'provider_rate_limited':'provider_access_restricted');
  if(response.status!==200)throw new Error('provider_unavailable');
  if(resolved.share)throw new Error('share_link_unresolved');
  result=extractMetadata(response.body.toString('utf8'),resolved.request_url);
  const title=load(response.body.toString('utf8'))('title').text();if(/captcha|access denied|security verification/i.test(title))throw new Error('provider_access_restricted');
  // Public TikTok oEmbed supplies author/cover, never invented counters or dates.
  if(input.platform==='tiktok')try{
   const r=await boundedGet('https://www.tiktok.com/oembed?url='+encodeURIComponent(resolved.canonical_url),'tiktok',budget);
   if(r.status===200){const o=JSON.parse(r.body.toString('utf8'));if(o.type==='video'&&o.provider_name==='TikTok'){result.caption=o.title||result.caption;result.author_display_name=o.author_name||result.author_display_name;result.author_profile_url=/^https:\/\/www\.tiktok\.com\/@[\w.-]+\/?$/.test(o.author_url||'')?o.author_url:result.author_profile_url;result.author_handle=result.author_profile_url?.split('@')[1];result.thumbnail_url=publicThumbnail(o.thumbnail_url,'tiktok')||result.thumbnail_url;for(const k of ['caption','author_display_name','author_profile_url','author_handle','thumbnail_url'])if(result[k]){result.provenance[k]={source:'official-public-oembed',method:'public_api'};delete result.unavailable[k]}result.metadata_status='public_extracted';}}
  }catch{/* oEmbed denial does not discard independently accessible fields. */}
  if(!result.author_profile_url||!result.thumbnail_url||!result.published_at){
   try{const page=await renderPublic(resolved.request_url,input.platform,budget,options);rendered=true;if([401,403,429].includes(page.status))throw new Error('provider_access_restricted');const next=extractMetadata(page.html,page.url,page.method);if(next.platform!==resolved.platform||next.post_id!==resolved.post_id)throw new Error('post_identity_changed');for(const [k,v] of Object.entries(next)){if(k==='metrics')result.metrics={...next.metrics,...result.metrics};else if(k==='provenance')result.provenance={...next.provenance,...result.provenance};else if(result[k]===null||result[k]===undefined)result[k]=v;}for(const k of Object.keys(result.unavailable))if(result[k]!=null||result.metrics[k]!=null)delete result.unavailable[k];if(next.metadata_status==='public_extracted')result.metadata_status=next.metadata_status;}
   catch(error){result.browser_status=['provider_access_restricted','post_identity_changed'].includes(error.message)?error.message:'public_render_unavailable';}
  }
  result.request_url=undefined;return {...result,runtime_ms:Date.now()-start,bytes_fetched:budget.bytes,browser_used:rendered};
 }catch(error){return {platform:input.platform,post_id:input.post_id,canonical_url:input.canonical_url,metadata_status:'unavailable',metrics:{},unavailable:{post:({provider_access_restricted:'The platform restricted public access. Open the post and enter details manually.',provider_rate_limited:'The platform is rate limiting access. Try later or enter details manually.',share_link_unresolved:'The share link did not expose a canonical post. Paste its full post URL.'})[error.message]||'The public post could not be retrieved. Manual entry is available.'},reason:['provider_access_restricted','provider_rate_limited','share_link_unresolved','redirect_not_supported','unsupported_post_url','post_identity_changed'].includes(error.message)?error.message:'public_retrieval_unavailable',runtime_ms:Date.now()-start,bytes_fetched:budget.bytes,browser_used:rendered};}
}
