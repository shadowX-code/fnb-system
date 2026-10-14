import {useState} from 'react';
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
export default function CreatorAvatar({creator,accounts=[],compact=false}){
 const url=creatorAvatarUrl(creator,accounts),[failed,setFailed]=useState(null);
 const initials=(creator.name||'Creator').trim().split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase();
 return <span className={`creator-avatar${compact?' creator-avatar-small':''}`}>
 {url&&failed!==url?<img src={url} alt={`${creator.name} Instagram profile picture`} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(url)}/>:<span aria-label={`${creator.name} initials`}>{initials}</span>}
 </span>;
}
