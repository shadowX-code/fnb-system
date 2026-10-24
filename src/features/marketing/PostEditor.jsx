import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Check,CheckCircle2,AlertCircle,Copy,Image as ImageIcon} from 'lucide-react';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import DateTimePickerField from '../../components/forms/DateTimePickerField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ReelCoverEditor from './ReelCoverEditor.jsx';
import MarketingMediaPicker from './MarketingMediaPicker.jsx';
import CaptionLibrary,{insertCaptionText} from './CaptionLibrary.jsx';
import SocialChannelIcon from './SocialChannelIcon.jsx';
import {PostMedia} from './PostDetail.jsx';
import {marketingService} from './marketingService.js';
import {localInput} from './marketingCalendar.js';
import {CONTENT_TIMEZONE,contentStatusLabel} from './contentManagement.js';
import {POST_FORMATS,variantIssues,publishingAccount,mediaMetadataIssues} from './postEditor.js';
import {isVideoFormat,publishingMediaEligible,extendedInstagramVariant} from './publishingMedia.js';
import {publishingIntent,publishingStatus} from './publishingPlan.js';
import './postEditor.css';
const label=contentStatusLabel;
export default function PostEditor({payload,onChange,brand,assets=[],plannedLocal,onPlannedChange,busy=false,can=()=>false,content}) {
 const [selected,setSelected]=useState(payload.variants[0]?.channel||'facebook'),[view,setView]=useState('editor'),[cache,setCache]=useState([]),[accounts,setAccounts]=useState(null),[accountError,setAccountError]=useState(''),[retry,setRetry]=useState(0),[copied,setCopied]=useState(''),[videoEnabled,setVideoEnabled]=useState(false),[extendedEnabled,setExtendedEnabled]=useState(false),[observations,setObservations]=useState({});
 useEffect(()=>{let live=true;marketingService.metaConfiguration().then(value=>{if(live){setVideoEnabled(value.facebook_video_execution_enabled===true);setExtendedEnabled(value.instagram_extended_execution_enabled===true)}}).catch(()=>{});return()=>{live=false}},[]);
 const captionInput=useRef(null),positions=useRef({}),pendingCursor=useRef(null),removedVariants=useRef({});
 const allAssets=[...new Map([...assets,...cache].map(a=>[a.id,a])).values()];
 const variant=payload.variants.find(v=>v.channel===selected)||payload.variants[0];
 const channel=variant?.channel||selected,other=payload.variants.find(v=>v.channel!==channel);
 useLayoutEffect(()=>{const pending=pendingCursor.current;if(pending?.channel===channel){captionInput.current?.focus();captionInput.current?.setSelectionRange(pending.cursor,pending.cursor);positions.current[channel]=pending.cursor;pendingCursor.current=null;}},[channel,variant?.caption]);
 const patchVariant=patch=>onChange({...payload,variants:payload.variants.map(v=>{if(v.channel!==channel)return v;const next={...v,...patch};if((patch.format&&patch.format!==v.format)||(patch.asset_ids&&patch.asset_ids[0]!==v.asset_ids[0]))delete next.reel_cover;return next;})});
 useEffect(()=>{let live=true;setAccounts(null);setAccountError('');marketingService.integrations(brand.organization_id,brand.id,'content').then(result=>{if(live)setAccounts(result.connections||[])}).catch(e=>{if(live)setAccountError(e.message||'Account eligibility unavailable.');});return()=>{live=false}},[brand.organization_id,brand.id,retry]);
 const account=variant&&publishingAccount(variant,accounts,brand);
 const storyAvailable=publishingAccount({channel:'instagram',format:'story'},accounts,brand)?.capabilities?.story_business_verified===true;
 const issues=variant?[...variantIssues(variant,allAssets,brand),...mediaMetadataIssues(variant,allAssets,observations)]:['Select at least one channel.'];
 const planned=plannedLocal??(payload.planned_at?localInput(new Date(payload.planned_at),CONTENT_TIMEZONE):'');
 const intent=publishingIntent(payload),savedStatus=publishingStatus(content);
 const dateError=planned&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(planned)?'Choose both a date and time, or clear the date to leave this post unplanned.':'';
 function toggleChannel(name,checked){setCopied('');if(!checked)removedVariants.current[name]=payload.variants.find(v=>v.channel===name);onChange({...payload,variants:checked?[...payload.variants,removedVariants.current[name]||{channel:name,format:name==='facebook'?'text':'image',caption:'',asset_ids:[]}]:payload.variants.filter(v=>v.channel!==name)});if(checked)setSelected(name);}
 function insertSaved(text,kind){const result=insertCaptionText(variant.caption,text,channel==='instagram'?2200:63206,positions.current[channel]??variant.caption.length,kind);pendingCursor.current={channel,cursor:result.cursor};patchVariant({caption:result.value});}
 return <div className="post-editor-workspace" data-mobile-view={view}>
 <div className="post-editor-mobile-tabs"><AdminSegmentedControl label="Post workspace" value={view} onChange={setView} options={[{value:'editor',label:'Editor'},{value:'preview',label:'Preview'}]}/></div>
 <div className="post-editor-fields"><fieldset disabled={busy} className="post-editor-section">
 <AdminFormField label="Creative concept title" required helper="Internal title · shared across channels"><input className="control" value={payload.title} maxLength={200} onChange={e=>onChange({...payload,title:e.target.value})}/></AdminFormField>
 <section className="post-publishing-plan" aria-label="Publishing Plan"><h3>Publishing Plan</h3><div className="post-publishing-status"><Badge>{savedStatus.label}</Badge><span>{content?'Saved status':'New post'}</span></div>
 <div className="post-publishing-options" role="radiogroup" aria-label="Publishing intention">{[{value:'draft',label:'Save Draft'},{value:'now',label:'Publish Now'},{value:'schedule',label:'Schedule'}].map(option=><label key={option.value}><input type="radio" name="publishing-intention" checked={intent===option.value} disabled={busy||option.value!=='draft'&&(!can('marketing_content.publish')||!can('marketing_content.execute')||content&& !['draft','approved'].includes(content.status))} onChange={()=>{onChange({...payload,publishing_plan:option.value,...(option.value==='schedule'?{}:{planned_at:null})});if(option.value!=='schedule')onPlannedChange('');}}/>{option.label}</label>)}</div>
 {intent==='schedule'?<DateTimePickerField label="Publishing date & time" timezone={CONTENT_TIMEZONE} helper="Future publishing time" value={planned} onChange={onPlannedChange} error={dateError}/>:null}
 <p className="post-editor-help">{intent==='now'?'Save the current revision, then explicitly confirm its caption, media and eligible accounts. Nothing sends until confirmation.':intent==='schedule'?'Choose a future time in Asia/Kuala_Lumpur. Confirm the saved revision and eligible accounts before activating its schedule.':'Save without a date or approval. Review and publishing remain separate actions.'}</p>
 {content&&content.status!=='draft'?<p className="post-editor-help">{savedStatus.next} Saving edits creates a new draft revision and invalidates its approval.</p>:null}
 </section>
 {brand.outlet_ids?.length?<fieldset className="post-outlet-targets"><legend>Outlet targets</legend>{brand.outlet_ids.map(id=><label key={id}><input type="checkbox" checked={payload.outlet_ids.includes(id)} onChange={e=>onChange({...payload,outlet_ids:e.target.checked?[...payload.outlet_ids,id]:payload.outlet_ids.filter(v=>v!==id)})}/>{brand.outlets?.find(o=>o.id===id)?.name||'Brand outlet'}</label>)}</fieldset>:null}
 </fieldset>
 <section className="post-editor-section" aria-label="Channel content">
 <div className="post-channel-heading"><h3>Channel content</h3><div role="group" aria-label="Publishing channels" className="post-channel-selection">{Object.keys(POST_FORMATS).map(name=>{const checked=payload.variants.some(v=>v.channel===name);return <button type="button" key={name} className="post-channel-chip" disabled={busy} aria-pressed={checked} onClick={()=>toggleChannel(name,!checked)}><span aria-hidden="true"><SocialChannelIcon value={name}/></span>{label(name)}{checked?<Check size={13} aria-hidden="true"/>:null}</button>})}</div></div>
 {variant?<><AdminSegmentedControl label="Edit channel" value={channel} onChange={value=>{setSelected(value);setCopied('')}} options={payload.variants.map(v=>({value:v.channel,label:label(v.channel)}))}/>
 <fieldset disabled={busy} className="post-channel-fields">
 <SelectField label={`${label(channel)} format`} value={variant.format} onChange={format=>patchVariant({format,asset_ids:[]})} options={[...(POST_FORMATS[channel]||[]),...(!POST_FORMATS[channel]?.includes(variant.format)?[variant.format]:[])].map(format=>({value:format,label:format==='story'&&!storyAvailable?'Story · Business verification required':channel==='facebook'&&format==='video'?'Video Post':label(format),disabled:!POST_FORMATS[channel]?.includes(format)||format==='story'&&!storyAvailable}))}/>
 <AdminFormField label={variant.format==='story'?'Story description (internal only)':`${label(channel)} caption`} helper={`${variant.caption?.length||0} / ${channel==='instagram'?'2,200':'63,206'} characters`}><textarea key={channel} ref={captionInput} onSelect={e=>{positions.current[channel]=e.currentTarget.selectionStart}} className="control post-caption-input" rows={5} value={variant.caption} maxLength={channel==='instagram'?2200:63206} onChange={e=>patchVariant({caption:e.target.value})}/></AdminFormField>
 <CaptionLibrary key={`saved-text:${channel}`} brand={brand} can={can} disabled={busy} onInsert={insertSaved}/>
 {other?<div className="post-caption-copy"><button type="button" className="btn-secondary" disabled={busy||!other.caption||other.caption.length>(channel==='instagram'?2200:63206)} onClick={()=>{patchVariant({caption:other.caption});setCopied(`Caption copied from ${label(other.channel)}.`)}}><Copy size={14}/>Copy caption from {label(other.channel)}</button>{copied?<span role="status">{copied}</span>:null}</div>:null}
 {other&&isVideoFormat(variant.format)&&isVideoFormat(other.format)&&other.asset_ids.length===1&&allAssets.some(a=>a.id===other.asset_ids[0]&&a.brand_id===brand.id&&a.organization_id===brand.organization_id&&publishingMediaEligible(a,variant.format,channel))?<button type="button" className="btn-secondary" disabled={busy} onClick={()=>patchVariant({asset_ids:[...other.asset_ids]})}><Copy size={14}/>Use {label(other.channel)} video</button>:null}
 {variant.format!=='text'?<MarketingMediaPicker key={`media:${channel}`} thumbnailPreviews disabled={busy} channel={channel} brand={brand} format={variant.format} values={variant.asset_ids} assets={allAssets} onAssetsResolved={records=>setCache(current=>[...new Map([...current,...records].map(a=>[a.id,a])).values()])} onChange={asset_ids=>patchVariant({asset_ids})}/>:null}
 {variant.format==='reel'?<ReelCoverEditor key={`cover:${channel}:${variant.asset_ids[0]||''}`} variant={variant} brand={brand} assets={allAssets} disabled={busy} onChange={reel_cover=>patchVariant({reel_cover})} onAssetsResolved={records=>setCache(current=>[...new Map([...current,...records].map(a=>[a.id,a])).values()])} onMetadata={(id,metadata)=>setObservations(current=>({...current,[id]:metadata}))}/>:null}
 <p className="post-editor-help">{variant.format==='story'?'One 9:16 JPEG or H.264 MP4 (3–60 seconds), up to 8 MB / 50 MB. Description is internal; API stickers, music and links are unavailable.':variant.format==='carousel'?channel==='instagram'?'2–10 JPEG/MP4 items · 3–60 second H.264 clips · all items use the first item’s crop.':'2–10 images · selection order is publication order.':isVideoFormat(variant.format)?'One MP4 video, up to 50 MB. Facebook Reels use the verified 9:16, 4–60 second subset; server checks apply.':variant.format==='image'?`One ${channel==='instagram'?'JPEG':'image'}, up to 8 MB.`:'Facebook text post · no media required.'}</p>
 </fieldset></>:<p>Select Facebook or Instagram to prepare a channel variant.</p>}
 </section></div>
 <aside className="post-editor-preview" aria-label="Post preview and readiness">
 <div className="post-preview-heading"><h3>Live preview</h3><Badge>Unsaved preview</Badge></div>
 {variant?<article className={`post-preview-frame ${variant.format==='reel'?'post-preview-reel':''}`} aria-label={`${label(channel)} post preview`}><header><span className="post-preview-brandmark" aria-hidden="true">{brand.name?.slice(0,1)}</span><div><strong>{brand.name}</strong><span>{label(channel)} · {label(variant.format)}</span></div></header>
 {variant.format!=='text'?(variant.asset_ids.length?<PostMedia key={`${channel}:${variant.format}:${variant.asset_ids.join(',')}`} channel={variant} assets={allAssets} onMetadata={(id,metadata)=>setObservations(current=>({...current,[id]:metadata}))}/>:<div className="post-preview-placeholder"><ImageIcon size={26}/><span>Select media to preview this post</span></div>):null}
 <p className="post-preview-caption">{variant.caption||'Your caption preview will appear here.'}</p></article>:null}
 <section className="post-readiness" aria-label="Publishing readiness"><h3>Publishing readiness</h3>
 {channel==='facebook'&&isVideoFormat(variant?.format)&&!videoEnabled?<p><AlertCircle size={15}/>Facebook video execution is disabled. Separate format authorization is required.</p>:null}
 {extendedInstagramVariant(variant,allAssets)&&!extendedEnabled?<p><AlertCircle size={15}/>Instagram Stories and video carousels are not enabled for execution. Separate format authorization and current account eligibility are required.</p>:null}
 {variant?.format==='story'&&!account?.capabilities?.story_business_verified?<p><AlertCircle size={15}/>Stories require current verified Instagram Business eligibility.</p>:null}
 {!payload.title.trim()?<p><AlertCircle size={15}/>Add a creative concept title.</p>:null}
 {issues.length?<ul>{issues.map(issue=><li key={issue}><AlertCircle size={15}/><span>{issue}</span></li>)}</ul>:<p><CheckCircle2 size={15}/>Caption and selected media meet draft checks.</p>}
 {accountError?<div><p role="alert">{accountError}</p><button type="button" className="btn-secondary" onClick={()=>setRetry(v=>v+1)}>Retry account check</button></div>:accounts===null?<p role="status">Checking connected account…</p>:account?<p><CheckCircle2 size={15}/><span>{account.account_name} · Publishing eligible{!account.capabilities.execution_enabled?' · execution disabled':''}</span></p>:<p><AlertCircle size={15}/><span>No currently eligible account for this format. <a href={`/marketing/connections?marketing_org=${encodeURIComponent(brand.organization_id)}&marketing_brand=${encodeURIComponent(brand.id)}`}>Review Connections</a></span></p>}
 <p className="post-editor-help">Draft checks are advisory. Meta checks dimensions, processing and account restrictions before publishing. Saving does not approve or send this post.</p>
 {payload.variants.length>1?<div className="post-readiness-other">{payload.variants.filter(v=>v.channel!==channel).map(v=><button type="button" key={v.channel} onClick={()=>{setSelected(v.channel);setView('editor')}}>{label(v.channel)} · {variantIssues(v,allAssets,brand).length?'Needs content review':'Draft checks passed'}</button>)}</div>:null}
 </section></aside></div>;
}
