import {useEffect,useId,useRef,useState} from 'react';
import {BookOpen,Hash,Plus,Pencil,X} from 'lucide-react';
import FloatingLayer from '../../components/ui/FloatingLayer.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {marketingService} from './marketingService.js';

export function insertCaptionText(caption,text,limit,position=caption.length,kind='caption') {
 const at=Math.max(0,Math.min(position,caption.length)),before=caption.slice(0,at),after=caption.slice(at),separator=kind==='hashtags'?' ':'\n\n';
 const addition=(before&&!/\s$/.test(before)?separator:'')+text.trim()+(after&&!/^\s/.test(after)?separator:'');
 const value=before+addition+after;
 if(value.length>limit)throw new Error(`This would exceed the channel’s ${limit.toLocaleString('en-MY')}-character caption limit. Shorten the caption first.`);
 return {value,cursor:before.length+addition.length};
}
export const savedTextName=(body,kind)=>Array.from(body.trim().replace(/\s+/g,' ')).slice(0,100).join('')||(kind==='hashtags'?'Hashtags':'Caption');
const noPermission=()=>false;
export default function CaptionLibrary({brand,onInsert,can=noPermission,disabled=false}) {
 const [kind,setKind]=useState(null),[search,setSearch]=useState(''),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[data,setData]=useState(null),[error,setError]=useState(''),[edit,setEdit]=useState(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const id=useId(),templates=useRef(null),hashtags=useRef(null),request=useRef(null),saving=useRef(false),scope=useRef('');scope.current=brand.id;
 const anchor=kind==='hashtags'?hashtags:templates,title=kind==='hashtags'?'Hashtags':'Templates';
 useEffect(()=>{setKind(null);setData(null);setEdit(null);setError('');setBusy(false);setNotice('');setPage(1);setSearch('');},[brand.id]);
 useEffect(()=>{let live=true;if(!kind)return;setData(null);setError('');marketingService.captionLibrary(brand.id,kind,search,page).then(value=>{if(live)setData(value)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[kind,brand.id,search,page,refresh]);
 function close(restore=true){if(saving.current)return;setKind(null);setEdit(null);if(restore)anchor.current?.focus();}
 function open(value){if(saving.current)return;if(kind===value){close();return}setKind(value);setSearch('');setPage(1);setData(null);setEdit(null);setError('');setNotice('');}
 async function save(){
  if(saving.current)return;const expected=brand.id;saving.current=true;setBusy(true);setError('');
  const values={name:edit.name||savedTextName(edit.body,kind),body:edit.body,kind,active:edit.active},fp=JSON.stringify([brand.id,edit.id,edit.revision,values]);if(request.current?.fp!==fp)request.current={fp,id:crypto.randomUUID()};
  try{await marketingService.saveCaption(request.current.id,brand.id,edit,values);if(scope.current!==expected)return;setEdit(null);setNotice('Saved.');setRefresh(v=>v+1)}catch(e){if(scope.current===expected)setError(e.message)}finally{saving.current=false;if(scope.current===expected)setBusy(false)}
 }
 return <div className="post-caption-toolbar" role="group" aria-label="Caption saved text">
  <button ref={templates} type="button" className="btn-secondary" disabled={disabled||busy} aria-expanded={kind==='caption'} aria-controls={kind==='caption'?id:undefined} onClick={()=>open('caption')}><BookOpen size={14}/>Templates</button>
  <button ref={hashtags} type="button" className="btn-secondary" disabled={disabled||busy} aria-expanded={kind==='hashtags'} aria-controls={kind==='hashtags'?id:undefined} onClick={()=>open('hashtags')}><Hash size={14}/>Hashtags</button>
  <FloatingLayer open={Boolean(kind)} onOpenChange={value=>{if(!value)close()}} anchorRef={anchor} align="start" width={360} maxHeight={480} focusOnOpen closeOnOutsideClick={!busy} closeOnEscape={!busy} className="saved-text-popover">
   <section id={id} aria-label={`Saved ${title.toLowerCase()}`} className="saved-text-content">
    <header className="saved-text-heading"><div><h4>{edit?`${edit.id?'Edit':'New'} ${kind==='hashtags'?'hashtag set':'template'}`:title}</h4><span>{brand.name}</span></div><button type="button" className="icon-btn" aria-label="Close saved text" disabled={busy} onClick={()=>close()}><X size={16}/></button></header>
    {error?<p role="alert" className="marketing-error">{error}</p>:null}{notice?<p role="status" className="marketing-notice">{notice}</p>:null}
    {edit?<><AdminFormField label={kind==='hashtags'?'Hashtag content':'Template text'} required helper={kind==='hashtags'?'Up to 30 hashtags, separated by spaces.':undefined}><textarea className="control" rows={5} value={edit.body} maxLength={2200} disabled={busy} onChange={e=>setEdit({...edit,body:e.target.value})}/></AdminFormField><label className="saved-text-availability"><input type="checkbox" checked={edit.active} disabled={busy} onChange={e=>setEdit({...edit,active:e.target.checked})}/>Available for insertion</label><footer className="saved-text-footer"><button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setEdit(null);setError('')}}>Cancel</button><button type="button" className="btn-primary" disabled={busy||!edit.body.trim()} onClick={save}>{busy?'Saving…':'Save text'}</button></footer></>:<>
    <AdminSearchField label="Search saved text" value={search} onChange={v=>{setSearch(v);setPage(1)}}/>
    <AsyncDataSurface loading={!data&&!error} error={null} isEmpty={data?.rows.length===0} emptyTitle={kind==='caption'?'No templates yet':'No hashtag sets yet'} emptyDescription="Save reusable text for this Brand.">
     {data?.rows.length?<ul className="saved-text-list">{data.rows.map(row=><li key={row.id}><button type="button" className="saved-text-insert" disabled={!row.active||disabled} aria-label={`Insert ${row.body}`} onClick={()=>{try{onInsert(row.body,kind);close(false)}catch(e){setError(e.message)}}}><span>{row.body}</span>{!row.active?<Badge>Inactive</Badge>:null}</button>{can('marketing_content.edit')?<button type="button" className="icon-btn" aria-label={`Edit ${row.body}`} onClick={()=>{setError('');setEdit({...row})}}><Pencil size={14}/></button>:null}</li>)}</ul>:null}
    </AsyncDataSurface>
    {error&&!data?<button type="button" className="btn-secondary" onClick={()=>setRefresh(v=>v+1)}>Retry saved text</button>:null}
    {data&&data.total_count>20?<AdminPagination page={page} pageSize={20} total={data.total_count} onPageChange={setPage} onPageSizeChange={()=>{}}/>:null}
    {can('marketing_content.create')?<footer className="saved-text-footer"><button type="button" className="btn-secondary" onClick={()=>{setError('');setEdit({body:'',active:true})}}><Plus size={14}/>New {kind==='caption'?'template':'hashtag set'}</button></footer>:null}
    </>}
   </section>
  </FloatingLayer>
 </div>;
}
