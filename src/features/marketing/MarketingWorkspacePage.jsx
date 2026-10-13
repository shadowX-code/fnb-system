import {resolveBrandContext,selectBrandContext} from './brandContext.js';
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import { marketingService } from './marketingService.js';
import { localInput, scheduleInstant } from './marketingCalendar.js';
import './marketing.css';
import MarketingMediaPicker from './MarketingMediaPicker.jsx';
import MediaLibrary from './MediaLibrary.jsx';
import { MarketingOverview, MarketingSocialAnalytics } from './MarketingDashboards.jsx';
import GoogleDriveSettings from './GoogleDriveSettings.jsx';
import ContentManagement from './ContentManagement.jsx';
import PostDetail from './PostDetail.jsx';
import { MetaConnections, PublishAuthorization } from './MetaIntegrationPanels.jsx';

const labels = { overview: 'Overview', content: 'Content Management', media: 'Media Library', calendar: 'Content Management', analytics: 'Social Analytics', settings: 'Brand Knowledge & Connections' };
const descriptions = {
  overview: 'See what needs attention and keep your brands moving.',
  content: '',
  media: '',
  calendar: '',
  analytics: 'Understand your organic content performance.',
  settings: 'Manage Brand knowledge, team access and connections.',
};
const emptyContext = { organizations: [], brands: [] };
const fields = ['positioning','audience','voice','identity','menu','products','pricing','rules','references'];
const titleCase = value => value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const newPayload = () => ({ title: '', outlet_ids: [], variants: [{ channel: 'facebook', format: 'text', caption: '', asset_ids: [] }] });

export default function MarketingWorkspacePage({ section = 'overview' }) {
  if(section==='content')section='calendar';
  const auth = useAuth();
  const [overviewMonth,setOverviewMonth]=useState(()=>localInput(new Date(),'Asia/Kuala_Lumpur').slice(0,7)+'-01');
  const [settingsTab, setSettingsTab] = useState(()=>new URLSearchParams(window.location.search).has('drive_result')?'drive':'social');
  const [context, setContext] = useState(emptyContext);
  const [organizationId, setOrganizationId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [bootstrapError, setBootstrapError] = useState('');
  const [booting, setBooting] = useState(true);
  const [read, setRead] = useState(null);
  const [setup, setSetup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(null);
  const lifetime = useRef(0);
  const callbackScopeApplied = useRef(false);
  const can = code => auth.hasPermission(code);
  const brands = context.brands.filter(b => b.organization_id === organizationId);
  const brand = brands.find(b => b.id === brandId);
  const timezone = brand?.timezone || 'Asia/Kuala_Lumpur';
  const key = JSON.stringify([organizationId,brandId,section,page,pageSize,refresh,auth.user?.id]);
  const data = read?.key === key ? read.data : null;

  useEffect(() => {
    let live = true;
    setBooting(true); setContext(emptyContext); setBootstrapError('');
    marketingService.context().then(result => {
      if (!live) return;
      setContext(result);
      if (!callbackScopeApplied.current) {
        callbackScopeApplied.current = true;
        const query = new URLSearchParams(window.location.search);
        let saved = {}; try { saved = JSON.parse(sessionStorage.getItem(`marketing.content-scope.${auth.user?.id}`) || '{}'); } catch {}
        const org = query.get('marketing_org') || (['calendar','media'].includes(section) ? saved.org : ''), selectedBrand = query.get('marketing_brand') || (['calendar','media'].includes(section) ? saved.brand : '');
        if (selectedBrand || result.organizations.some(o => o.id === org)) { const next=resolveBrandContext(result,selectedBrand,org);setOrganizationId(next.org);setBrandId(next.brand);return; }
      }
      setOrganizationId(current => result.organizations.some(o => o.id === current) ? current : result.organizations[0]?.id || '');
    }).catch(e => { if (live) setBootstrapError(e.message); }).finally(() => { if (live) setBooting(false); });
    return () => { live = false; lifetime.current++; };
  }, [auth.user?.id, refresh]);
  useEffect(() => {
    let live = true;
    setLoading(Boolean(organizationId)); setError(''); setSetup(null);
    if (!organizationId || booting) return () => { live = false; };
    (['calendar','media','overview','analytics'].includes(section) ? Promise.resolve({rows:[],assets:[],jobs:[],total:0}) : marketingService.read({ organizationId, brandId, section, page, pageSize }))
      .then(result => { if (live) setRead({ key, data: result }); })
      .catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    if (section === 'settings') marketingService.setup(organizationId).then(result => { if (live) setSetup(result); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [key, booting]);
  useEffect(() => { setPage(1); setModal(null); request.current = null; setNotice(''); }, [organizationId, brandId, section, auth.user?.id]);
  useEffect(() => { if(data && page>Math.max(1,Math.ceil(data.total/pageSize)))setPage(Math.max(1,Math.ceil(data.total/pageSize))); },[data?.total,page,pageSize]);
  useEffect(() => { if (!booting && !brands.some(b => b.id === brandId)) setBrandId(['calendar','media'].includes(section) ? brands[0]?.id || '' : ''); }, [context, organizationId, brandId, booting, section]);
  useEffect(() => {
    if (booting || !brand || !['calendar','media'].includes(section)) return;
    try { sessionStorage.setItem(`marketing.content-scope.${auth.user?.id}`, JSON.stringify({org: organizationId, brand: brandId})); } catch {}
    const url = new URL(window.location.href); url.searchParams.set('marketing_org', organizationId); url.searchParams.set('marketing_brand', brandId);
    window.history.replaceState(window.history.state, '', url);
  }, [organizationId, brandId, booting, section, auth.user?.id]);
  useEffect(() => {
    let live = true; setDetail(null);
    if (modal?.content?.id && can('marketing_content.view')) marketingService.detail(modal.content.id)
      .then(result => { if (live) setDetail({ id: modal.content.id, ...result }); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [modal?.content?.id, auth.user?.id]);

  // Planner handoff opens the current canonical revision through the existing scoped detail authority.
  const linkedOpened = useRef('');
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('content_id');
    if (!id || !brand || booting || section !== 'calendar' || !can('marketing_content.view') || linkedOpened.current === id) return;
    let live = true;
    marketingService.detail(id).then(result => {
      if (!live) return;
      if (result.content?.organization_id !== organizationId || result.content?.brand_id !== brandId) throw new Error('Linked content is unavailable in this brand.');
      linkedOpened.current = id;
      setModal({type:'review',content:result.content});
      const url = new URL(window.location.href);
      if (url.searchParams.get('content_id') === id) { url.searchParams.delete('content_id'); window.history.replaceState(window.history.state, '', url); }
    }).catch(e => { if(live)setError(e.message); });
    return () => {live=false;};
  }, [organizationId,brandId,booting,section,auth.user?.id]);

  async function mutate(action, message) {
    const generation = lifetime.current;
    setBusy(true); setError('');
    try {
      await action();
      if (generation !== lifetime.current) return;
      setModal(null); request.current = null; setNotice(message); setRefresh(v => v+1);
    } catch (e) { if (generation === lifetime.current) setError(e.message); }
    finally { if (generation === lifetime.current) setBusy(false); }
  }
  function command(commandName, content, payload = {}) {
    const intent = { command: commandName, organizationId, brandId: content?.brand_id || brandId, content, payload };
    const fingerprint = JSON.stringify(intent);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    return mutate(() => marketingService.content({ ...intent, requestId: request.current.id }), commandName === 'schedule' ? 'Publishing time saved. External execution requires a separate approval to enabled accounts.' : 'Content updated.');
  }
  const open = value => { setError(''); request.current = null; setModal(value); };
  const scopeControls = <div className="admin-scope-controls" aria-label="Marketing scope">
    <SelectField searchable="auto" label="Brand" value={brandId} onChange={value => { if (!busy) selectBrandContext(context,value,organizationId,setOrganizationId,setBrandId); }} options={[...(['calendar','media'].includes(section) ? [] : [{value:'',label:'All authorized brands'}]),...context.brands.map(b=>({value:b.id,label:b.name}))]} />
    {section==='overview'?<SelectField label="Production month" value={overviewMonth} onChange={setOverviewMonth} options={Array.from({length:16},(_,i)=>{const d=new Date();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-12+i);return {value:d.toISOString().slice(0,7)+'-01',label:new Intl.DateTimeFormat('en-MY',{month:'long',year:'numeric',timeZone:'UTC'}).format(d)}})}/>:null}
  </div>;
  const actions = <>
    {section==='calendar' && brand && brand.is_active!==false && can('marketing_content.create') ? <button className="btn-primary" disabled={busy} onClick={()=>open({type:'content',content:null,payload:newPayload()})}><Plus size={15}/> Create Post</button> : null}

  </>;

  return <WorkspacePage section="Marketing" title={labels[section]} description={descriptions[section]} controls={context.organizations.length ? scopeControls : null} actions={actions}>
    {notice ? <p className="marketing-notice" role="status">{notice}</p> : null}
    <AsyncDataSurface loading={booting || loading} error={bootstrapError || error} onRetry={()=>setRefresh(v=>v+1)} hasData={Boolean(data)}>
      {!booting && !bootstrapError && !context.organizations.length ? <section className="card p-6 space-y-3"><h2 className="font-semibold">Marketing access unavailable</h2><p className="text-sm text-text-secondary">Ask an administrator to grant Brand access and team permissions.</p></section> : null}
      {data && !brands.length ? <section className="card p-5"><p>No Brands are available for your current access.</p>{can('marketing_settings.view') ? <p className="mt-2 text-sm text-text-secondary">Use Restaurant → System → Brands to manage Brands, or ask an administrator to configure Brand access.</p> : null}</section> : null}
      {data && section==='overview' ? <MarketingOverview key={`${organizationId}:${brandId}:${auth.user?.id}`} organizationId={organizationId} brandId={brandId} brands={brand? [brand]:brands} can={can} userId={auth.user?.id} productionMonth={overviewMonth}/> : null}
      {data && section==='analytics' ? <MarketingSocialAnalytics key={`${organizationId}:${brandId}:${auth.user?.id}`} organizationId={organizationId} brandId={brandId} brands={brands} can={can} userId={auth.user?.id}/> : null}
      {data && brand && section==='media' ? <MediaLibrary key={`${organizationId}:${brandId}:${auth.user?.id}`} organizationId={organizationId} brandId={brandId} userId={auth.user?.id}/> : null}
      {brand?.is_active===false?<p className="text-sm text-text-secondary">Inactive Brand · historical records and existing schedules remain available. Reactivate the Brand to start new work.</p>:null}
      {data && brand && section==='calendar' ? <ContentManagement key={`${organizationId}:${brandId}:${auth.user?.id}`} organizationId={organizationId} brandId={brandId} refresh={refresh} open={open} command={command} busy={busy} can={can}/> : null}
      {data && section==='settings' ? <div className="marketing-settings-tabs" role="tablist" aria-label="Marketing settings"><button className="btn-secondary" role="tab" aria-selected={settingsTab==='social'} onClick={()=>setSettingsTab('social')}>Social Accounts</button><button className="btn-secondary" role="tab" aria-selected={settingsTab==='drive'} onClick={()=>setSettingsTab('drive')}>Google Drive</button><button className="btn-secondary" role="tab" aria-selected={settingsTab==='knowledge'} onClick={()=>setSettingsTab('knowledge')}>Knowledge & access</button></div> : null}
      {data && section==='settings' && settingsTab==='knowledge' ? <Settings data={data} setup={setup} brands={brands} brand={brand} can={can} busy={busy} open={open} actorId={context.actor_employee_id} removeMember={employeeId=>mutate(()=>marketingService.teamAccess('remove_member',brandId||brands[0]?.id,{employee_id:employeeId}),'Team access removed.')}/> : null}
    </AsyncDataSurface>
    {section==='settings' && settingsTab==='social' && !booting ? <MetaConnections key={`${organizationId}:${brandId}:${auth.user?.id}`} organizationId={organizationId} brandId={brandId} brands={brands}/> : null}
    {section==='settings' && settingsTab==='drive' && !booting && organizationId ? <GoogleDriveSettings key={`${organizationId}:${brandId}:${auth.user?.id}`} organizationId={organizationId} brandId={brandId} brands={brands}/> : null}
    {modal ? <Modal title={{content:modal.content?'Revise content':'Create Post',review:'Content revision',schedule:'Schedule publishing',knowledge:'Brand Knowledge Profile',member:'Add team member',scope:'Role brand access'}[modal.type]} description={modal.type==='content'?'Saving material changes invalidates approval.':null} size={['content','review','knowledge'].includes(modal.type)?'lg':'sm'} placement={modal.type==='review'?'right':'center'} onClose={()=>{if(!busy)setModal(null);}} footer={<>
      {error ? <p className="mr-auto text-sm text-rose-600" role="alert">{error}</p> : null}
      <button className="btn-secondary" disabled={busy} onClick={()=>setModal(null)}>Close</button>
      {modal.type!=='review' ? <button className="btn-primary" disabled={busy} onClick={()=>{
        if(modal.type==='content')command('save',modal.content,modal.payload);
        if(modal.type==='knowledge')mutate(()=>marketingService.knowledge(brandId,modal.revision,modal.profile),'Brand knowledge saved with provenance.');
        if(modal.type==='member')mutate(()=>marketingService.teamAccess('add_member',brandId||brands[0]?.id,{employee_id:modal.employeeId}),'Team access added. Role permissions and Brand access still apply.');
        if(modal.type==='scope')mutate(()=>marketingService.roleScope(organizationId,modal.roleId,modal.all,modal.brands),'Role brand scope saved.');
        if(modal.type==='schedule'){try{command('schedule',modal.content,{scheduled_at:scheduleInstant(modal.local,modal.timezone),timezone:modal.timezone});}catch(e){setError(e.message);}}
      }}>{busy?'Saving…':modal.type==='schedule'?'Save schedule':'Save'}</button> : null}
      {modal.type==='review' && !modal.content.channels?.some(v=>['leased','reconciling','succeeded'].includes(v.job_state)) ? <>
        {!['published','cancelled'].includes(modal.content.status) && can('marketing_content.edit') ? <button className="btn-secondary" disabled={busy} onClick={()=>open({type:'content',content:modal.content,payload:structuredClone(modal.content.payload)})}>Edit</button> : null}
        {['draft','rejected'].includes(modal.content.status) && can('marketing_content.review') ? <button className="btn-secondary" disabled={busy} onClick={()=>command('review',modal.content)}>Submit review</button> : null}
        {modal.content.status==='approved' && can('marketing_content.publish') ? <button className="btn-secondary" disabled={busy} onClick={()=>open({type:'schedule',content:modal.content,local:'',timezone})}>Schedule</button> : null}
        {!['published','cancelled'].includes(modal.content.status) && can('marketing_content.cancel') ? <button className="btn-secondary" disabled={busy} onClick={()=>command('cancel',modal.content)}>Cancel</button> : null}
      </> : null}
      {modal.type==='review' && modal.content.status==='review' && can('marketing_content.approve') ? <><button className="btn-secondary" disabled={busy||!modal.reason?.trim()} onClick={()=>command('reject',modal.content,{reason:modal.reason})}>Reject</button><button className="btn-primary" disabled={busy} onClick={()=>command('approve',modal.content)}>Approve revision {modal.content.revision}</button></> : null}
    </>}>
      <ModalBody modal={modal} setModal={setModal} brands={brands} brand={brand} setup={setup} assets={[...new Map([...(data?.assets||[]),...(detail && detail.id===modal.content?.id?detail.assets:[])].map(a=>[a.id,a])).values()]} can={can} onExecutionComplete={()=>{setModal(null);setRefresh(v=>v+1);setNotice('External execution authorized for the reviewed revision.');}} detail={detail && detail.id===modal.content?.id?detail:null}/>
    </Modal> : null}
  </WorkspacePage>;
}

function Checks({values,onChange,options,label}) { return <fieldset className="space-y-2"><legend className="text-sm font-semibold">{label}</legend>{options.map(o=><label className="flex items-center gap-2 text-sm" key={o.id}><input type="checkbox" checked={values.includes(o.id)} onChange={e=>onChange(e.target.checked?[...values,o.id]:values.filter(id=>id!==o.id))}/>{o.name}</label>)}</fieldset>; }
function Settings({data,setup,brands,brand,can,busy,open,actorId,removeMember}) {
  const knowledge=data.knowledge.find(k=>k.brand_id===brand?.id);
  return <div className="space-y-5">
    <section className="card p-5 space-y-3"><h2 className="font-semibold">Brand Knowledge Profile</h2><p className="text-sm text-text-secondary">Brand facts, referenced research and AI suggestions retain distinct provenance. A human-authored verified fact is an explicit brand assertion.</p>{brand?<><p>{brand.name} · Knowledge revision {knowledge?.revision||0} · {brand.timezone}</p>{knowledge?fields.filter(f=>knowledge.profile[f]?.text).map(f=><div className="marketing-knowledge" key={f}><h3>{titleCase(f)}</h3><p>{knowledge.profile[f].text}</p><small>{titleCase(knowledge.profile[f].provenance)}{knowledge.profile[f].source_url?<a href={knowledge.profile[f].source_url} target="_blank" rel="noreferrer"> · Source</a>:null}</small></div>):<p className="text-sm">No brand knowledge has been saved.</p>}{can('marketing_settings.manage')?<button className="btn-secondary" disabled={busy} onClick={()=>open({type:'knowledge',revision:knowledge?.revision||0,profile:structuredClone(knowledge?.profile||{})})}>Edit knowledge</button>:null}</>:<p className="text-sm">Select a brand to manage its knowledge.</p>}</section>
    {can('platform_organizations.manage')?<section className="card p-5 space-y-3"><h2 className="font-semibold">Brand Access & Team Permissions</h2><p className="text-sm text-text-secondary">Manage Brands in Restaurant System. Team access and Brand permissions are managed separately.</p><div className="flex flex-wrap gap-2"><a className="btn-secondary" href="/system/brands">Manage Brands & Outlets</a>{can('employees.view')?<button className="btn-secondary" disabled={busy||!setup} onClick={()=>open({type:'member',employeeId:''})}>Add team member</button>:null}</div>{setup?.members.map(m=><div className="marketing-row" key={m.id}><span>{m.name}</span>{m.id!==actorId?<button className="btn-secondary" disabled={busy} onClick={()=>removeMember(m.id)}>Remove Marketing access</button>:<span className="text-sm text-text-secondary">Your team access</span>}</div>)}</section>:null}
    {can('roles.edit')&&can('marketing_settings.configure')?<section className="card p-5 space-y-3"><h2 className="font-semibold">Brand-scoped role access</h2><p className="text-sm text-text-secondary">Roles grant actions through FeedX Roles & Permissions. Staff require team access and an authorized Brand scope. Administrators remain limited to their permitted Brands.</p><button className="btn-secondary" disabled={busy||!setup} onClick={()=>open({type:'scope',roleId:'',all:false,brands:[]})}>Configure role scope</button>{data.role_scopes.map(s=><div className="marketing-row" key={s.role_id}><span>{setup?.roles.find(r=>r.id===s.role_id)?.name||'Role'} · {s.all_brands?'All brands':`${s.brand_ids.length} selected brands`}</span><button className="btn-secondary" disabled={busy} onClick={()=>open({type:'scope',roleId:s.role_id,all:s.all_brands,brands:s.brand_ids})}>Edit scope</button></div>)}</section>:null}
  </div>;
}
function ModalBody({modal,setModal,brands,brand,setup,assets,can,detail,onExecutionComplete}) {
  const change=patch=>setModal(current=>({...current,...patch}));
  const field=(label,key,type='text')=><AdminFormField label={label}><input className="control" type={type} value={modal[key]||''} onChange={e=>change({[key]:e.target.value})}/></AdminFormField>;
  if(modal.type==='member')return <SelectField label="FeedX employee" value={modal.employeeId} onChange={employeeId=>change({employeeId})} options={[{value:'',label:'Select employee'},...(setup?.employees||[]).map(e=>({value:e.id,label:e.name}))]}/>;
  if(modal.type==='scope')return <div className="space-y-4"><SelectField label="Role" value={modal.roleId} onChange={roleId=>change({roleId})} options={[{value:'',label:'Select role'},...(setup?.roles||[]).map(r=>({value:r.id,label:r.name}))]}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={modal.all} onChange={e=>change({all:e.target.checked})}/>All managed Brands</label>{!modal.all?<Checks label="Authorized brands" values={modal.brands} onChange={values=>change({brands:values})} options={brands}/>:null}</div>;
  if(modal.type==='schedule')return <div className="space-y-4"><p className="text-sm">Scheduling pins revision {modal.content.revision}. Execution requires a separate approval of this exact revision to enabled Meta accounts.</p>{field('Publishing time','local','datetime-local')}{field('Timezone','timezone')}</div>;
  if(modal.type==='knowledge')return <div className="space-y-5">{fields.map(f=>{const entry=modal.profile[f]||{text:'',provenance:'verified_brand_fact'};const update=patch=>change({profile:{...modal.profile,[f]:{...entry,...patch}}});return <div className="space-y-2" key={f}><AdminFormField label={titleCase(f)}><textarea className="control min-h-20" value={entry.text} onChange={e=>update({text:e.target.value})} maxLength={8000}/></AdminFormField><SelectField label={`${titleCase(f)} provenance`} value={entry.provenance} onChange={provenance=>update({provenance})} options={[{value:'verified_brand_fact',label:'Verified brand fact (human assertion)'},{value:'external_research',label:'External research'},{value:'ai_suggestion',label:'AI suggestion (unverified)'}]}/>{entry.provenance==='external_research'?<AdminFormField label="Source URL"><input className="control" type="url" value={entry.source_url||''} onChange={e=>update({source_url:e.target.value,observed_at:new Date().toISOString()})}/></AdminFormField>:null}</div>;})}</div>;
  if(modal.type==='review')return <PostDetail content={modal.content} assets={assets} events={detail?.events||[]}><PublishAuthorization key={`${modal.content.id}:${modal.content.revision}`} content={modal.content} onComplete={onExecutionComplete}/>{modal.content.status==='review'&&can('marketing_content.approve')?<AdminFormField label="Rejection reason (required to reject)"><textarea className="control" value={modal.reason||''} onChange={e=>change({reason:e.target.value})}/></AdminFormField>:null}</PostDetail>;
  if(modal.type==='content') {
    const payload=modal.payload;
    const update=patch=>change({payload:{...payload,...patch}});
    const variant=(index,patch)=>update({variants:payload.variants.map((v,i)=>i===index?{...v,...patch}:v)});
    const currentBrand=brands.find(b=>b.id===(modal.content?.brand_id||brand?.id));
    return <div className="space-y-5"><AdminFormField label="Creative concept title" required><input className="control" value={payload.title} maxLength={200} onChange={e=>update({title:e.target.value})}/></AdminFormField><AdminFormField label="Planned publishing date" helper="Optional · Asia/Kuala_Lumpur"><input className="control" type="datetime-local" value={payload.planned_at ? localInput(new Date(payload.planned_at),'Asia/Kuala_Lumpur') : ''} onChange={e=>{try{update({planned_at:e.target.value?scheduleInstant(e.target.value,'Asia/Kuala_Lumpur'):null,planned_timezone:'Asia/Kuala_Lumpur'});}catch{ /* Incomplete native date input. */ }}} /></AdminFormField><Checks label="Outlet targets" values={payload.outlet_ids} onChange={outlet_ids=>update({outlet_ids})} options={(currentBrand?.outlet_ids||[]).map(id=>({id,name:currentBrand?.outlets?.find(o=>o.id===id)?.name||'Brand outlet'}))}/><fieldset className="space-y-2"><legend className="text-sm font-semibold">Channels</legend>{['facebook','instagram'].map(channel=><label className="mr-4 inline-flex items-center gap-2 text-sm" key={channel}><input type="checkbox" checked={payload.variants.some(v=>v.channel===channel)} onChange={e=>update({variants:e.target.checked?[...payload.variants,{channel,format:channel==='instagram'?'image':'text',caption:'',asset_ids:[]}]:payload.variants.filter(v=>v.channel!==channel)})}/>{titleCase(channel)}</label>)}</fieldset>{payload.variants.map((v,index)=><section className="marketing-variant" key={v.channel}><h3>{titleCase(v.channel)} variant</h3><SelectField label={`${titleCase(v.channel)} format`} value={v.format} onChange={format=>variant(index,{format,asset_ids:[]})} options={['text','image','carousel','reel'].filter(format=>v.channel!=='instagram'||format!=='text').map(format=>({value:format,label:titleCase(format)}))}/><AdminFormField label={`${titleCase(v.channel)} caption`} helper={v.channel==='instagram'?'Up to 2,200 characters.':'Up to 63,206 characters.'}><textarea className="control min-h-28" value={v.caption} maxLength={v.channel==='instagram'?2200:63206} onChange={e=>variant(index,{caption:e.target.value})}/></AdminFormField>{v.format!=='text'?<MarketingMediaPicker channel={v.channel} assets={assets} brand={currentBrand} format={v.format} values={v.asset_ids} onChange={asset_ids=>variant(index,{asset_ids})}/>:null}<p className="text-xs text-text-secondary">{v.format==='carousel'?'Choose 2–10 images.':v.format==='reel'?'Choose one MP4 video. Platform duration and aspect ratio checks are required before external publishing.':v.format==='image'?'Choose one image. Platform media validation is required before external publishing.':'Facebook text post.'}</p></section>)}</div>;
  }
  return null;
}
