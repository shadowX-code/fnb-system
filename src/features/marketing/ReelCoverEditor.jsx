import {useEffect,useState} from 'react';
import {Image as ImageIcon} from 'lucide-react';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import MarketingMediaPicker from './MarketingMediaPicker.jsx';
import {marketingService} from './marketingService.js';
import {videoCoverFrame} from './videoCoverFrame.js';
export default function ReelCoverEditor({variant,brand,assets,onChange,onAssetsResolved,onMetadata,disabled=false}){
 const cover=variant.reel_cover||{mode:'automatic'},videoId=variant.asset_ids[0],imageId=cover.mode==='image'?cover.asset_id:null;
 const video=assets.find(a=>a.id===videoId),image=assets.find(a=>a.id===imageId),instagram=variant.channel==='instagram';
 const offset=cover.mode==='frame'?cover.offset_ms:0;
 const [preview,setPreview]=useState({url:'',state:'empty',error:''}),[retry,setRetry]=useState(0);
 const previewKey=JSON.stringify([brand.organization_id,brand.id,videoId,cover.mode,imageId,offset,video?.id,video?.state,image?.id,image?.state,retry]);
 useEffect(()=>{
  const controller=new AbortController();let objectUrl;setPreview({key:previewKey,url:'',state:videoId?'loading':'empty',error:''});
  if(!videoId)return()=>controller.abort();
  const timer=setTimeout(async()=>{
   try{
    if(cover.mode==='image'){
     if(!image)throw new Error('Choose a 9:16 JPEG cover to preview.');
     const url=await marketingService.assetUrl(image);if(!controller.signal.aborted)setPreview({key:previewKey,url,state:'ready',error:''});
    }else{
     if(!video)throw new Error('Selected video details are unavailable. Reopen the Media Library.');
     if(!Number.isSafeInteger(offset))throw new Error('Enter a valid frame time.');
     const url=await marketingService.assetUrl(video);controller.signal.throwIfAborted();
     const frame=await videoCoverFrame(url,offset,controller.signal);controller.signal.throwIfAborted();objectUrl=URL.createObjectURL(frame.blob);
     if(!controller.signal.aborted){setPreview({key:previewKey,url:objectUrl,state:'ready',error:''});onMetadata?.(videoId,frame.metadata);}
    }
   }catch(error){if(!controller.signal.aborted)setPreview({key:previewKey,url:'',state:'error',error:error.message||'Cover preview unavailable.'});}
  },180);
  return()=>{clearTimeout(timer);controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 // A pinned asset identity is immutable; changing any cover input cancels old work.
 // Metadata callbacks do not restart extraction or cross a Brand/channel boundary.
 },[previewKey]);
 const current=preview.key===previewKey?preview:{state:'loading',url:''};
 function select(mode){onChange(mode==='automatic'?{mode}:{mode,video_asset_id:videoId,...(mode==='frame'?{offset_ms:0}:{asset_id:''})});}
 return <section className="post-reel-cover" aria-label={`${instagram?'Instagram':'Facebook'} Reel cover`}>
 <div className="post-reel-cover-heading"><h4>Reel cover</h4><span>{instagram?'Instagram only':'Selected by Facebook'}</span></div>
 {instagram?<><AdminSegmentedControl label="Instagram cover source" value={cover.mode} onChange={select} options={[{value:'automatic',label:'Automatic',disabled},{value:'frame',label:'Video frame',disabled:disabled||!videoId},{value:'image',label:'Custom image',disabled:disabled||!videoId}]}/>
 {cover.mode==='frame'?<AdminFormField label="Frame time (seconds)" helper="Uses this frame from the selected video. H.264 MP4 required."><input className="control" type="number" min="0" max="3600" step="0.1" value={Number.isFinite(offset)?offset/1000:''} disabled={disabled} onChange={e=>onChange({...cover,offset_ms:e.target.value===''?null:Math.round(Number(e.target.value)*1000)})}/></AdminFormField>:null}
 {cover.mode==='image'?<><MarketingMediaPicker brand={brand} channel="instagram" format="reel_cover" values={imageId?[imageId]:[]} assets={assets} disabled={disabled} thumbnailPreviews onAssetsResolved={onAssetsResolved} onChange={ids=>onChange(ids.length?{mode:'image',video_asset_id:videoId,asset_id:ids[0]}:{mode:'automatic'})}/><p className="post-editor-help">9:16 JPEG · 540–1440 pixels wide · up to 8 MB. The original video stays unchanged.</p></>:null}</>:<p className="post-editor-help">The Page Reel publishing API does not provide verified custom-cover controls. Facebook selects the published cover.</p>}
 <div className="post-cover-placements" aria-busy={current.state==='loading'}>{[{key:'reel',label:'Reel · 9:16'},...(instagram?[{key:'grid',label:'Profile grid · 3:4'}]:[])].map(placement=><figure key={placement.key}><div className={`post-cover-image post-cover-${placement.key}`}>{current.url?<img src={current.url} alt={`${placement.key==='grid'?'Profile grid':'Reel'} cover preview`} onLoad={e=>{if(imageId)onMetadata?.(imageId,{width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}} onError={()=>setPreview({key:previewKey,url:'',state:'error',error:'Cover image could not be loaded.'})}/>:<span><ImageIcon size={18}/>{current.state==='loading'?'Loading preview…':videoId?'Preview unavailable':'Choose a video'}</span>}</div><figcaption>{placement.label}</figcaption></figure>)}</div>
 <p className="post-editor-help">{instagram?'Placement previews use a center crop; Meta controls final placement and may adjust cropping.':'First-frame preview only; it does not control Facebook’s cover.'}</p>
 {current.error?<div className="post-cover-error" role="status"><span>{current.error}</span>{videoId?<button type="button" className="btn-secondary" disabled={disabled} onClick={()=>setRetry(v=>v+1)}>Retry preview</button>:null}</div>:null}
 </section>;
}
