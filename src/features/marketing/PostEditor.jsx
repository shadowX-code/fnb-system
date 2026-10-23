import {useEffect,useState} from 'react';
import {CheckCircle2,AlertCircle,Copy,Image as ImageIcon} from 'lucide-react';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import DateTimePickerField from '../../components/forms/DateTimePickerField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import Badge from '../../components/ui/Badge.jsx';
import MarketingMediaPicker from './MarketingMediaPicker.jsx';
import {PostMedia} from './PostDetail.jsx';
import {marketingService} from './marketingService.js';
import {localInput} from './marketingCalendar.js';
import {CONTENT_TIMEZONE,contentStatusLabel} from './contentManagement.js';
import {POST_FORMATS,variantIssues,publishingAccount} from './postEditor.js';
import './postEditor.css';
const label=contentStatusLabel;
export default function PostEditor({payload,onChange,brand,assets=[],plannedLocal,onPlannedChange,busy=false}) {
 const [selected,setSelected]=useState(payload.variants[0]?.channel||'facebook'),[view,setView]=useState('editor'),[cache,setCache]=useState([]),[accounts,setAccounts]=useState(null),[accountError,setAccountError]=useState(''),[retry,setRetry]=useState(0),[copied,setCopied]=useState('');
 const allAssets=[...new Map([...assets,...cache].map(a=>[a.id,a])).values()];
 const variant=payload.variants.find(v=>v.channel===selected)||payload.variants[0];
 const channel=variant?.channel||selected,other=payload.variants.find(v=>v.channel!==channel);
 const patchVariant=patch=>onChange({...payload,variants:payload.variants.map(v=>v.channel===channel?{...v,...patch}:v)});
 useEffect(()=>{let live=true;setAccounts(null);setAccountError('');marketingService.integrations(brand.organization_id,brand.id,'content').then(result=>{if(live)setAccounts(result.connections||[])}).catch(e=>{if(live)setAccountError(e.message||'Account eligibility unavailable.');});return()=>{live=false}},[brand.organization_id,brand.id,retry]);
 const account=variant&&publishingAccount(variant,accounts,brand);
 const issues=variant?variantIssues(variant,allAssets,brand):['Select at least one channel.'];
 const planned=plannedLocal??(payload.planned_at?localInput(new Date(payload.planned_at),CONTENT_TIMEZONE):'');
 const dateError=planned&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(planned)?'Choose both a date and time, or clear the date to leave this post unplanned.':'';
 function toggleChannel(name,checked){setCopied('');onChange({...payload,variants:checked?[...payload.variants,{channel:name,format:name==='facebook'?'text':'image',caption:'',asset_ids:[]}]:payload.variants.filter(v=>v.channel!==name)});if(checked)setSelected(name);}
 return <div className="post-editor-workspace" data-mobile-view={view}>
 <div className="post-editor-mobile-tabs"><AdminSegmentedControl label="Post workspace" value={view} onChange={setView} options={[{value:'editor',label:'Editor'},{value:'preview',label:'Preview'}]}/></div>
 <div className="post-editor-fields"><fieldset disabled={busy} className="post-editor-section">
 <AdminFormField label="Creative concept title" required helper="Internal title · shared across channels"><input className="control" value={payload.title} maxLength={200} onChange={e=>onChange({...payload,title:e.target.value})}/></AdminFormField>
 <DateTimePickerField label="Planned publishing" timezone={CONTENT_TIMEZONE} helper="Optional · planning does not schedule or publish" value={planned} onChange={onPlannedChange} error={dateError}/>
 {brand.outlet_ids?.length?<fieldset className="post-outlet-targets"><legend>Outlet targets</legend>{brand.outlet_ids.map(id=><label key={id}><input type="checkbox" checked={payload.outlet_ids.includes(id)} onChange={e=>onChange({...payload,outlet_ids:e.target.checked?[...payload.outlet_ids,id]:payload.outlet_ids.filter(v=>v!==id)})}/>{brand.outlets?.find(o=>o.id===id)?.name||'Brand outlet'}</label>)}</fieldset>:null}
 </fieldset>
 <section className="post-editor-section" aria-label="Channel content">
 <div className="post-channel-heading"><h3>Channel content</h3><fieldset disabled={busy} className="post-channel-selection"><legend className="sr-only">Channels</legend>{Object.keys(POST_FORMATS).map(name=><label key={name}><input type="checkbox" checked={payload.variants.some(v=>v.channel===name)} onChange={e=>toggleChannel(name,e.target.checked)}/>{label(name)}</label>)}</fieldset></div>
 {variant?<><AdminSegmentedControl label="Edit channel" value={channel} onChange={value=>{setSelected(value);setCopied('')}} options={payload.variants.map(v=>({value:v.channel,label:label(v.channel)}))}/>
 <fieldset disabled={busy} className="post-channel-fields">
 <SelectField label={`${label(channel)} format`} value={variant.format} onChange={format=>patchVariant({format,asset_ids:[]})} options={[...(POST_FORMATS[channel]||[]),...(!POST_FORMATS[channel]?.includes(variant.format)?[variant.format]:[])].map(format=>({value:format,label:label(format),disabled:!POST_FORMATS[channel]?.includes(format)}))}/>
 <AdminFormField label={`${label(channel)} caption`} helper={`${variant.caption?.length||0} / ${channel==='instagram'?'2,200':'63,206'} characters`}><textarea className="control post-caption-input" rows={5} value={variant.caption} maxLength={channel==='instagram'?2200:63206} onChange={e=>patchVariant({caption:e.target.value})}/></AdminFormField>
 {other?<div className="post-caption-copy"><button type="button" className="btn-secondary" disabled={busy||!other.caption||other.caption.length>(channel==='instagram'?2200:63206)} onClick={()=>{patchVariant({caption:other.caption});setCopied(`Caption copied from ${label(other.channel)}.`)}}><Copy size={14}/>Copy caption from {label(other.channel)}</button>{copied?<span role="status">{copied}</span>:null}</div>:null}
 {variant.format!=='text'?<MarketingMediaPicker key={channel} thumbnailPreviews disabled={busy} channel={channel} brand={brand} format={variant.format} values={variant.asset_ids} assets={allAssets} onAssetsResolved={records=>setCache(current=>[...new Map([...current,...records].map(a=>[a.id,a])).values()])} onChange={asset_ids=>patchVariant({asset_ids})}/>:null}
 <p className="post-editor-help">{variant.format==='carousel'?'2–10 images · selection order is publication order.':variant.format==='reel'?'One MP4 video, up to 50 MB.':variant.format==='image'?`One ${channel==='instagram'?'JPEG':'image'}, up to 8 MB.`:'Facebook text post · no media required.'}</p>
 </fieldset></>:<p>Select Facebook or Instagram to prepare a channel variant.</p>}
 </section></div>
 <aside className="post-editor-preview" aria-label="Post preview and readiness">
 <div className="post-preview-heading"><h3>Live preview</h3><Badge>Unsaved preview</Badge></div>
 {variant?<article className={`post-preview-frame ${variant.format==='reel'?'post-preview-reel':''}`} aria-label={`${label(channel)} post preview`}><header><span className="post-preview-brandmark" aria-hidden="true">{brand.name?.slice(0,1)}</span><div><strong>{brand.name}</strong><span>{label(channel)} · {label(variant.format)}</span></div></header>
 {variant.format!=='text'?(variant.asset_ids.length?<PostMedia key={`${channel}:${variant.format}:${variant.asset_ids.join(',')}`} channel={variant} assets={allAssets}/>:<div className="post-preview-placeholder"><ImageIcon size={26}/><span>Select media to preview this post</span></div>):null}
 <p className="post-preview-caption">{variant.caption||'Your caption preview will appear here.'}</p></article>:null}
 <section className="post-readiness" aria-label="Publishing readiness"><h3>Publishing readiness</h3>
 {!payload.title.trim()?<p><AlertCircle size={15}/>Add a creative concept title.</p>:null}
 {issues.length?<ul>{issues.map(issue=><li key={issue}><AlertCircle size={15}/><span>{issue}</span></li>)}</ul>:<p><CheckCircle2 size={15}/>Caption and selected media meet draft checks.</p>}
 {accountError?<div><p role="alert">{accountError}</p><button type="button" className="btn-secondary" onClick={()=>setRetry(v=>v+1)}>Retry account check</button></div>:accounts===null?<p role="status">Checking connected account…</p>:account?<p><CheckCircle2 size={15}/><span>{account.account_name} · Publishing eligible{!account.capabilities.execution_enabled?' · execution disabled':''}</span></p>:<p><AlertCircle size={15}/><span>No currently eligible account for this format. <a href={`/marketing/connections?marketing_org=${encodeURIComponent(brand.organization_id)}&marketing_brand=${encodeURIComponent(brand.id)}`}>Review Connections</a></span></p>}
 <p className="post-editor-help">Draft checks are advisory. Meta checks dimensions, processing and account restrictions before publishing. Saving does not approve or send this post.</p>
 {payload.variants.length>1?<div className="post-readiness-other">{payload.variants.filter(v=>v.channel!==channel).map(v=><button type="button" key={v.channel} onClick={()=>{setSelected(v.channel);setView('editor')}}>{label(v.channel)} · {variantIssues(v,allAssets,brand).length?'Needs content review':'Draft checks passed'}</button>)}</div>:null}
 </section></aside></div>;
}
