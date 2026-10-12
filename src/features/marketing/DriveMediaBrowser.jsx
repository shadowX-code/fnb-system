import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Folder,Image as ImageIcon,Film,RefreshCw,ExternalLink,ChevronRight,Check,Star,LayoutGrid,List,Eye} from 'lucide-react';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import MediaLightbox from '../../components/media/MediaLightbox.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import {driveService} from './driveService.js';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import {DRIVE_FOLDER as FOLDER,mediaKey,mediaType,preferredMediaView,saveMediaView,sortedMedia,mediaSizeLabel,mediaDateLabel} from './mediaLibraryPresentation.js';
import './driveMedia.css';
function DrivePreview({organizationId,brandId,file,thumbnail=false}){
 const [url,setUrl]=useState(''),[failed,setFailed]=useState(false);const element=useRef(null);
 useEffect(()=>{let active=true,objectUrl='',started=false;
  async function load(){if(started)return;started=true;try{const blob=await driveService.preview(organizationId,brandId,file);if(!(blob instanceof Blob))throw new Error();objectUrl=URL.createObjectURL(blob);if(active)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl);}catch{if(active)setFailed(true);}}
  if(!thumbnail)load();else {const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){load();observer.disconnect();}});if(element.current)observer.observe(element.current);return()=>{active=false;observer.disconnect();if(objectUrl)URL.revokeObjectURL(objectUrl);};}
  return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[organizationId,brandId,file.id,file.version,thumbnail]);
 return <div ref={element} className={thumbnail?'drive-thumb':'drive-preview'}>{url&&!failed?(file.mimeType.startsWith('video/')?<video src={url} controls={!thumbnail} preload="metadata" onError={()=>setFailed(true)}/>:<img src={url} alt={file.name} onError={()=>setFailed(true)}/>):<span>{failed?'Preview unavailable':thumbnail?<ImageIcon size={24}/>:'Loading preview…'}</span>}</div>;
}
export default function DriveMediaBrowser({organizationId,brandId,onSelect,selected=[],multiple=true,preferenceUserId}){
 const [view,setView]=useState(()=>preferredMediaView(preferenceUserId)),[sort,setSort]=useState('name_asc');
 useEffect(()=>setView(preferredMediaView(preferenceUserId)),[preferenceUserId]);
 const changeView=value=>{setView(value);saveMediaView(preferenceUserId,value)};
 const [context,setContext]=useState(null),[configured,setConfigured]=useState(null),[files,setFiles]=useState([]),[path,setPath]=useState([]),[search,setSearch]=useState(''),[type,setType]=useState(''),[cursor,setCursor]=useState(null),[pageCursor,setPageCursor]=useState(null),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[preview,setPreview]=useState(null),[favorites,setFavorites]=useState(null);
 const displayed=useMemo(()=>sortedMedia(files,sort),[files,sort]);
 const previewItems=displayed.filter(file=>file.mimeType!==FOLDER).map(file=>({id:file.selection_id||file.id,filename:file.name,mime_type:file.mimeType,driveFile:file}));
 const resolvePreview=useCallback(async item=>{const blob=await driveService.preview(organizationId,brandId,item.driveFile);const url=URL.createObjectURL(blob);return {url,release:()=>URL.revokeObjectURL(url)};},[organizationId,brandId]);
 const folderId=path.at(-1)?.id;
 useEffect(()=>{let live=true;setLoading(true);setError('');setContext(null);setFiles([]);setConfigured(null);Promise.all([driveService.context(organizationId,brandId),driveService.configuration()]).then(([c,config])=>{if(live){setContext(c);setConfigured(config.configured);setPath(c.root?[{id:c.root.root_id,name:c.root.root_name}]:[]);setFavorites(c.root?.favorites_id||null);}}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false};},[organizationId,brandId,refresh]);
 useEffect(()=>{let live=true;if(!context?.root||context.status!=='connected'||!configured)return;
  setLoading(true);setError('');driveService.browse(organizationId,brandId,{folderId,search,type,cursor:pageCursor}).then(data=>{if(live){setFiles(data.files);setCursor(data.cursor);const fav=data.files.find(f=>f.name==='00 Favorites'&&f.mimeType===FOLDER);if(fav&&!favorites&&data.folder.id===context.root.root_id)setFavorites(fav.selection_id||fav.id);}}).catch(e=>{if(live){setFiles([]);setError(e.message)}}).finally(()=>{if(live)setLoading(false)});return()=>{live=false};
 },[organizationId,brandId,context,configured,folderId,search,type,pageCursor]);
 const navigate=file=>{setPath(p=>[...p,{id:file.selection_id||file.id,name:file.name}]);setSearch('');setPageCursor(null);};
 const select=file=>onSelect?.(file);
 const open=file=>file.mimeType===FOLDER?navigate(file):setPreview(file);
 const thumbnail=file=>file.mimeType===FOLDER?<div className="drive-thumb"><Folder size={38}/></div>:file.mimeType.startsWith('video/')?<div className="drive-thumb"><Film size={30}/></div>:<DrivePreview organizationId={organizationId} brandId={brandId} file={file} thumbnail/>;
 const selection=file=>file.mimeType!==FOLDER&&onSelect?<button type="button" className="icon-btn" aria-label={`${selected.includes(mediaKey(file))?'Remove':'Select'} ${file.name}`} aria-pressed={selected.includes(mediaKey(file))} onClick={()=>select(file)}>{selected.includes(mediaKey(file))?<Check size={16}/>:<span>+</span>}</button>:null;
 const columns=[
  {key:'name',header:'Name',className:'drive-name-cell',render:file=><button type="button" className="drive-list-name" onClick={()=>open(file)} aria-label={`${file.mimeType===FOLDER?'Open folder':'Preview'} ${file.name}`}><span className="drive-list-thumbnail">{thumbnail(file)}</span><span><strong>{file.name}</strong>{file.is_shortcut?<small>Shortcut</small>:null}</span></button>},
  {key:'type',header:'Type',className:'drive-type-cell',render:file=><><span className="drive-mobile-label">Type</span>{mediaType(file)}</>},
  {key:'modified',header:'Modified Date',className:'drive-modified-cell',render:file=><><span className="drive-mobile-label">Modified</span><span title={mediaDateLabel(file)==='—'?'Modified date unavailable':undefined}>{mediaDateLabel(file)}</span></>},
  {key:'size',header:'Size',className:'drive-size-cell',render:file=><><span className="drive-mobile-label">Size</span><span title={mediaSizeLabel(file)==='—'?'Size unavailable':undefined}>{mediaSizeLabel(file)}</span></>},
  {key:'actions',header:'Actions',width:94,className:'drive-actions-cell',render:file=><div className="drive-row-actions"><button type="button" className="icon-btn" onClick={()=>open(file)} aria-label={`${file.mimeType===FOLDER?'Open':'View'} ${file.name}`}>{file.mimeType===FOLDER?<ChevronRight size={16}/>:<Eye size={16}/>}</button>{selection(file)}</div>}
 ];
 return <div className="drive-browser">
 <div className="drive-toolbar"><nav aria-label="Media folders">{path.map((p,i)=><span key={i}>{i?<ChevronRight size={14}/>:null}<button onClick={()=>{setPath(path.slice(0,i+1));setPageCursor(null);setSearch('')}} disabled={i===path.length-1}>{p.name}</button></span>)}</nav><div className="flex gap-2">{favorites?<button className="btn-secondary" onClick={()=>{setPath([{id:context.root.root_id,name:context.root.root_name},{id:favorites,name:'00 Favorites'}]);setPageCursor(null);setSearch('')}}><Star size={14}/> Favorites</button>:null}<button className="btn-secondary" onClick={()=>setRefresh(r=>r+1)} aria-label="Refresh media"><RefreshCw size={15}/></button>{context?.root?<a className="btn-secondary" target="_blank" rel="noopener noreferrer" href={`https://drive.google.com/drive/folders/${context.root.root_id}`}><ExternalLink size={15}/> Open in Drive</a>:null}</div></div>
 <AdminFilterToolbar compact denseFields search={<AdminSearchField label="Search" value={search} onChange={value=>{setSearch(value);setPageCursor(null)}} placeholder="Search brand media"/>} filters={<><SelectField label="Type" value={type} onChange={value=>{setType(value);setPageCursor(null)}} options={[{value:'',label:'All'},{value:'image',label:'Images'},{value:'video',label:'Videos'}]}/><SelectField label="Sort" value={sort} onChange={setSort} options={[{value:'name_asc',label:'Name A–Z'},{value:'name_desc',label:'Name Z–A'},{value:'modified_desc',label:'Modified · Newest'},{value:'modified_asc',label:'Modified · Oldest'},{value:'size_desc',label:'Size · Largest'},{value:'size_asc',label:'Size · Smallest'}]}/></>} secondaryActions={<AdminSegmentedControl label="Media view" value={view} onChange={changeView} options={[{value:'grid',label:<><LayoutGrid size={15}/> Grid</>},{value:'list',label:<><List size={15}/> List</>}]}/>}/>

 <AsyncDataSurface loading={loading} error={error} onRetry={()=>setRefresh(r=>r+1)} hasData={Boolean(files.length)}>
 {!loading&&!error&&(!configured||context?.status!=='connected'||!context?.root)?<div className="drive-empty"><Folder size={30}/><h2>{!configured?'Google Drive setup pending':context?.status!=='connected'?'Connect Google Drive':'Choose this brand’s media folder'}</h2><p>An organization administrator can manage the connection and brand folder in Marketing Settings.</p></div>:null}
 {!loading&&!error&&configured&&context?.root&&context.status==='connected'?<>
 {view==='grid'?<div className="drive-grid">{displayed.map(file=><article key={mediaKey(file)} className={`drive-tile ${selected.includes(mediaKey(file))?'is-selected':''}`}><button type="button" className="drive-tile-preview" onClick={()=>open(file)} aria-label={`${file.mimeType===FOLDER?'Open folder':'Preview'} ${file.name}`}>{thumbnail(file)}</button><div className="drive-tile-caption"><strong title={file.name}>{file.name}</strong><small>{mediaType(file)}{file.is_shortcut?' · Shortcut':''}</small>{selection(file)}</div></article>)}</div>:<DataTable tableClassName="drive-list-table" density="compact" minWidth={0} columns={columns} rows={displayed} getRowKey={mediaKey} onRowClick={open} getRowClassName={file=>selected.includes(mediaKey(file))?'drive-row-selected':''} getRowProps={file=>({tabIndex:0,'aria-label':`${file.mimeType===FOLDER?'Open folder':'Preview'} ${file.name}`,'aria-selected':selected.includes(mediaKey(file)),onKeyDown:event=>{if(event.target!==event.currentTarget)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();open(file)}}})}/>}
 {!files.length?<p className="drive-empty">No matching media in this brand folder.</p>:null}
 <div className="drive-pagination">{cursor||pageCursor?<small>Sorting applies to the current page.</small>:null}<div className="flex gap-2">{pageCursor?<button type="button" className="btn-secondary" onClick={()=>setPageCursor(null)}>First page</button>:null}<button type="button" className="btn-secondary" disabled={!cursor||loading} onClick={()=>setPageCursor(cursor)}>More media</button></div></div></>:null}
 </AsyncDataSurface>
 {preview?<MediaLightbox items={previewItems} index={Math.max(0,previewItems.findIndex(item=>item.id===(preview.selection_id||preview.id)))} resolveSource={resolvePreview} onClose={()=>setPreview(null)} footer={onSelect?item=><button className="btn-primary" onClick={()=>{select(item.driveFile);setPreview(null)}}>{selected.includes(item.id)?'Remove selection':'Select media'}</button>:null} details={item=><dl className="drive-file-facts"><dt>Format</dt><dd>{item.mime_type}</dd><dt>Size</dt><dd>{mediaSizeLabel(item.driveFile||{})}</dd><dt>Modified</dt><dd>{mediaDateLabel(item.driveFile||{})}</dd></dl>}/>:null}
 </div>;
}
