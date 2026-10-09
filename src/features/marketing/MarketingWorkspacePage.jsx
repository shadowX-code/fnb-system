import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Plus, Upload, ExternalLink } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import AdminSummaryGrid from '../../components/ui/AdminSummaryGrid.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import Badge from '../../components/ui/Badge.jsx';
import AdminPagination, { useAdminPagedQuery } from '../../components/tables/AdminPagination.jsx';
import { marketingService } from './marketingService.js';
import { calendarRange, localInput, scheduleInstant } from './marketingCalendar.js';
import './marketing.css';
import { MetaConnections, PublishAuthorization, SocialEvidence } from './MetaIntegrationPanels.jsx';

const labels = { overview: 'Overview', content: 'Content Library', calendar: 'Calendar', analytics: 'Analytics', settings: 'Brand Knowledge & Connections' };
const descriptions = {
  overview: 'Publishing activity, approvals and delivery actions across your brands.',
  content: 'Create channel variants, review exact revisions and plan publishing.',
  calendar: 'Review your publishing plan by brand and timezone.',
  analytics: 'Verified workflow outcomes and the evidence available to Marketing.',
  settings: 'Manage brand knowledge, shared ownership and connection readiness.',
};
const emptyContext = { organizations: [], brands: [] };
const fields = ['positioning','audience','voice','identity','menu','products','pricing','rules','references'];
const titleCase = value => value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const statusTone = status => ['approved','published','ready'].includes(status) ? 'success' : ['failed','rejected','blocked'].includes(status) ? 'danger' : ['review','scheduled'].includes(status) ? 'warning' : 'neutral';
function Status({ value }) { return <Badge tone={statusTone(value)}>{titleCase(value)}</Badge>; }
function Stamp({ value, timezone }) { return value ? <time dateTime={value}>{new Intl.DateTimeFormat('en-MY', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))}</time> : <span>Unscheduled</span>; }
const newPayload = () => ({ title: '', outlet_ids: [], variants: [{ channel: 'facebook', format: 'text', caption: '', asset_ids: [] }] });

export default function MarketingWorkspacePage({ section = 'overview' }) {
  const auth = useAuth();
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
  const [mode, setMode] = useState('month');
  const [anchor, setAnchor] = useState(() => localInput(new Date(), 'Asia/Kuala_Lumpur').slice(0,10));
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
  const range = useMemo(() => calendarRange(anchor, mode, timezone), [anchor, mode, timezone]);
  const key = JSON.stringify([organizationId,brandId,section,page,pageSize,section==='calendar' ? range : null,refresh,auth.user?.id]);
  const data = read?.key === key ? read.data : null;

  useEffect(() => {
    let live = true;
    setBooting(true); setContext(emptyContext); setBootstrapError('');
    marketingService.context().then(result => {
      if (!live) return;
      setContext(result);
      if (!callbackScopeApplied.current) {
        callbackScopeApplied.current = true;
        const query = new URLSearchParams(window.location.search), org = query.get('marketing_org'), selectedBrand = query.get('marketing_brand');
        if (result.organizations.some(o => o.id === org) && result.brands.some(b => b.id === selectedBrand && b.organization_id === org)) { setOrganizationId(org);setBrandId(selectedBrand);return; }
      }
      setOrganizationId(current => result.organizations.some(o => o.id === current) ? current : result.organizations[0]?.id || '');
    }).catch(e => { if (live) setBootstrapError(e.message); }).finally(() => { if (live) setBooting(false); });
    return () => { live = false; lifetime.current++; };
  }, [auth.user?.id, refresh]);
  useEffect(() => {
    let live = true;
    setLoading(Boolean(organizationId)); setError(''); setSetup(null);
    if (!organizationId || booting) return () => { live = false; };
    marketingService.read({ organizationId, brandId, section, from: range.from, to: range.to, page, pageSize })
      .then(result => { if (live) setRead({ key, data: result }); })
      .catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    if (section === 'settings') marketingService.setup(organizationId).then(result => { if (live) setSetup(result); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [key, booting]);
  useEffect(() => { setPage(1); setModal(null); request.current = null; setNotice(''); }, [organizationId, brandId, section]);
  useEffect(() => { if(data && page>Math.max(1,Math.ceil(data.total/pageSize)))setPage(Math.max(1,Math.ceil(data.total/pageSize))); },[data?.total,page,pageSize]);
  useEffect(() => { if (brandId && !brands.some(b => b.id === brandId) && !booting) setBrandId(''); }, [context, organizationId, brandId, booting]);
  useEffect(() => {
    let live = true; setDetail(null);
    if (modal?.content?.id && can('marketing_content.view')) marketingService.detail(modal.content.id)
      .then(result => { if (live) setDetail({ id: modal.content.id, ...result }); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [modal?.content?.id, auth.user?.id]);

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
  const scopeControls = <AdminFilterToolbar ariaLabel="Marketing scope" filters={<>
    <SelectField label="Organization" value={organizationId} onChange={value => { if (!busy) { setOrganizationId(value); setBrandId(''); } }} options={context.organizations.map(o => ({ value:o.id,label:o.name }))} />
    <SelectField label="Brand" value={brandId} onChange={value => { if (!busy) setBrandId(value); }} options={[{value:'',label:'All authorized brands'},...brands.map(b=>({value:b.id,label:b.name}))]} />
    {section === 'calendar' ? <SelectField label="Calendar view" value={mode} onChange={value => {setMode(value);setPage(1);}} options={[{value:'month',label:'Month'},{value:'week',label:'Week'}]} /> : null}
    {section === 'calendar' ? <AdminFormField label="Calendar date"><input className="input" type="date" value={anchor} required onChange={e=>{if(e.target.value){setAnchor(e.target.value);setPage(1);}}} /></AdminFormField> : null}
  </>} />;
  const actions = <>
    {section==='content' && brand && can('marketing_content.create') ? <button className="btn-primary" disabled={busy} onClick={()=>open({type:'content',content:null,payload:newPayload()})}><Plus size={15}/> New draft</button> : null}
    {section==='content' && brand && can('marketing_content.upload') ? <label className="btn-secondary"><Upload size={15}/> Upload media<input className="sr-only" aria-label="Upload brand media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)mutate(()=>marketingService.upload(organizationId,brandId,file),'Brand media uploaded.');}} /></label> : null}
  </>;

  return <WorkspacePage section="Marketing" title={labels[section]} description={descriptions[section]} controls={context.organizations.length ? scopeControls : null} actions={actions}>
    {notice ? <p className="marketing-notice" role="status">{notice}</p> : null}
    <AsyncDataSurface loading={booting || loading} error={bootstrapError || error} onRetry={()=>setRefresh(v=>v+1)} hasData={Boolean(data)}>
      {!booting && !bootstrapError && !context.organizations.length ? <section className="card p-6 space-y-3"><h2 className="font-semibold">Set up your Marketing organization</h2><p className="text-sm text-text-secondary">Organization membership and brand ownership are explicit. Create your organization, then add brands and authorized team members.</p>{can('platform_organizations.manage') ? <button className="btn-primary" onClick={()=>open({type:'organization',name:''})}>Create organization</button> : <p className="text-sm">Ask an organization administrator to grant membership.</p>}</section> : null}
      {data && !brands.length ? <section className="card p-5"><p>No brands are available in this organization.</p>{can('marketing_settings.view') ? <p className="mt-2 text-sm text-text-secondary">Use Brand Knowledge & Connections to create brands or configure your role’s brand access.</p> : null}</section> : null}
      {data && ['overview','analytics'].includes(section) ? <>
        <AdminSummaryGrid items={['review','approved','scheduled','published'].map(id=>({key:id,label:titleCase(id),value:data.summary?.[id] ?? 0,helper:'Saved content records'}))}/>
        <section className="card p-5 space-y-3"><h2 className="font-semibold">{section==='overview' ? 'Action Center' : 'Publishing outcomes'}</h2>
          <MarketingListPanel organizationId={organizationId} brandId={brandId} kind={section==='overview'?'jobs':'analytics_jobs'} refresh={refresh} renderRows={rows=><JobList jobs={rows} timezone={timezone}/>} emptyTitle="No publishing jobs"/>
          {section==='overview' ? <MarketingListPanel organizationId={organizationId} brandId={brandId} kind="approvals" refresh={refresh} emptyTitle="No pending approvals" renderRows={rows=>rows.map(c=><div className="marketing-row" key={c.id}><span><strong>{c.payload.title}</strong><small>{c.brand_name} · Revision {c.revision} requires review</small></span>{can('marketing_content.approve')&&can('marketing_content.view') ? <button className="btn-secondary" disabled={busy} onClick={()=>open({type:'review',content:c})}>Review content</button> : <Status value="review"/>}</div>)}/> : null}
        </section>
        <section className="card p-5 space-y-2"><h2 className="font-semibold">Evidence availability</h2><p className="text-sm text-text-secondary">Workflow counts use saved FeedX records. Social metrics appear only when collected from authorized accounts. Conversions and provider costs remain unavailable.</p><p className="text-sm text-text-secondary">Marketing has no customer, loyalty or financial mutation authority. Revenue attribution and AI insights are not available in this phase.</p></section>
      </> : null}
      {data && section==='analytics' ? <SocialEvidence key={`${organizationId}:${brandId}:${auth.user?.id}`} organizationId={organizationId} brandId={brandId}/> : null}
      {data && section==='content' ? <>
        {!brand ? <p className="text-sm text-text-secondary">Select a brand to create content or upload assets. Browse across brands below.</p> : null}
        <ContentRows rows={data.rows} busy={busy} can={can} open={open} command={command} timezone={timezone}/>
        <AdminPagination page={page} pageSize={pageSize} total={data.total} loading={loading||busy} onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1);}} noun="content records"/>
        <section className="card p-5 space-y-3"><h2 className="font-semibold">Brand media</h2><p className="text-sm text-text-secondary">Private, immutable uploaded files. Up to 100 MB: JPG, PNG, WebP and MP4. Showing the current page of assets.</p>
          <MarketingListPanel organizationId={organizationId} brandId={brandId} kind="assets" refresh={refresh} emptyTitle="No uploaded brand media" renderRows={rows=>rows.map(a=><div className="marketing-row" key={a.id}><span><strong>{a.filename}</strong><small>{a.mime_type} · {(a.size_bytes/1024/1024).toFixed(1)} MB</small></span><button className="btn-secondary" disabled={busy} onClick={()=>mutate(async()=>{const url=await marketingService.assetUrl(a);window.open(url,'_blank','noopener,noreferrer');},'Media opened with a temporary private link.')}><ExternalLink size={14}/> Open</button></div>)}/>
        </section>
      </> : null}
      {data && section==='calendar' ? <>
        <p className="text-sm text-text-secondary">{timezone} · {data.total} scheduled records in this range. A saved schedule is a plan; each channel’s delivery state is shown separately.</p>
        <div className="marketing-calendar" aria-label={`${titleCase(mode)} publishing calendar`}>{range.days.map(day=><section className="marketing-calendar-day" key={day}><h2>{new Intl.DateTimeFormat('en-MY',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short'}).format(new Date(`${day}T12:00:00Z`))}</h2>{data.rows.filter(c=>localInput(new Date(c.scheduled_at),timezone).startsWith(day)).map(c=><button className="marketing-calendar-post" key={c.id} onClick={()=>open({type:'review',content:c})}><strong>{c.payload.title}</strong><small>{c.brand_name}</small><Status value={c.status}/><small>{data.jobs.filter(j=>j.content_id===c.id&&j.revision===c.revision).map(j=>`${titleCase(j.channel)}: ${titleCase(j.state)}`).join(' · ')}</small></button>)}</section>)}</div>
        <AdminPagination page={page} pageSize={pageSize} total={data.total} loading={loading||busy} onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1);}} noun="scheduled records"/>
      </> : null}
      {data && section==='settings' ? <Settings data={data} setup={setup} brands={brands} brand={brand} can={can} busy={busy} open={open} actorId={context.actor_employee_id} removeMember={employeeId=>mutate(()=>marketingService.structure('remove_member',organizationId,{employee_id:employeeId}),'Organization membership removed.')}/> : null}
    </AsyncDataSurface>
    {section==='settings' && !booting ? <MetaConnections key={`${organizationId}:${brandId}:${auth.user?.id}`} organizationId={organizationId} brandId={brandId} brands={brands}/> : null}
    {modal ? <Modal title={{content:modal.content?'Revise content':'New creative concept',review:'Content revision',schedule:'Schedule publishing',organization:'Create organization',brand:'Brand ownership',knowledge:'Brand Knowledge Profile',member:'Add team member',scope:'Role brand access'}[modal.type]} description={modal.type==='content'?'Saving material changes invalidates approval.':null} size={['content','review','knowledge'].includes(modal.type)?'lg':'sm'} onClose={()=>{if(!busy)setModal(null);}} footer={<>
      {error ? <p className="mr-auto text-sm text-rose-600" role="alert">{error}</p> : null}
      <button className="btn-secondary" disabled={busy} onClick={()=>setModal(null)}>Close</button>
      {modal.type!=='review' ? <button className="btn-primary" disabled={busy} onClick={()=>{
        if(modal.type==='content')command('save',modal.content,modal.payload);
        if(modal.type==='organization')mutate(()=>marketingService.structure('create_organization',null,{name:modal.name}),'Organization created.');
        if(modal.type==='brand')mutate(()=>marketingService.structure('save_brand',organizationId,{id:modal.brand?.id,name:modal.name,timezone:modal.timezone,outlet_ids:modal.outlets}),'Brand ownership saved.');
        if(modal.type==='knowledge')mutate(()=>marketingService.knowledge(brandId,modal.revision,modal.profile),'Brand knowledge saved with provenance.');
        if(modal.type==='member')mutate(()=>marketingService.structure('add_member',organizationId,{employee_id:modal.employeeId}),'Organization membership added. Role permissions and brand scope still apply.');
        if(modal.type==='scope')mutate(()=>marketingService.roleScope(organizationId,modal.roleId,modal.all,modal.brands),'Role brand scope saved.');
        if(modal.type==='schedule'){try{command('schedule',modal.content,{scheduled_at:scheduleInstant(modal.local,modal.timezone),timezone:modal.timezone});}catch(e){setError(e.message);}}
      }}>{busy?'Saving…':modal.type==='schedule'?'Save schedule':'Save'}</button> : null}
      {modal.type==='review' && modal.content.status==='review' && can('marketing_content.approve') ? <><button className="btn-secondary" disabled={busy||!modal.reason?.trim()} onClick={()=>command('reject',modal.content,{reason:modal.reason})}>Reject</button><button className="btn-primary" disabled={busy} onClick={()=>command('approve',modal.content)}>Approve revision {modal.content.revision}</button></> : null}
    </>}>
      <ModalBody modal={modal} setModal={setModal} brands={brands} brand={brand} setup={setup} assets={[...new Map([...(data?.assets||[]),...(detail && detail.id===modal.content?.id?detail.assets:[])].map(a=>[a.id,a])).values()]} can={can} onExecutionComplete={()=>{setModal(null);setRefresh(v=>v+1);setNotice('External execution authorized for the reviewed revision.');}} detail={detail && detail.id===modal.content?.id?detail:null}/>
    </Modal> : null}
  </WorkspacePage>;
}

function MarketingListPanel({organizationId,brandId,kind,refresh=0,renderRows,emptyTitle}) {
  const auth=useAuth();
  const signature=JSON.stringify([organizationId,brandId,kind,refresh,auth.user?.id]);
  const [state,actions]=useAdminPagedQuery({storageKey:`marketing.${kind}.${organizationId}.${brandId||'all'}`,querySignature:signature,loadPage:({page,pageSize})=>marketingService.listing({organizationId,brandId,kind,page,pageSize}),shouldClearOnError:()=>true});
  const current=state.loadedQuerySignature===signature;
  return <div><AsyncDataSurface loading={state.loading||!current&&!state.error} error={state.error} onRetry={actions.retry} isEmpty={current&&!state.rows.length} emptyTitle={emptyTitle} hasData={current&&Boolean(state.rows.length)}>{current?renderRows(state.rows):null}</AsyncDataSurface><AdminPagination {...state} loading={state.loading} onPageChange={actions.requestPage} onPageSizeChange={actions.requestPageSize}/></div>;
}
function JobList({jobs,timezone}) { return <div>{jobs.map(j=><div className="marketing-row" key={j.id}><span><strong>{j.title} · {titleCase(j.channel)}</strong><small>{j.brand_name} · Revision {j.revision} · <Stamp value={j.due_at} timezone={timezone}/> · {j.attempts} attempts</small><small>{j.error_code==='provider_not_authorized'?'Meta publishing is not authorized. No post was sent.':j.error_code ? titleCase(j.error_code) : j.provider_post_id ? `Platform post: ${j.provider_post_id}` : 'Awaiting delivery evidence.'}</small></span><Status value={j.state}/></div>)}</div>; }
function ContentRows({rows,busy,can,open,command,timezone}) {
  if(!rows.length)return <section className="card p-6"><h2 className="font-semibold">No content yet</h2><p className="mt-2 text-sm text-text-secondary">Select a brand and create a draft. Each channel keeps its own caption and media format.</p></section>;
  return <section className="card overflow-hidden"><div className="marketing-content-head"><span>Creative concept</span><span>Lifecycle & actions</span></div>{rows.map(c=><div className="marketing-row" key={c.id}><span><strong>{c.payload.title}</strong><small>{c.brand_name} · Revision {c.revision} · {c.payload.variants.map(v=>titleCase(v.channel)).join(' / ')}</small><small><Stamp value={c.scheduled_at} timezone={c.schedule_timezone||timezone}/></small></span><div className="flex flex-wrap items-center gap-2"><Status value={c.status}/><button className="btn-secondary" disabled={busy} onClick={()=>open({type:'review',content:c})}>Details</button>{c.status!=='published'&&can('marketing_content.edit')?<button className="btn-secondary" disabled={busy} onClick={()=>open({type:'content',content:c,payload:structuredClone(c.payload)})}>Edit</button>:null}{['draft','rejected'].includes(c.status)&&can('marketing_content.review')?<button className="btn-secondary" disabled={busy} onClick={()=>command('review',c)}>Submit review</button>:null}{c.status==='approved'&&can('marketing_content.publish')?<button className="btn-secondary" disabled={busy} onClick={()=>open({type:'schedule',content:c,local:'',timezone:timezone})}><CalendarDays size={14}/> Schedule</button>:null}{!['published','cancelled'].includes(c.status)&&can('marketing_content.cancel')?<button className="btn-secondary" disabled={busy} onClick={()=>command('cancel',c)}>Cancel</button>:null}</div></div>)}</section>;
}
function Checks({values,onChange,options,label}) { return <fieldset className="space-y-2"><legend className="text-sm font-semibold">{label}</legend>{options.map(o=><label className="flex items-center gap-2 text-sm" key={o.id}><input type="checkbox" checked={values.includes(o.id)} onChange={e=>onChange(e.target.checked?[...values,o.id]:values.filter(id=>id!==o.id))}/>{o.name}</label>)}</fieldset>; }
function Settings({data,setup,brands,brand,can,busy,open,actorId,removeMember}) {
  const knowledge=data.knowledge.find(k=>k.brand_id===brand?.id);
  return <div className="space-y-5">
    <section className="card p-5 space-y-3"><h2 className="font-semibold">Brand Knowledge Profile</h2><p className="text-sm text-text-secondary">Brand facts, referenced research and AI suggestions retain distinct provenance. A human-authored verified fact is an explicit brand assertion.</p>{brand?<><p>{brand.name} · Knowledge revision {knowledge?.revision||0} · {brand.timezone}</p>{knowledge?fields.filter(f=>knowledge.profile[f]?.text).map(f=><div className="marketing-knowledge" key={f}><h3>{titleCase(f)}</h3><p>{knowledge.profile[f].text}</p><small>{titleCase(knowledge.profile[f].provenance)}{knowledge.profile[f].source_url?<a href={knowledge.profile[f].source_url} target="_blank" rel="noreferrer"> · Source</a>:null}</small></div>):<p className="text-sm">No brand knowledge has been saved.</p>}{can('marketing_settings.manage')?<button className="btn-secondary" disabled={busy} onClick={()=>open({type:'knowledge',revision:knowledge?.revision||0,profile:structuredClone(knowledge?.profile||{})})}>Edit knowledge</button>:null}</>:<p className="text-sm">Select a brand to manage its knowledge.</p>}</section>
    {can('platform_organizations.manage')?<section className="card p-5 space-y-3"><h2 className="font-semibold">Organization & brand ownership</h2><p className="text-sm text-text-secondary">Shared Platform records keep brands separate from outlets and legal employers.</p><div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={busy||!setup} onClick={()=>open({type:'brand',name:'',timezone:'Asia/Kuala_Lumpur',outlets:[]})}>Add brand</button>{brand?<button className="btn-secondary" disabled={busy||!setup} onClick={()=>open({type:'brand',brand,name:brand.name,timezone:brand.timezone,outlets:brand.outlet_ids})}>Edit brand targeting</button>:null}{can('employees.view')?<button className="btn-secondary" disabled={busy||!setup} onClick={()=>open({type:'member',employeeId:''})}>Add team member</button>:null}</div>{setup?.members.map(m=><div className="marketing-row" key={m.id}><span>{m.name}</span>{m.id!==actorId?<button className="btn-secondary" disabled={busy} onClick={()=>removeMember(m.id)}>Remove membership</button>:<span className="text-sm text-text-secondary">Your membership</span>}</div>)}</section>:null}
    {can('roles.edit')&&can('marketing_settings.configure')?<section className="card p-5 space-y-3"><h2 className="font-semibold">Brand-scoped role access</h2><p className="text-sm text-text-secondary">Roles grant actions through FeedX Roles & Permissions. Organization membership and explicit brand scope grant data access. Owner/Admin can access all brands only in their own organizations.</p><button className="btn-secondary" disabled={busy||!setup} onClick={()=>open({type:'scope',roleId:'',all:false,brands:[]})}>Configure role scope</button>{data.role_scopes.map(s=><div className="marketing-row" key={s.role_id}><span>{setup?.roles.find(r=>r.id===s.role_id)?.name||'Role'} · {s.all_brands?'All brands':`${s.brand_ids.length} selected brands`}</span><button className="btn-secondary" disabled={busy} onClick={()=>open({type:'scope',roleId:s.role_id,all:s.all_brands,brands:s.brand_ids})}>Edit scope</button></div>)}</section>:null}
  </div>;
}
function ModalBody({modal,setModal,brands,brand,setup,assets,can,detail,onExecutionComplete}) {
  const change=patch=>setModal(current=>({...current,...patch}));
  const field=(label,key,type='text')=><AdminFormField label={label}><input className="input" type={type} value={modal[key]||''} onChange={e=>change({[key]:e.target.value})}/></AdminFormField>;
  if(modal.type==='organization')return field('Organization name','name');
  if(modal.type==='brand')return <div className="space-y-4">{field('Brand name','name')}{field('Timezone','timezone')}<Checks label="Target outlets" values={modal.outlets} onChange={outlets=>change({outlets})} options={setup?.outlets||[]}/><p className="text-sm text-text-secondary">No selected outlets means brand-wide content without outlet targeting. Outlet ownership remains canonical.</p></div>;
  if(modal.type==='member')return <SelectField label="FeedX employee" value={modal.employeeId} onChange={employeeId=>change({employeeId})} options={[{value:'',label:'Select employee'},...(setup?.employees||[]).map(e=>({value:e.id,label:e.name}))]}/>;
  if(modal.type==='scope')return <div className="space-y-4"><SelectField label="Role" value={modal.roleId} onChange={roleId=>change({roleId})} options={[{value:'',label:'Select role'},...(setup?.roles||[]).map(r=>({value:r.id,label:r.name}))]}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={modal.all} onChange={e=>change({all:e.target.checked})}/>All brands in this organization</label>{!modal.all?<Checks label="Authorized brands" values={modal.brands} onChange={values=>change({brands:values})} options={brands}/>:null}</div>;
  if(modal.type==='schedule')return <div className="space-y-4"><p className="text-sm">Scheduling pins revision {modal.content.revision}. Execution requires a separate approval of this exact revision to enabled Meta accounts.</p>{field('Publishing time','local','datetime-local')}{field('Timezone','timezone')}</div>;
  if(modal.type==='knowledge')return <div className="space-y-5">{fields.map(f=>{const entry=modal.profile[f]||{text:'',provenance:'verified_brand_fact'};const update=patch=>change({profile:{...modal.profile,[f]:{...entry,...patch}}});return <div className="space-y-2" key={f}><AdminFormField label={titleCase(f)}><textarea className="input min-h-20" value={entry.text} onChange={e=>update({text:e.target.value})} maxLength={8000}/></AdminFormField><SelectField label={`${titleCase(f)} provenance`} value={entry.provenance} onChange={provenance=>update({provenance})} options={[{value:'verified_brand_fact',label:'Verified brand fact (human assertion)'},{value:'external_research',label:'External research'},{value:'ai_suggestion',label:'AI suggestion (unverified)'}]}/>{entry.provenance==='external_research'?<AdminFormField label="Source URL"><input className="input" type="url" value={entry.source_url||''} onChange={e=>update({source_url:e.target.value,observed_at:new Date().toISOString()})}/></AdminFormField>:null}</div>;})}</div>;
  if(modal.type==='review')return <div className="space-y-4"><h3 className="font-semibold">{modal.content.payload.title}</h3><p className="text-sm">Revision {modal.content.revision} · <Status value={modal.content.status}/></p>{modal.content.payload.variants.map(v=><section className="marketing-knowledge" key={v.channel}><h3>{titleCase(v.channel)} · {titleCase(v.format)}</h3><p className="whitespace-pre-wrap">{v.caption}</p><small>{v.asset_ids.length} pinned media assets · {modal.content.payload.outlet_ids.length} outlet targets</small>{v.asset_ids.map(id=>{const a=assets.find(a=>a.id===id);return a?<AssetPreview key={id} asset={a}/>:<p key={id}>Media details unavailable.</p>;})}</section>)}<PublishAuthorization key={`${modal.content.id}:${modal.content.revision}`} content={modal.content} onComplete={onExecutionComplete}/>{modal.content.status==='review'&&can('marketing_content.approve')?<AdminFormField label="Rejection reason (required to reject)"><textarea className="input" value={modal.reason||''} onChange={e=>change({reason:e.target.value})}/></AdminFormField>:null}{detail?<section className="space-y-2"><h3 className="text-sm font-semibold">Recent audit history</h3>{detail.events.map((e,i)=><p className="text-xs text-text-secondary" key={i}>{titleCase(e.action)} · Revision {e.details.revision||'—'} · {new Intl.DateTimeFormat('en-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(e.created_at))}{e.details.reason?` · ${e.details.reason}`:''}</p>)}</section>:null}</div>;
  if(modal.type==='content') {
    const payload=modal.payload;
    const update=patch=>change({payload:{...payload,...patch}});
    const variant=(index,patch)=>update({variants:payload.variants.map((v,i)=>i===index?{...v,...patch}:v)});
    const currentBrand=brands.find(b=>b.id===(modal.content?.brand_id||brand?.id));
    return <div className="space-y-5"><AdminFormField label="Creative concept title" required><input className="input" value={payload.title} maxLength={200} onChange={e=>update({title:e.target.value})}/></AdminFormField><Checks label="Outlet targets" values={payload.outlet_ids} onChange={outlet_ids=>update({outlet_ids})} options={(currentBrand?.outlet_ids||[]).map(id=>({id,name:currentBrand?.outlets?.find(o=>o.id===id)?.name||'Brand outlet'}))}/><fieldset className="space-y-2"><legend className="text-sm font-semibold">Channels</legend>{['facebook','instagram'].map(channel=><label className="mr-4 inline-flex items-center gap-2 text-sm" key={channel}><input type="checkbox" checked={payload.variants.some(v=>v.channel===channel)} onChange={e=>update({variants:e.target.checked?[...payload.variants,{channel,format:channel==='instagram'?'image':'text',caption:'',asset_ids:[]}]:payload.variants.filter(v=>v.channel!==channel)})}/>{titleCase(channel)}</label>)}</fieldset>{payload.variants.map((v,index)=><section className="marketing-variant" key={v.channel}><h3>{titleCase(v.channel)} variant</h3><SelectField label={`${titleCase(v.channel)} format`} value={v.format} onChange={format=>variant(index,{format,asset_ids:[]})} options={['text','image','carousel','reel'].filter(format=>v.channel!=='instagram'||format!=='text').map(format=>({value:format,label:titleCase(format)}))}/><AdminFormField label={`${titleCase(v.channel)} caption`} helper={v.channel==='instagram'?'Up to 2,200 characters.':'Up to 63,206 characters.'}><textarea className="input min-h-28" value={v.caption} maxLength={v.channel==='instagram'?2200:63206} onChange={e=>variant(index,{caption:e.target.value})}/></AdminFormField>{v.format!=='text'?<MarketingAssetPicker brand={currentBrand} format={v.format} values={v.asset_ids} onChange={asset_ids=>variant(index,{asset_ids})}/>:null}<p className="text-xs text-text-secondary">{v.format==='carousel'?'Choose 2–10 images.':v.format==='reel'?'Choose one MP4 video. Platform duration and aspect ratio checks are required before external publishing.':v.format==='image'?'Choose one image. Platform media validation is required before external publishing.':'Facebook text post.'}</p></section>)}</div>;
  }
  return null;
}

function AssetPreview({asset}) {
  const [url,setUrl]=useState(''); const [error,setError]=useState('');
  useEffect(()=>{let live=true;marketingService.assetUrl(asset).then(value=>{if(live)setUrl(value);}).catch(()=>{if(live)setError('Private media preview could not be loaded.');});return()=>{live=false;};},[asset.id]);
  return <figure className="space-y-2">{error?<p role="alert" className="text-sm">{error}</p>:!url?<p className="text-sm">Loading media…</p>:asset.mime_type==='video/mp4'?<video src={url} controls onError={()=>setError('Private video could not be decoded. Upload a valid MP4 before approval.')} className="max-h-64 max-w-full"/>:<img src={url} alt={asset.filename} onError={()=>setError('Private image could not be decoded. Upload a valid image before approval.')} className="max-h-64 max-w-full object-contain"/>}<figcaption className="text-xs">{asset.filename}</figcaption></figure>;
}

function MarketingAssetPicker({brand,format,values,onChange}) {
  return <div className="space-y-2"><p className="text-xs text-text-secondary">{values.length} selected media assets. Browse your brand library; compatible files are selectable on each page.</p><MarketingListPanel organizationId={brand.organization_id} brandId={brand.id} kind="assets" emptyTitle="Upload brand media before review" renderRows={rows=><Checks label="Pinned brand media" values={values} onChange={onChange} options={rows.filter(a=>format==='reel'?a.mime_type==='video/mp4':a.mime_type.startsWith('image/')).map(a=>({id:a.id,name:a.filename}))}/>}/></div>;
}
