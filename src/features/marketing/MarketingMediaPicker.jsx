import {useEffect,useRef,useState} from 'react';
import {Upload,Plus,X} from 'lucide-react';
import Modal from '../../components/feedback/Modal.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import MarketingMediaPreview from './MarketingMediaPreview.jsx';
import DriveMediaBrowser from './DriveMediaBrowser.jsx';
import {driveService} from './driveService.js';
import {marketingService} from './marketingService.js';
const EMPTY_ASSETS=[];
const fileKey=file=>file.selection_id||file.id;
const eligible=(asset,format,channel)=>asset.state==='ready'&&(format==='reel'?asset.mime_type==='video/mp4':asset.mime_type?.startsWith('image/'))&&(asset.size_bytes<=(format==='reel'?52428800:8388608))&&(channel!=='instagram'||format==='reel'||asset.mime_type==='image/jpeg');
export default function MarketingMediaPicker({brand,format,channel,values=[],assets=EMPTY_ASSETS,onChange,disabled=false,thumbnailPreviews=false,initialOpen=false}){
 const scope=JSON.stringify([brand.organization_id,brand.id,format,channel]);const activeScope=useRef(scope);activeScope.current=scope;
 const saving=useRef(false),prepared=useRef(new Map());
 const [pending,setPending]=useState(()=>values.map(id=>({id})));
 const [open,setOpen]=useState(initialOpen),[tab,setTab]=useState('drive'),[known,setKnown]=useState(assets),[rows,setRows]=useState([]),[page,setPage]=useState(1),[total,setTotal]=useState(0),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{activeScope.current=scope;return()=>{activeScope.current=null};},[scope]);
 useEffect(()=>{setKnown(assets);setRows([]);setPage(1);setTotal(0);setError('');setBusy(false);setOpen(initialOpen);setPending(values.map(id=>({id})));prepared.current.clear();saving.current=false;},[brand.organization_id,brand.id,format,channel]);
 useEffect(()=>{setKnown(current=>[...new Map([...current,...assets].map(a=>[a.id,a])).values()]);},[assets]);
 useEffect(()=>{let live=true;if(!open||tab!=='existing')return;setLoading(true);marketingService.listing({organizationId:brand.organization_id,brandId:brand.id,kind:'assets',page,pageSize:20}).then(data=>{if(live){setRows(data.rows);setTotal(data.total_count);setKnown(current=>[...new Map([...current,...data.rows].map(a=>[a.id,a])).values()]);}}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false};},[open,tab,page,brand.id]);
 function assetFor(entry){return entry.id?known.find(a=>a.id===entry.id):null;}
 function driveIdentity(entry){
  const source=assetFor(entry)?.source_metadata,key=entry.file?fileKey(entry.file):source?.selection_id,version=entry.file?.version??source?.version;
  return key&&version!=null?JSON.stringify([key,String(version)]):null;
 }
 function matchesDrive(entry,file){const identity=driveIdentity(entry);return Boolean(identity&&identity===driveIdentity({file}));}
 function matchesAsset(entry,asset){return entry.id===asset.id||Boolean(asset.source_kind==='drive'&&asset.source_metadata?.selection_id&&matchesDrive(entry,{selection_id:asset.source_metadata.selection_id,version:asset.source_metadata.version}));}
 function toggle(entry,match){
  if(disabled||saving.current)return;
  setError('');
  if(pending.some(match)){setPending(pending.filter(value=>!match(value)));return;}
  if(format!=='carousel'){setPending([entry]);return;}
  if(pending.length>=10){setError('A carousel supports up to 10 images. Remove an image first.');return;}
  setPending([...pending,entry]);
 }
 function select(asset){
  if(!eligible(asset,format,channel)){setError('Choose compatible media: images up to 8 MB; Instagram images require JPEG. Videos require MP4.');return;}
  setKnown(current=>[...new Map([...current,asset].map(a=>[a.id,a])).values()]);
  toggle({id:asset.id},entry=>matchesAsset(entry,asset));
 }
 async function upload(file){
  if(disabled||saving.current)return;
  const expectedScope=scope;saving.current=true;setBusy(true);setError('');
  try{const asset=await driveService.upload(brand.organization_id,brand.id,file,channel);if(activeScope.current!==expectedScope)return;
   saving.current=false;select(asset);
  }catch(e){if(activeScope.current===expectedScope)setError(e.message)}finally{if(activeScope.current===expectedScope){saving.current=false;setBusy(false)}}
 }
 async function confirm(selection=pending,close=true){
  if(disabled||saving.current)return;
  const expectedScope=scope;saving.current=true;setBusy(true);setError('');
  try{
   const ids=[];
   for(const entry of selection){
    let id=entry.id;
    if(entry.file){
     const key=JSON.stringify([fileKey(entry.file),entry.file.version]);
     let asset=prepared.current.get(key);
     if(!asset){asset=await driveService.import(brand.organization_id,brand.id,entry.file,channel);if(activeScope.current!==expectedScope)return;
      if(!eligible(asset,format,channel))throw new Error('This file is not compatible. Choose another image or MP4 video.');
      prepared.current.set(key,asset);setKnown(current=>[...new Map([...current,asset].map(a=>[a.id,a])).values()]);
     }
     id=asset.id;
    }
    if(!ids.includes(id))ids.push(id);
   }
   const result=await onChange(ids);
   if(activeScope.current!==expectedScope)return;
   if(result===false)throw new Error('Media could not be saved. Your selection is kept. Review the task error and try again.');
   if(close)setOpen(false);
  }catch(e){if(activeScope.current===expectedScope)setError(e.message||'Media could not be saved. Try again.');}
  finally{if(activeScope.current===expectedScope){saving.current=false;setBusy(false)}}
 }
 return <div className="space-y-3"><div className="media-selection">{values.map(id=>{const asset=known.find(a=>a.id===id);return <div className="media-selection-item" key={id}>{asset?<MarketingMediaPreview compact={thumbnailPreviews} cover={thumbnailPreviews} asset={asset} assets={values.map(id=>known.find(a=>a.id===id)).filter(Boolean)}/>:<p className="text-sm">Saved media · preview unavailable</p>}<button type="button" className="icon-btn" aria-label={`Remove ${asset?.filename||'media'}`} disabled={disabled||busy} onClick={()=>confirm(values.filter(value=>value!==id).map(id=>({id})),false)}><X size={15}/></button></div>})}</div><button type="button" className="btn-secondary" disabled={disabled||busy} onClick={()=>{setPending(values.map(id=>({id})));setOpen(true);setError('')}}><Plus size={15}/>{values.length&&format!=='carousel'?'Replace media':'Add media'}</button>
 {!open&&error?<p role="alert" className="text-sm text-danger">{error}</p>:null}
 {open?<Modal title="Select media" size="xl" onClose={()=>{if(!busy)setOpen(false)}} footer={<><span className="mr-auto text-sm text-text-secondary">{busy?'Saving media…':`${pending.length} selected`}</span><button className="btn-primary" type="button" disabled={busy||disabled} onClick={()=>confirm()}>{busy?'Saving…':'Done'}</button></>}>
 <AdminSegmentedControl label="Media source" value={tab} onChange={value=>{if(!busy){setTab(value);setError('')}}} options={[{value:'drive',label:'Google Drive'},{value:'upload',label:'Upload from device'},{value:'existing',label:'Existing FeedX media'}]}/>
 {error?<p role="alert" className="text-sm text-danger mt-3">{error}</p>:null}
 <div inert={busy||disabled} className={`mt-4 ${busy||disabled?'pointer-events-none opacity-60':''}`}>
 {tab==='drive'?<DriveMediaBrowser organizationId={brand.organization_id} brandId={brand.id} selectOnClick isSelected={file=>pending.some(entry=>matchesDrive(entry,file))} onSelect={file=>{
  if(format==='reel'?file.mimeType!=='video/mp4':!file.mimeType.startsWith('image/')){setError('Choose an image for this task, or MP4 for a Reel.');return;}
  toggle({file},entry=>matchesDrive(entry,file));
 }}/>:null}
 {tab==='upload'?<div className="media-upload-zone"><Upload size={28}/><strong>Choose an image or video</strong><span>JPG, PNG, WebP or MP4 · up to 100 MB</span><label className="btn-primary">Choose file<input className="sr-only" aria-label="Upload post media" type="file" accept={format==='reel'?'video/mp4':channel==='instagram'?'image/jpeg':'image/jpeg,image/png,image/webp'} disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)upload(file)}}/></label></div>:null}
 {tab==='existing'?<><AsyncDataSurface loading={loading} error={null} isEmpty={!loading&&!rows.length} emptyTitle="No eligible saved media"><div className="drive-grid">{rows.filter(asset=>eligible(asset,format,channel)).map(asset=>{const selected=pending.some(entry=>matchesAsset(entry,asset));return <article className={`drive-tile p-3 ${selected?'is-selected':''}`} key={asset.id}><MarketingMediaPreview asset={asset}/><button className="btn-secondary" type="button" onClick={()=>select(asset)} aria-pressed={selected} aria-label={`${selected?'Remove':'Select'} ${asset.filename}`}>{selected?'Selected':'Select media'}</button></article>})}</div></AsyncDataSurface><AdminPagination page={page} pageSize={20} total={total} onPageChange={setPage} onPageSizeChange={()=>{}}/></>:null}
 </div></Modal>:null}</div>;
}
