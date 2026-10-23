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
import PostEditor from './PostEditor.jsx';
import DateTimePickerField from '../../components/forms/DateTimePickerField.jsx';
import MediaLibrary from './MediaLibrary.jsx';
import { MarketingOverview, MarketingSocialAnalytics } from './MarketingDashboards.jsx';
import MarketingSettingsPage from './MarketingSettingsPage.jsx';
import ContentManagement from './ContentManagement.jsx';
import PostDetail from './PostDetail.jsx';
import { PublishAuthorization } from './MetaIntegrationPanels.jsx';

const labels = { overview: 'Overview', content: 'Content Management', media: 'Media Library', calendar: 'Content Management', analytics: 'Social Analytics' };
const descriptions = {
  overview: 'See what needs attention and keep your brands moving.',
  content: '',
  media: '',
  calendar: '',
  analytics: 'Understand your organic content performance.',
};
const emptyContext = { organizations: [], brands: [] };
const titleCase = value => value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const newPayload = () => ({ title: '', outlet_ids: [], variants: [{ channel: 'facebook', format: 'text', caption: '', asset_ids: [] }] });

export default function MarketingWorkspacePage(props){return props.section==='settings'?<MarketingSettingsPage section="legacy"/>:<MarketingContentWorkspace {...props}/>;}
function MarketingContentWorkspace({ section = 'overview' }) {
  if(section==='content')section='calendar';
  const auth = useAuth();
  const [overviewMonth,setOverviewMonth]=useState(()=>localInput(new Date(),'Asia/Kuala_Lumpur').slice(0,7)+'-01');
  const [context, setContext] = useState(emptyContext);
  const [organizationId, setOrganizationId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [bootstrapError, setBootstrapError] = useState('');
  const [booting, setBooting] = useState(true);
  const [read, setRead] = useState(null);
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
  const detailKey = JSON.stringify([organizationId, brandId, modal?.content?.id, modal?.content?.revision, modal?.content?.status, auth.user?.id]);
  const currentDetail = detail?.key === detailKey ? detail : null;

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
    setLoading(Boolean(organizationId)); setError('');
    if (!organizationId || booting) return () => { live = false; };
    (['calendar','media','overview','analytics'].includes(section) ? Promise.resolve({rows:[],assets:[],jobs:[],total:0}) : marketingService.read({ organizationId, brandId, section, page, pageSize }))
      .then(result => { if (live) setRead({ key, data: result }); })
      .catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
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
    const selected = modal?.content;
    if (selected?.id && can('marketing_content.view')) marketingService.detail(selected.id)
      .then(result => {
        if (!live) return;
        const content = result.content;
        if (!content?.organization_id || content.organization_id !== organizationId || content.brand_id !== brandId || content.brand_id !== selected.brand_id || content.id !== selected.id || content.revision !== selected.revision || content.status !== selected.status) throw new Error('The saved content changed or is unavailable in this Brand. Close and reopen it.');
        setDetail({ ...result, key: detailKey });
      })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [detailKey]);

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
    <SelectField searchable="auto" label="Brand" value={brandId} onChange={value => { if (!busy) selectBrandContext(context,value,organizationId,setOrganizationId,setBrandId); }} options={[...(['calendar','media'].includes(section) ? [] : [{value:'',label:'All'}]),...context.brands.map(b=>({value:b.id,label:b.name}))]} />
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
    </AsyncDataSurface>
    {modal ? <Modal title={{content:modal.content?'Revise content':'Create Post',review:'Content revision',schedule:'Schedule publishing',}[modal.type]} description={modal.type==='content'?'Saving material changes invalidates approval.':null} size={modal.type==='content'?'3xl':modal.type==='review'?'lg':'sm'} panelClassName={modal.type==='content'?'post-editor-modal':''} footerClassName={modal.type==='content'?'post-editor-modal-footer':''} placement={modal.type==='review'?'right':'center'} onClose={()=>{if(!busy)setModal(null);}} footer={<>
      {error ? <p className="mr-auto text-sm text-rose-600" role="alert">{error}</p> : null}
      <button className="btn-secondary" disabled={busy} onClick={()=>setModal(null)}>Close</button>
      {modal.type!=='review' ? <button className="btn-primary" disabled={busy} onClick={()=>{
        if(modal.type==='content'){try{const payload=modal.plannedLocal===undefined?modal.payload:{...modal.payload,planned_at:modal.plannedLocal?scheduleInstant(modal.plannedLocal,'Asia/Kuala_Lumpur'):null,planned_timezone:'Asia/Kuala_Lumpur'};command('save',modal.content,payload);}catch(e){setError(e.message);}}
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
      <ModalBody modal={modal} setModal={setModal} brands={brands} brand={brand} assets={[...new Map([...(data?.assets||[]),...(currentDetail?.assets||[])].map(a=>[a.id,a])).values()]} can={can} onExecutionComplete={()=>{setModal(null);setRefresh(v=>v+1);setNotice('External execution authorized for the reviewed revision.');}} detail={currentDetail} busy={busy}/>
    </Modal> : null}
  </WorkspacePage>;
}

function ModalBody({modal,setModal,brands,brand,assets,can,detail,onExecutionComplete,busy}) {
  const change=patch=>setModal(current=>({...current,...patch}));
  const field=(label,key,type='text')=><AdminFormField label={label}><input className="control" type={type} value={modal[key]||''} onChange={e=>change({[key]:e.target.value})}/></AdminFormField>;
  if(modal.type==='schedule')return <div className="space-y-4"><p className="text-sm">Scheduling pins revision {modal.content.revision}. Execution requires a separate approval of this exact revision to enabled Meta accounts.</p><DateTimePickerField label="Publishing" timezone={modal.timezone} value={modal.local} onChange={local=>change({local})}/>{field('Timezone','timezone')}</div>;
  if(modal.type==='review')return <PostDetail content={modal.content} assets={assets} events={detail?.events||[]}>{detail?.content ? <PublishAuthorization key={`${detail.content.id}:${detail.content.revision}`} content={detail.content} onComplete={onExecutionComplete}/> : <p role="status">Verifying the saved revision before publishing approval.</p>}{modal.content.status==='review'&&can('marketing_content.approve')?<AdminFormField label="Rejection reason (required to reject)"><textarea className="control" value={modal.reason||''} onChange={e=>change({reason:e.target.value})}/></AdminFormField>:null}</PostDetail>;
  if(modal.type==='content') {
    const currentBrand=brands.find(b=>b.id===(modal.content?.brand_id||brand?.id));
    return <PostEditor key={modal.content?.id||'new'} payload={modal.payload} onChange={payload=>change({payload})} brand={currentBrand} assets={assets} plannedLocal={modal.plannedLocal} onPlannedChange={plannedLocal=>change({plannedLocal})} busy={busy}/>;
  }
  return null;
}
