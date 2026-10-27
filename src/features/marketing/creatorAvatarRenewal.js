import {creatorService} from './creatorService.js';
import {creatorInstagramAccount,creatorAvatarUrl} from './creatorAvatar.js';
// Share one renewal across visible consumers; failures cannot become an image-error request loop.
const attempts=new Map();
export function renewCreatorAvatar({org,creator,account}){
 if(!account||!org||!String(account.public_observation?.source_hint||'').startsWith('Meta Instagram'))return Promise.resolve(null);
 const key=`${org}:${creator.id}:${account.id}`,previous=attempts.get(key);
 if(previous&&Date.now()-previous.at<15*60*1000)return previous.promise||Promise.resolve(null);
 const promise=(async()=>{
  const data=await creatorService.directory(org),current=data.creators.find(c=>c.id===creator.id&&!c.archived);
  if(!current||current.editable===false)return null;
  const saved=creatorInstagramAccount(current,data.accounts);
  if(saved?.id!==account.id)return null;
  const result=await creatorService.profile(org,null,saved.profile_url,{officialOnly:true,accountId:saved.id});
  if(result.metadata_status!=='public_extracted'||result.avatar_kind!=='profile_picture'||result.profile_url!==saved.profile_url||!String(result.source||'').startsWith('Meta Instagram'))return null;
  // The server has already committed against the current delegation and generation.
  const fresh=result.account;
  return fresh?.id===saved.id&&fresh.creator_id===current.id&&creatorAvatarUrl(current,[fresh])?fresh:null;
 })();
 const pending=promise.then(value=>{const entry=attempts.get(key);if(entry)entry.promise=null;return value},error=>{const entry=attempts.get(key);if(entry)entry.promise=null;throw error});
 attempts.set(key,{at:Date.now(),promise:pending});if(attempts.size>100)attempts.delete(attempts.keys().next().value);
 return pending;
}
