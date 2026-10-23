import {useEffect,useRef,useState} from 'react';
import {BookOpen,Plus} from 'lucide-react';
import Modal from '../../components/feedback/Modal.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {marketingService} from './marketingService.js';
export function insertCaptionText(caption,text,limit){const result=[caption.trimEnd(),text.trim()].filter(Boolean).join('\n\n');if(result.length>limit)throw new Error(`This would exceed the channel’s ${limit.toLocaleString('en-MY')}-character caption limit. Shorten the caption first.`);return result;}
const noPermission=()=>false;
export default function CaptionLibrary({brand,caption,onInsert,limit=2200,can=noPermission,disabled=false}){
 const [open,setOpen]=useState(false),[kind,setKind]=useState('caption'),[search,setSearch]=useState(''),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[data,setData]=useState(null),[error,setError]=useState(''),[edit,setEdit]=useState(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const request=useRef(null),saving=useRef(false),scope=useRef('');scope.current=brand.id;
 useEffect(()=>{setOpen(false);setData(null);setEdit(null);setError('');},[brand.id]);
 useEffect(()=>{let live=true;if(!open)return;setData(null);setError('');marketingService.captionLibrary(brand.id,kind,search,page).then(value=>{if(live)setData(value)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[open,brand.id,kind,search,page,refresh]);
 async function save(){
  if(saving.current)return;const expected=brand.id;saving.current=true;setBusy(true);setError('');
  const values={name:edit.name,body:edit.body,kind,active:edit.active},fp=JSON.stringify([brand.id,edit.id,edit.revision,values]);if(request.current?.fp!==fp)request.current={fp,id:crypto.randomUUID()};
  try{await marketingService.saveCaption(request.current.id,brand.id,edit,values);if(scope.current!==expected)return;setEdit(null);setNotice('Saved to this Brand’s caption library.');setRefresh(v=>v+1)}catch(e){if(scope.current===expected)setError(e.message)}finally{saving.current=false;if(scope.current===expected)setBusy(false)}
 }
 return <><button type="button" className="btn-secondary" disabled={disabled} onClick={()=>{setOpen(true);setNotice('')}}><BookOpen size={14}/>Templates & hashtags</button>
 {open?<Modal title={edit?edit.id?'Edit saved text':'New saved text':'Caption Library'} description={brand.name} size="lg" onClose={()=>{if(!busy)setOpen(false)}} footer={<><span className="mr-auto text-xs text-text-secondary">Saved text never publishes automatically.</span><button type="button" className="btn-secondary" disabled={busy} onClick={()=>edit?setEdit(null):setOpen(false)}>{edit?'Back':'Close'}</button>{edit?<button type="button" className="btn-primary" disabled={busy||!edit.name.trim()||!edit.body.trim()} onClick={save}>{busy?'Saving…':'Save text'}</button>:null}</>}>
 {error?<p role="alert" className="marketing-error">{error}</p>:null}{notice?<p role="status" className="marketing-notice">{notice}</p>:null}
 {edit?<div className="space-y-4"><AdminFormField label="Name" required><input className="control" value={edit.name} maxLength={100} disabled={busy} onChange={e=>setEdit({...edit,name:e.target.value})}/></AdminFormField><AdminFormField label={kind==='hashtags'?'Hashtags':'Caption template'} required helper={kind==='hashtags'?'Up to 30 hashtags, separated by spaces.':'Reusable text · check current facts before inserting.'}><textarea className="control" rows={7} value={edit.body} maxLength={2200} disabled={busy} onChange={e=>setEdit({...edit,body:e.target.value})}/></AdminFormField><label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={edit.active} disabled={busy} onChange={e=>setEdit({...edit,active:e.target.checked})}/>Available for insertion</label></div>:<div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><AdminSegmentedControl label="Saved text type" value={kind} onChange={v=>{setKind(v);setSearch('');setPage(1)}} options={[{value:'caption',label:'Captions'},{value:'hashtags',label:'Hashtags'}]}/>{can('marketing_content.create')?<button type="button" className="btn-primary" onClick={()=>{setError('');setEdit({name:'',body:'',active:true})}}><Plus size={14}/>New {kind==='caption'?'template':'hashtag set'}</button>:null}</div><AdminSearchField label="Search saved text" value={search} onChange={v=>{setSearch(v);setPage(1)}}/>
 <AsyncDataSurface loading={!data&&!error} error={null} isEmpty={data?.rows.length===0} emptyTitle={kind==='caption'?'No caption templates yet':'No hashtag sets yet'} emptyDescription="Save reusable Brand text here, then insert and edit it in a channel caption." hasData={Boolean(data?.rows.length)}>
 {data?.rows.length?<DataTable density="compact" minWidth={420} getRowKey={r=>r.id} rows={data.rows} columns={[{key:'name',header:'Saved text',render:r=><div><strong>{r.name}</strong><p className="cm-caption">{r.body}</p></div>},{key:'status',header:'Status',render:r=><Badge tone={r.active?'success':'neutral'}>{r.active?'Active':'Inactive'}</Badge>},{key:'actions',header:'Actions',render:r=><div className="cm-actions"><button type="button" className="btn-secondary" disabled={!r.active} onClick={()=>{try{onInsert(insertCaptionText(caption,r.body,limit));setOpen(false)}catch(e){setError(e.message)}}}>Insert</button>{can('marketing_content.edit')?<button type="button" className="btn-secondary" onClick={()=>{setError('');setEdit({...r})}}>Edit</button>:null}</div>} ]}/>:null}
 </AsyncDataSurface>{data?<AdminPagination page={page} pageSize={20} total={data.total_count} onPageChange={setPage} onPageSizeChange={()=>{}}/>:null}</div>}
 </Modal>:null}</>;
}
