import {useEffect,useRef,useState} from 'react';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminEvidenceFilePicker from '../../components/forms/AdminEvidenceFilePicker.jsx';
import MarketingMediaPreview from './MarketingMediaPreview.jsx';
import {marketingService} from './marketingService.js';

export default function CampaignMediaField({org,brand,assets,assetId,onChange,onUploaded,canUpload,busy,onBusy}) {
 const [error,setError]=useState(''),[pending,setPending]=useState(null);const active=useRef(0);
 // Scope changes unmount this field; late uploads must not replace another draft's media.
 useEffect(()=>()=>{active.current++;},[]);
 useEffect(()=>()=>{if(pending)URL.revokeObjectURL(pending.url)},[pending]);
 const asset=assets.find(a=>a.id===assetId);
 async function upload(file){
  if(!file){onChange('');return;}
  setError('');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>104857600||file.name.length>200){setError('Choose a JPG, PNG or WebP image up to 100 MB.');return;}
  const attempt=++active.current;const url=URL.createObjectURL(file);setPending({file,url});onBusy(true);
  try{
   if(typeof createImageBitmap==='function'){const bitmap=await createImageBitmap(file);bitmap.close();}else{const image=new Image();image.src=url;await image.decode();}
   if(attempt!==active.current)return;
   const uploaded=await marketingService.upload(org,brand,file);if(attempt===active.current){onUploaded(uploaded);onChange(uploaded.id);}}catch(e){if(attempt===active.current)setError('Image could not be uploaded or decoded. Check the file and try again.');}finally{if(attempt===active.current){setPending(null);onBusy(false);}}
 }
 return <section className="space-y-3" aria-label="Campaign media">
  <SelectField label="Campaign image" value={assetId||''} disabled={busy} searchable="auto" onChange={id=>{setError('');onChange(id)}} options={[{value:'',label:'No image'},...assets.map(a=>({value:a.id,label:a.filename}))]}/>
  {pending?<img src={pending.url} alt={pending.file.name} className="w-full max-h-96 rounded-lg object-contain"/>:asset?<MarketingMediaPreview key={asset.id} asset={asset}/>:null}
  {canUpload?<AdminEvidenceFilePicker file={pending?.file||(asset?{name:asset.filename,type:asset.mime_type,size:asset.size_bytes}:null)} onChange={upload} accept="image/jpeg,image/png,image/webp" disabled={busy} label="Upload campaign image" removeLabel="Remove campaign image" helper="JPG, PNG or WebP · up to 100 MB"/>:asset?<button type="button" className="btn-secondary" disabled={busy} onClick={()=>onChange('')}>Remove image</button>:null}
  {pending?<p role="status" className="text-sm text-text-secondary">Uploading image…</p>:null}
  {error?<p role="alert" className="text-sm text-danger">{error}</p>:null}
 </section>;
}
