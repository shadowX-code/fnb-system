import {useId,useRef,useState} from 'react';
import Badge from '../../components/ui/Badge.jsx';
import FloatingLayer from '../../components/ui/FloatingLayer.jsx';
import SocialChannelIcon from './SocialChannelIcon.jsx';
import {creatorProfileLink} from './creatorProfiles.js';
import {label,number} from './creatorPresentation.js';
export function CreatorAccountLinks({accounts}){
 return <div className="creator-account-chips">{accounts.map(account=>{
  const url=creatorProfileLink(account),name=account.handle?'@'+account.handle:account.display_name||'Profile';
  const content=<><SocialChannelIcon value={account.platform}/><span>{name}</span></>;
  return url?<a key={account.id} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label(account.platform)} profile ${name}`}>{content}</a>:<span key={account.id} title="No supported profile link saved">{content}</span>;
 })}</div>;
}
export function CreatorBrandHistory({creator,brands,compact=false,onSelectBrand}){
 const [expanded,setExpanded]=useState(false),anchor=useRef(null),popoverId=useId();
 const history=creator.collaboration_history?.filter(row=>brands.some(b=>b.id===row.brand_id)).slice().sort((a,b)=>b.collaboration_count-a.collaboration_count);
 if(!history)return <small className="creator-evidence-note">Collaboration history unavailable</small>;
 if(!history.length)return <span className="creator-evidence-note">—</span>;
 const chip=row=>{
  const name=brands.find(b=>b.id===row.brand_id).name;
  const content=<Badge><span className="creator-brand-chip-name">{name}</span><strong>{number(row.collaboration_count)}</strong></Badge>;
  return onSelectBrand?<button key={row.brand_id} type="button" className="creator-brand-chip" title={name} aria-label={`${name}: ${number(row.collaboration_count)} collaborations`} onClick={e=>{e.stopPropagation();setExpanded(false);onSelectBrand(row.brand_id)}}>{content}</button>:<span key={row.brand_id} className="creator-brand-chip" title={name}>{content}</span>;
 };
 return <div className="creator-brand-history" onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
  {(compact?history.slice(0,2):history).map(chip)}
  {compact&&history.length>2?<><button ref={anchor} type="button" className="creator-brand-overflow" aria-label={`Show ${history.length-2} more Brands`} aria-expanded={expanded} aria-controls={expanded?popoverId:undefined} onClick={()=>setExpanded(v=>!v)}>+{history.length-2}</button>
   <FloatingLayer open={expanded} onOpenChange={v=>{setExpanded(v);if(!v)anchor.current?.focus()}} anchorRef={anchor} align="end" width={280} maxHeight={320} focusOnOpen>
    <div id={popoverId} role="group" aria-label="More Brand collaboration history" className="creator-brand-history creator-brand-history-expanded">{history.slice(2).map(chip)}</div>
   </FloatingLayer></>:null}
 </div>;
}
