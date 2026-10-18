import {useEffect, useRef, useState} from 'react';
import {Building2, Clock, Utensils, MapPin, Check} from 'lucide-react';
import AdminEditorSections from './AdminEditorSections.jsx';
import Drawer from '../ui/Drawer.jsx';
import ConfirmDialog from '../feedback/ConfirmDialog.jsx';
import AdminFormField from './AdminFormField.jsx';
import SelectField from './SelectField.jsx';
import TextareaField from './TextareaField.jsx';
import OutletServiceFields from './OutletServiceFields.jsx';
import {outletService} from '../../services/outletService.js';
import {outletServiceProfileService, emptyOutletServices} from '../../services/outletServiceProfileService.js';
import {MALAYSIA_STATES} from '../../constants/malaysiaStates.js';
import {OUTLET_SECTIONS, POLICY_LABELS, readServicePolicies, writeServicePolicies, validateOutletMaster} from './outletEditorModel.js';
import './outletEditor.css';

const icons = {general: Building2, contact: Clock, policies: Utensils, attendance: MapPin};
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const initialMaster = outlet => ({name:'', code:'', location:'', state_code:'', status:'active', attendance_location_enabled:false, attendance_latitude:'', attendance_longitude:'', attendance_radius_meters:100, ...outlet});

/** One editing surface; each existing source keeps its own permission, revision and receipt. */
export default function OutletEditor({outlet, initialSection='general', canEdit=false, canCreate=false, onClose, onSaved}) {
  const [section,setSection] = useState(OUTLET_SECTIONS.some(([key])=>key===initialSection)?initialSection:'general');
  const [base,setBase] = useState(()=>initialMaster(outlet)), [value,setValue] = useState(()=>initialMaster(outlet));
  const [source,setSource] = useState(null), [services,setServices] = useState(null), [sourceError,setSourceError] = useState(''), [reload,setReload] = useState(0);
  const [busy,setBusy] = useState(false), [error,setError] = useState(null), [notice,setNotice] = useState(''), [discard,setDiscard] = useState(false);
  const request = useRef(crypto.randomUUID()), saving = useRef(false), panel = useRef(null);
  const masterAllowed = base.id ? canEdit : canCreate;
  const masterDirty = !same(value,base), serviceDirty = services && !same(services, source?.profile?.data || emptyOutletServices());
  const dirty = masterDirty || serviceDirty;
  useEffect(()=>{
    if (!base.id) return;
    let live=true; setSource(null); setServices(null); setSourceError('');
    outletServiceProfileService.read(base.id).then(result=>{if(live){setSource(result);setServices(result.profile?.data || emptyOutletServices())}}).catch(e=>{if(live)setSourceError(e.message)});
    return ()=>{live=false};
  },[base.id,reload]);
  useEffect(()=>{if(!dirty)return;const warn=e=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty]);
  useEffect(()=>{panel.current?.scrollTo?.({top:0})},[section]);
  const change = (key,next) => {setValue(v=>({...v,[key]:next}));setError(null);setNotice('')};
  const changeService = (key,next) => {request.current=crypto.randomUUID();setServices(v=>({...v,[key]:next}));setError(null);setNotice('')};
  const close = () => {if(saving.current)return;if(dirty)setDiscard(true);else onClose()};
  const fail = (target,message) => {setSection(target);setError({section:target,message})};
  async function save() {
    if(saving.current)return;
    const invalid=masterAllowed && (masterDirty || !base.id) ? validateOutletMaster(value) : null;
    if(invalid){fail(invalid.section,invalid.message);return}
    saving.current=true;setBusy(true);setError(null);setNotice('');let target=section;
    try {
      let saved=base;
      if(masterAllowed && (masterDirty || !base.id)) {
        target=section==='attendance'?'attendance':'general';
        saved=await outletService.saveOutlet(value);setBase(saved);setValue(saved);onSaved?.(saved);
      }
      if(serviceDirty && source?.can_edit) {
        target=services.service_policies!==source?.profile?.data?.service_policies && section==='policies'?'policies':'contact';
        const receipt=await outletServiceProfileService.save(request.current,saved.id,source.profile?.revision||0,services);
        setSource(current=>({...current,profile:receipt}));setServices(receipt.data || services);
      }
      setNotice('Changes saved.');
    } catch(e) {fail(target,`${e.message} Any sections already saved remain saved.`)}
    finally {saving.current=false;setBusy(false)}
  }
  const textField = (key,label,props={}) => <AdminFormField label={label} required={key==='name'}><input className="control" value={value[key]??''} onChange={e=>change(key,e.target.value)} {...props}/></AdminFormField>;
  const policies=readServicePolicies(services?.service_policies);
  const updatePolicy=(label,key,next)=>changeService('service_policies',writeServicePolicies({...policies,policies:{...policies.policies,[label]:{...policies.policies[label],[key]:next}}}));
  return <><Drawer title={base.id?`Edit ${base.name}`:'Add Outlet'} description="Outlet Master · Restaurant" width="xl" onClose={close} closeOnEscape={!discard&&!busy} closeOnOverlay={!busy} bodyClassName="outlet-editor-body" footer={<div className="outlet-service-footer"><span role="status">{notice || (dirty?'Unsaved changes':source?.profile?`Service information · Revision ${source.profile.revision}`:'No unsaved changes')}</span><div><button type="button" className="btn-secondary" disabled={busy} onClick={close}>Cancel</button>{masterAllowed||source?.can_edit?<button type="button" className="btn-primary" disabled={busy||(!dirty&&!!base.id)} onClick={save}>{busy?'Saving…':base.id?'Save Changes':'Create Outlet'}</button>:null}</div></div>}>
    <AdminEditorSections label="Outlet sections" sections={OUTLET_SECTIONS.map(([key,label])=>({key,label,icon:icons[key]}))} value={section} onChange={setSection} errorSection={error?.section} disabled={busy}/>
    <div className="outlet-editor-panel" ref={panel}>
      <div className="outlet-editor-heading"><h3>{OUTLET_SECTIONS.find(([key])=>key===section)[1]}</h3><p>{({general:'Identity used across reports, imports and historical records.',contact:'Public contact details and confirmed opening hours.',policies:'Confirmed services staff can use when helping customers.',attendance:'Location rules used by the existing Attendance workflow.'})[section]}</p></div>
      {error?<p className="outlet-service-error" role="alert">{error.message}</p>:null}
      {section==='general'?<fieldset disabled={busy||!masterAllowed} className="outlet-editor-grid">{textField('name','Outlet Name')}{textField('code','Outlet Code')}{textField('location','Location')}<SelectField label="State / Federal Territory" value={value.state_code||''} options={[{value:'',label:'Not confirmed'},...MALAYSIA_STATES.map(([value,label])=>({value,label}))]} onChange={v=>change('state_code',v)}/><SelectField label="Status" value={value.status} options={[{value:'active',label:'Active'},{value:'inactive',label:'Inactive'}]} onChange={v=>change('status',v)}/></fieldset>:null}
      {section==='attendance'?<fieldset disabled={busy||!masterAllowed} className="outlet-editor-grid"><SelectField label="Attendance Location Verification" value={String(value.attendance_location_enabled)} options={[{value:'false',label:'Disabled'},{value:'true',label:'Enabled'}]} onChange={v=>change('attendance_location_enabled',v==='true')}/>{textField('attendance_radius_meters','Allowed Radius (meters)',{inputMode:'numeric'})}{textField('attendance_latitude','Latitude',{inputMode:'decimal',placeholder:'−90 to 90'})}{textField('attendance_longitude','Longitude',{inputMode:'decimal',placeholder:'−180 to 180'})}<p className="outlet-editor-full text-sm text-text-secondary">Verification requires valid coordinates and a radius of 25–2,000 meters.</p></fieldset>:null}
      {['contact','policies'].includes(section)?!base.id?<p className="outlet-service-error">Create the Outlet first, then configure its contact, hours and policies here.</p>:sourceError?<div role="alert" className="outlet-service-error">{sourceError}<button type="button" className="btn-secondary btn-sm" onClick={()=>setReload(n=>n+1)}>Retry Service Information</button></div>:!source?<p role="status">Loading service information…</p>:<fieldset className="outlet-editor-form" disabled={busy||!source.can_edit}>{!source.can_edit?<p className="text-sm text-text-secondary">Read-only. Editing requires Outlet edit permission and access to this Outlet.</p>:null}{section==='contact'?<OutletServiceFields value={services} change={changeService}/>:<><div className="outlet-policy-list">{POLICY_LABELS.map(label=><div className="outlet-policy-row" key={label}><SelectField label={label} value={policies.policies[label]?.status||''} options={[{value:'',label:'Not confirmed'},{value:'Available',label:'Available'},{value:'Not offered',label:'Not offered'}]} onChange={v=>updatePolicy(label,'status',v)}/><AdminFormField label={`${label} details (optional)`}><input className="control" disabled={!policies.policies[label]?.status} value={policies.policies[label]?.description||''} onChange={e=>updatePolicy(label,'description',e.target.value)} maxLength={500}/></AdminFormField></div>)}</div><TextareaField label="Additional / existing policies" rows={4} value={policies.additional} onChange={v=>changeService('service_policies',writeServicePolicies({...policies,additional:v}))} maxLength={4000} helper="Existing policy text is preserved. Confirmed policies do not authorize bookings or other customer actions."/></>}</fieldset>:null}
      {!masterAllowed&&['general','attendance'].includes(section)?<p className="text-sm text-text-secondary">Read-only. Updating this section requires Outlet edit permission.</p>:null}
      {notice?<p className="outlet-editor-saved"><Check size={15}/>{notice}</p>:null}
    </div>
  </Drawer><ConfirmDialog request={discard?{title:'Discard Outlet changes?',message:'Unsaved changes will be discarded. Sections already saved remain saved.',confirmLabel:'Discard Changes',cancelLabel:'Continue Editing',danger:true}:null} onCancel={()=>setDiscard(false)} onConfirm={onClose}/></>;
}
