import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Image as ImageIcon } from 'lucide-react';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { marketingService } from './marketingService.js';
import { CONTENT_TIMEZONE, POST_METRICS, contentStatusLabel, postMetric, metricReason, safePostMediaUrl, safePostLink } from './contentManagement.js';
import {publishingStatus} from './publishingPlan.js';
import './contentManagement.css';
const stamp=value=>value?new Intl.DateTimeFormat('en-MY',{timeZone:CONTENT_TIMEZONE,dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Not set';
export function PostMedia({channel, assets=[],onMetadata}) {
 const [index,setIndex]=useState(0),[url,setUrl]=useState(''),[failed,setFailed]=useState(false);
 const privateAssets=channel.assets?.length?channel.assets:channel.asset_ids?.map(id=>assets.find(a=>a.id===id)).filter(Boolean)|| (channel.asset?[channel.asset]:[]);
 const items=privateAssets.length?privateAssets.map(asset=>({asset,type:asset.mime_type?.startsWith('video/')?'video':'image'})):channel.media?.length?channel.media:[...(channel.thumbnail_url?[{url:channel.thumbnail_url,type:'image',previewOnly:true}]:[])];
 const item=items[index];
 useEffect(()=>{setIndex(0);},[channel.channel,channel.provider_post_id]);
 useEffect(()=>{let live=true;setUrl('');setFailed(false);if(item?.asset)marketingService.assetUrl(item.asset).then(value=>{if(live)setUrl(value)}).catch(()=>{if(live)setFailed(true)});else setUrl(safePostMediaUrl(item?.url,channel.channel)||'');return()=>{live=false}},[item?.asset?.id,item?.url]);
 return <figure className="cm-post-media">{url&&!failed ? item?.type==='video'?<video key={url} src={url} poster={safePostMediaUrl(item.thumbnail_url,channel.channel)||undefined} controls preload="metadata" onLoadedMetadata={e=>{if(item?.asset)onMetadata?.(item.asset.id,{width:e.currentTarget.videoWidth,height:e.currentTarget.videoHeight,duration:e.currentTarget.duration})}} onError={()=>setFailed(true)}/>:<img src={url} alt={item?.asset?.filename||'Post media'} referrerPolicy="no-referrer" onLoad={e=>{if(item?.asset)onMetadata?.(item.asset.id,{width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}} onError={()=>setFailed(true)}/> : <div className="cm-media-empty"><ImageIcon size={28}/><span>{failed?item?.asset?.state==='retired'||item?.asset?.state==='retiring'?'Publishing snapshot no longer stored':'Media preview unavailable':items.length?'Loading media…':'No media available'}</span></div>}
 {items.length>1?<figcaption className="cm-carousel"><button className="icon-btn" aria-label="Previous media" disabled={index===0} onClick={()=>setIndex(i=>i-1)}><ChevronLeft size={16}/></button><span>{index+1} / {items.length}</span><button className="icon-btn" aria-label="Next media" disabled={index===items.length-1} onClick={()=>setIndex(i=>i+1)}><ChevronRight size={16}/></button></figcaption>:null}{item?.previewOnly?<figcaption className="cm-muted">Platform preview · original media unavailable</figcaption>:null}</figure>;
}
export default function PostDetail({content,assets=[],children,events=[]}) {
 const [tab,setTab]=useState('overview'),[selected,setSelected]=useState(content.channels?.[0]?.channel||content.payload?.variants?.[0]?.channel);
 const channels=content.channels?.length?content.channels:content.payload?.variants?.map(v=>({...v,status:content.status}))||[];
 const base=channels.find(v=>v.channel===selected)||channels[0]||{};
 const variant=content.payload?.variants?.find(v=>v.channel===base.channel);
 const channel={...variant,...base};
 const lifecycle=publishingStatus(content);
 const published=channel.status==='published'||Boolean(channel.actual_at),link=safePostLink(channel.permalink);
 return <div className={`cm-post-detail ${tab==='performance'?'cm-post-performance':''}`}>
 {channels.length>1?<AdminSegmentedControl label="Post channel" value={base.channel} onChange={setSelected} options={channels.map(v=>({value:v.channel,label:contentStatusLabel(v.channel)}))}/>:null}
 <AdminSegmentedControl label="Post sections" value={tab} onChange={setTab} options={[{value:'overview',label:'Overview'},{value:'performance',label:'Performance'}]}/>
 <PostMedia key={base.channel} channel={channel} assets={assets}/>
 <div className="cm-post-heading"><span>{content.brand_name||'Brand content'} · {contentStatusLabel(channel.channel)}</span><Badge tone={published?'success':channel.status==='failed'?'danger':'neutral'}>{contentStatusLabel(channel.status||content.status)}</Badge></div>
 <h3>{content.title||content.payload?.title}</h3>
 {tab==='overview'?<>{content.origin!=='meta'&&content.origin!=='observation'?<div className="cm-publishing-next"><strong>{lifecycle.label}</strong>{lifecycle.next?<p className="cm-muted">{lifecycle.next}</p>:null}</div>:null}<p className="cm-post-caption">{channel.caption||'No caption available.'}</p>{link?<a className="btn-secondary cm-platform-link" href={link} target="_blank" rel="noopener noreferrer">Open on {contentStatusLabel(channel.channel)} <ExternalLink size={14}/></a>:published?<p className="cm-muted">Platform link unavailable</p>:null}
 <dl className="cm-post-facts"><dt>Published</dt><dd>{stamp(channel.actual_at)}</dd><dt>Scheduled</dt><dd>{stamp(channel.scheduled_at||content.scheduled_at)}</dd><dt>Intended publishing</dt><dd>{stamp(content.planned_at||content.payload?.planned_at)}</dd><dt>Time zone</dt><dd>{CONTENT_TIMEZONE}</dd><dt>Source</dt><dd>{content.origin==='meta'?'Published externally · Meta':content.origin==='observation'?'Synchronized from Meta':'Created in FeedX'}</dd><dt>Format</dt><dd>{contentStatusLabel(channel.media_product_type==='REELS'?'Reel':channel.media_type||channel.format)||'Unavailable'}</dd></dl>
 {children}</>:<><p className="cm-muted">{published?'Lifetime platform evidence · values may be delayed':'Performance is available after publication and synchronization.'}</p><dl className="cm-post-metrics">{POST_METRICS.filter(m=>(m.key!=='reactions'&&m.key!=='viewers'||channel.channel==='facebook') && (m.key!=='saves'||channel.channel==='instagram')).filter(m=>!m.unit||channel.media_product_type==='REELS'||channel.format==='reel'||postMetric(channel,m.key)!==null).map(m=>{const value=published?postMetric(channel,m.key):null;return <div key={m.key} title={m.description}><dt>{m.label}</dt><dd>{value===null?'—':value.toLocaleString('en-MY')}{value!==null&&m.unit?` ${m.unit}`:''}</dd>{value===null?<small>{metricReason(channel,m.key)}</small>:null}</div>})}</dl><p className="cm-muted">Measured {channel.observed_at?stamp(channel.observed_at):'time unavailable'}. No conversion or incremental-revenue claim.</p></>}
 <details className="cm-post-evidence"><summary>Technical & synchronization details</summary><dl className="cm-post-facts"><dt>Platform post</dt><dd>{channel.provider_post_id||'Unavailable'}</dd><dt>Observed</dt><dd>{stamp(channel.observed_at)}</dd><dt>Publishing state</dt><dd>{channel.job_state||'No FeedX delivery job'}</dd><dt>Revision</dt><dd>{content.revision||'External post'}</dd></dl>{Object.keys(channel.metric_provenance||{}).length?<dl className="cm-post-facts">{Object.entries(channel.metric_provenance).map(([key,e])=><div key={key}><dt>{POST_METRICS.find(m=>m.key===key)?.label||key}</dt><dd>{e.source} · {e.period} · {e.graph_version} · {stamp(e.observed_at)}</dd></div>)}</dl>:null}{channel.error_code?<p>{channel.error_code}</p>:null}{events.map((e,i)=><p key={i}>{contentStatusLabel(e.action)} · {stamp(e.created_at)}{e.details?.reason?` · ${e.details.reason}`:''}</p>)}</details>
 </div>;
}
