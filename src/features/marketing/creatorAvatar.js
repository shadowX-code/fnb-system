import {safePostMediaUrl} from './contentManagement.js';
import {creatorProfileLink} from './creatorProfiles.js';
function profilePicture(account){
 const o=account?.public_observation;
 if(!['public_profile_staff_confirmed','meta_instagram_business_discovery'].includes(o?.source)||o.avatar_kind!=='profile_picture'||o.profile_url!==creatorProfileLink(account)||!Number.isFinite(Date.parse(o.captured_at)))return null;
 if(o.source==='meta_instagram_business_discovery'&&(!/^[a-f\d-]{36}$/i.test(o.request_id||'')||!/^[a-f\d-]{36}$/i.test(o.connection_id||'')||!/^[a-f\d-]{36}$/i.test(o.delegation_epoch||'')||!Number.isInteger(o.connection_generation)||o.connection_generation<1))return null;
 const url=safePostMediaUrl(o.avatar_url);
 return url&&/^https:\/\/([a-z0-9-]+\.)*(cdninstagram\.com|fbcdn\.net)\//i.test(url)?url:null;
}
export function creatorInstagramAccount(creator,accounts=[]){
 const profiles=accounts.filter(a=>a.creator_id===creator.id&&!a.archived&&a.platform==='instagram').sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.id).localeCompare(String(b.id)));
 return profiles.find(a=>a.id===creator.primary_instagram_account_id)||profiles.find(profilePicture)||profiles[0]||null;
}
export function creatorAvatarUrl(creator,accounts=[]){return profilePicture(creatorInstagramAccount(creator,accounts));}
