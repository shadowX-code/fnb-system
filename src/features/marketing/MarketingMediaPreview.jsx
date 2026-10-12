import {useEffect,useState} from 'react';
import {marketingService} from './marketingService.js';
export default function MarketingMediaPreview({asset}) {
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let live=true;setUrl('');setError('');if(asset)marketingService.assetUrl(asset).then(value=>{if(live)setUrl(value)}).catch(e=>{if(live)setError(e.message||'Media preview unavailable. Try again.');});return()=>{live=false}},[asset?.id,retry]);
 if(!asset)return null;
 return <figure className="space-y-2 min-w-0">{error?<div role="alert" className="text-sm text-danger">{error}{!['retired','retiring'].includes(asset.state)?<button type="button" className="btn-secondary ml-2" onClick={()=>setRetry(v=>v+1)}>Retry preview</button>:null}</div>:!url?<p role="status" className="text-sm text-text-secondary">Loading media…</p>:asset.mime_type==='video/mp4'?<video src={url} controls className="block max-w-full max-h-80 mx-auto rounded-lg"/>:<img src={url} alt={asset.filename} className="block max-w-full max-h-80 mx-auto rounded-lg object-contain" onError={()=>setError('Image preview unavailable. Try again.')}/>}<figcaption className="text-xs text-text-secondary break-all">{asset.filename}</figcaption></figure>;
}
