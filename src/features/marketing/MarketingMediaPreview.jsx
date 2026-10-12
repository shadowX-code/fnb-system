import {useEffect,useState} from 'react';
import {Image as ImageIcon,Play} from 'lucide-react';
import MediaLightbox from '../../components/media/MediaLightbox.jsx';
import {marketingService} from './marketingService.js';
const resolveSource=asset=>marketingService.assetUrl(asset);
export default function MarketingMediaPreview({asset,assets,compact=false,interactive=true}) {
 const [url,setUrl]=useState(''),[error,setError]=useState(false),[retry,setRetry]=useState(0),[open,setOpen]=useState(false);
 useEffect(()=>{let live=true;setUrl('');setError(false);if(asset)resolveSource(asset).then(value=>{if(live)setUrl(value)}).catch(()=>{if(live)setError(true)});return()=>{live=false}},[asset?.id,asset?.state,retry]);
 if(!asset)return <span className="planner-thumbnail planner-thumbnail-empty" aria-label="No media attached"><ImageIcon size={20}/></span>;
 const video=asset.mime_type?.startsWith('video/'),items=assets?.length?assets:[asset],preview=error?<span>{compact?<ImageIcon size={20}/>: 'Media preview unavailable.'}</span>:!url?<span>{compact?<ImageIcon size={20}/>: 'Loading media…'}</span>:video?<><video src={url+'#t=0.1'} muted playsInline preload="metadata" onError={()=>setError(true)}/><Play size={compact?18:24} className="marketing-preview-play" aria-hidden="true"/></>:<img src={url} alt={asset.filename} loading="lazy" onError={()=>setError(true)}/>;
 return <><figure className={compact?'marketing-preview-compact':'marketing-preview'}>{interactive?<button type="button" className="marketing-preview-trigger" aria-label={`Preview ${asset.filename}`} onClick={e=>{e.stopPropagation();setOpen(true)}}>{preview}{compact&&items.length>1?<span className="marketing-preview-count">{items.length}</span>:null}</button>:<div className="marketing-preview-trigger">{preview}</div>}{!compact?<figcaption>{asset.filename}</figcaption>:null}{error&&!compact&&!['retired','retiring'].includes(asset.state)?<button className="btn-secondary" onClick={()=>setRetry(v=>v+1)}>Retry preview</button>:null}</figure>{open?<MediaLightbox items={items} index={Math.max(0,items.findIndex(v=>v.id===asset.id))} resolveSource={resolveSource} onClose={()=>setOpen(false)}/>:null}</>;
}
