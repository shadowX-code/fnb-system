import {creatorProfilePayload} from './creatorProfiles.js';
import {creatorService} from './creatorService.js';
import {creatorInstagramAccount,creatorAvatarUrl} from './creatorAvatar.js';
// Share one renewal across visible consumers; failures cannot become an image-error request loop.
const attempts=new Map();
export function renewCreatorAvatar({org,brand,creator,account}){
 if(!account||!org||!brand||!String(account.public_observation?.source_hint||'').startsWith('Meta Instagram'))return Promise.resolve(null);
 const key=`${org}:${brand}:${creator.id}:${account.id}`,previous=attempts.get(key);
 if(previous&&Date.now()-previous.at<15*60*1000)return previous.promise||Promise.resolve(null);
 const promise=(async()=>{
  const data=await creatorService.directory(org),current=data.creators.find(c=>c.id===creator.id&&!c.archived);
  if(!current||current.editable===false)return null;
  const saved=creatorInstagramAccount(current,data.accounts);
  if(saved?.id!==account.id)return null;
  const result=await creatorService.profile(org,brand,saved.profile_url,{officialOnly:true});
  if(result.metadata_status!=='public_extracted'||result.avatar_kind!=='profile_picture'||result.profile_url!==saved.profile_url||!String(result.source||'').startsWith('Meta Instagram'))return null;
  const observation={source:result.source,captured_at:result.captured_at,avatar_kind:result.avatar_kind,avatar_url:result.avatar_url,profile_url:result.profile_url};
  const candidate={...saved,public_observation:{...observation,source:'public_profile_staff_confirmed'}};
  if(!creatorAvatarUrl(current,[candidate])||result.avatar_url===saved.public_observation?.avatar_url)return null;
  // The current full account plus revision preserves every unrelated field; canonical authority rechecks access.

  return creatorService.command({request:crypto.randomUUID(),org,brand,action:'save_account',id:saved.id,revision:saved.revision,payload:{...creatorProfilePayload(saved),creator_id:current.id,public_observation:observation}});
 })();
 const pending=promise.then(value=>{const entry=attempts.get(key);if(entry)entry.promise=null;return value},error=>{const entry=attempts.get(key);if(entry)entry.promise=null;throw error});
 attempts.set(key,{at:Date.now(),promise:pending});if(attempts.size>100)attempts.delete(attempts.keys().next().value);
 return pending;
}
