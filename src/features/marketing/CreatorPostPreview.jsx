import {useState} from 'react';
import {ExternalLink,Expand} from 'lucide-react';
import MediaLightbox from '../../components/media/MediaLightbox.jsx';
import MarketingMediaPreview from './MarketingMediaPreview.jsx';
import SocialChannelIcon from './SocialChannelIcon.jsx';
import {safePostMediaUrl} from './contentManagement.js';
import {label,day,number,contentTypes} from './creatorPresentation.js';
const publicSource=item=>item.url;
export default function CreatorPostPreview({post,assets=[],source,onEdit}){
 const [expanded,setExpanded]=useState(false),[failed,setFailed]=useState(false);
 const asset=assets.find(a=>a.id===post.asset_id),url=safePostMediaUrl(post.thumbnail_url),date=post.published_date||post.published_at;
 const metrics=Object.entries(post.metrics||{}).filter(([,value])=>typeof value==='number');
 return <section className="creator-post-review" aria-label="Post Preview"><header><h3>Post Preview</h3><button type="button" className="btn-secondary" onClick={onEdit}>Edit Details</button></header><div className="creator-post-review-body">{asset?<MarketingMediaPreview asset={asset} compact/>:url&&!failed?<button type="button" className="creator-post-review-thumbnail" aria-label="Expand post media" onClick={()=>setExpanded(true)}><img src={url} alt="Post thumbnail" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/><Expand size={14}/></button>:null}<div><div className="creator-account-chips"><SocialChannelIcon value={post.platform}/><strong>{label(post.platform)}</strong>{post.content_type?<span>{contentTypes.find(t=>t.value===post.content_type)?.label}</span>:null}</div>{post.author?<span className="creator-secondary">{post.author}</span>:null}{date?<time>{day(date)}</time>:null}{post.caption?<p className="creator-post-review-caption">{post.caption}</p>:<p className="creator-evidence-note">No caption available. Add details if needed.</p>}{metrics.length?<div className="creator-post-review-metrics">{metrics.map(([key,value])=><span key={key}><small>{label(key)}</small><strong>{number(value)}</strong></span>)}</div>:null}{post.url?<a href={post.url} target="_blank" rel="noreferrer">Open original Post <ExternalLink size={12}/></a>:null}</div></div>{source?<small className="creator-evidence-note">{source}</small>:null}{expanded?<MediaLightbox items={[{id:url,filename:'Post preview',mime_type:'image/jpeg',url}]} resolveSource={publicSource} onClose={()=>setExpanded(false)}/>:null}</section>;
}
