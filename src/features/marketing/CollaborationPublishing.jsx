import {ExternalLink,Plus,X} from 'lucide-react';
import SelectField from '../../components/forms/SelectField.jsx';
import Badge from '../../components/ui/Badge.jsx';
import SocialChannelIcon from './SocialChannelIcon.jsx';
import CreatorPostThumbnail from './CreatorPostThumbnail.jsx';
import {collaborationPublishing,publishingProgress,creatorPlatforms,contentTypes,day,label,number} from './creatorPresentation.js';

export function CollaborationPublishingSummary({collaboration,posts}){
 const entries=collaborationPublishing(collaboration,posts),progress=publishingProgress(collaboration,posts);
 return <div className="creator-publishing-summary"><strong>{progress.text}</strong><div>{entries.slice(0,3).map(entry=>{
  const date=entry.post?.published_at||entry.post?.published_date;
  const content=<><SocialChannelIcon value={entry.platform}/><span>{entry.published?'Published':entry.post?'Needs confirmation':'Planned'}{entry.published&&date?<small>{day(date)}</small>:null}</span>{entry.published?<ExternalLink size={12}/>:null}</>;
  return entry.published?<a key={entry.key} href={entry.post.canonical_url} target="_blank" rel="noreferrer" aria-label={`Open ${label(entry.platform)} post${date?' · '+day(date):''}`}>{content}</a>:<span key={entry.key}>{content}</span>;
 })}{entries.length>3?<span title="Open collaboration to see all publishing entries">+{entries.length-3}</span>:null}</div></div>;
}

export default function CollaborationPublishing({value,posts,assets,onChange,onAddPost,onViewPost,onRemove,record,dirty}){
 const entries=collaborationPublishing(value,posts);
 const update=(plan,key,next)=>onChange(value.deliverables.map(d=>d===plan?{...d,[key]:next}:d));
 return <><div className="creator-publishing-list">{entries.map((entry,index)=>{
  const {plan,post}=entry,date=post?.published_at||post?.published_date;
  const metrics=Object.entries(post?.latest_metrics||{}).filter(([k,v])=>['views','likes','comments','shares'].includes(k)&&typeof v==='number');
  return <article className="creator-publishing-entry" key={entry.key} aria-label={`Publishing entry ${index+1}`}>
   <div className="creator-publishing-entry-head"><SocialChannelIcon value={entry.platform}/><strong>{label(entry.platform)}</strong><Badge tone={entry.published?'success':post?'warning':'neutral'}>{entry.published?'Published':post?'Needs confirmation':'Planned'}</Badge><button type="button" className="icon-btn" aria-label={`Remove publishing entry ${index+1}`} disabled={Boolean(post&&dirty)} title={post&&dirty?'Save changes before removing this linked Post':undefined} onClick={()=>onRemove(entry)}><X size={15}/></button></div>
   {post?<div className="creator-publishing-evidence"><CreatorPostThumbnail post={post} assets={assets} fallback={false}/><div><span className="creator-publishing-meta">{entry.content_type?<span>{contentTypes.find(t=>t.value===entry.content_type)?.label}</span>:null}{date?<time>{day(date)}</time>:null}</span>{post.caption?<p>{post.caption}</p>:null}<a href={post.canonical_url} target="_blank" rel="noreferrer"><span>{post.canonical_url}</span><ExternalLink size={13}/></a>{metrics.length?<small>{metrics.map(([k,v])=>`${label(k)} ${number(v)}`).join(' · ')}</small>:null}</div><button type="button" className="btn-secondary" disabled={dirty} onClick={()=>onViewPost(post)}>{entry.published?'View / Edit':'Review Post'}</button></div>:<div className="creator-publishing-fields"><SelectField label="Platform" value={plan.platform} onChange={next=>update(plan,'platform',next)} options={creatorPlatforms}/><SelectField label="Content Type" value={plan.content_type||''} onChange={next=>update(plan,'content_type',next)} options={[{value:'',label:'Choose type'},...contentTypes]} required={!plan.id}/><button type="button" className="btn-secondary" disabled={!record||dirty||!plan.id} onClick={()=>onAddPost(record,plan)}>Add Post URL</button></div>}
  </article>;
 })}</div>{!entries.length?<p className="creator-evidence-note">Plan a platform post, then add its URL when it is published.</p>:null}<button type="button" className="btn-secondary self-start" disabled={value.deliverables.length>=50} onClick={()=>onChange([...value.deliverables,{title:'Planned post',platform:'instagram',content_type:'video',due_date:'',status:'pending'}])}><Plus size={14}/>Add Platform / Post</button>{(!record||dirty)&&entries.some(e=>!e.post)?<p className="creator-evidence-note">Save changes to add a Post URL. The URL Inspector will help you review and confirm the Post.</p>:null}</>;
}
