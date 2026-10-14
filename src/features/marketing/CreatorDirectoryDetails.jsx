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
export function CreatorBrandHistory({creator,brands,compact=false}){
 const history=creator.collaboration_history?.filter(row=>brands.some(b=>b.id===row.brand_id));
 if(!history)return <small className="creator-evidence-note">Collaboration history unavailable</small>;
 if(!history.length)return <small className="creator-evidence-note">No collaboration history</small>;
 const rows=compact?history.slice(0,3):history;
 return <div className={compact?'creator-brand-history creator-brand-history-compact':'creator-brand-history'}>{rows.map(row=><span key={row.brand_id} title={`${number(row.collaboration_count)} ${row.collaboration_count===1?'collaboration':'collaborations'}`}><span>{brands.find(b=>b.id===row.brand_id).name}</span><strong>{number(row.collaboration_count)}</strong></span>)}{compact&&history.length>3?<small title="Open Creator Detail to view all authorized Brand history">+{history.length-3}</small>:null}</div>;
}
