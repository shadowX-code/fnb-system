import {safePostMediaUrl} from './contentManagement.js';
import {creatorProfileLink} from './creatorProfiles.js';
function profilePicture(account){
 const o=account?.public_observation;
 if(o?.source!=='public_profile_staff_confirmed'||o.avatar_kind!=='profile_picture'||o.profile_url!==creatorProfileLink(account)||!Number.isFinite(Date.parse(o.captured_at)))return null;
 const url=safePostMediaUrl(o.avatar_url);
 return url&&/^https:\/\/([a-z0-9-]+\.)*(cdninstagram\.com|fbcdn\.net)\//i.test(url)?url:null;
}
export function creatorInstagramAccount(creator,accounts=[]){
 const profiles=accounts.filter(a=>a.creator_id===creator.id&&!a.archived&&a.platform==='instagram').sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.id).localeCompare(String(b.id)));
 return profiles.find(a=>a.id===creator.primary_instagram_account_id)||profiles.find(profilePicture)||profiles[0]||null;
}
export function creatorAvatarUrl(creator,accounts=[]){return profilePicture(creatorInstagramAccount(creator,accounts));}
