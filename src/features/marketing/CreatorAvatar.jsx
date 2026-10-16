import {useEffect,useRef,useState} from 'react';
import {creatorAvatarUrl,creatorInstagramAccount} from './creatorAvatar.js';
import {renewCreatorAvatar} from './creatorAvatarRenewal.js';
export {creatorAvatarUrl,creatorInstagramAccount} from './creatorAvatar.js';

export default function CreatorAvatar({creator,accounts=[],compact=false,org,brandId,canRefresh=false}){
 const base=creatorAvatarUrl(creator,accounts),[renewed,setRenewed]=useState(null),[failed,setFailed]=useState(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const url=renewed?.base===base?creatorAvatarUrl(creator,[renewed.account]):base;
 async function imageFailed(){setFailed(url);if(!canRefresh||!org||!brandId)return;const account=creatorInstagramAccount(creator,accounts);try{const fresh=await renewCreatorAvatar({org,brand:brandId,creator,account});if(alive.current&&fresh)setRenewed({base,account:fresh})}catch{/* Accurate initials remain when renewal is unavailable. */}}
 const initials=(creator.name||'Creator').trim().split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase();
 return <span className={`creator-avatar${compact?' creator-avatar-small':''}`}>
 {url&&failed!==url?<img src={url} alt={`${creator.name} Instagram profile picture`} loading="lazy" referrerPolicy="no-referrer" onError={imageFailed}/>:<span aria-label={`${creator.name} initials`}>{initials}</span>}
 </span>;
}
