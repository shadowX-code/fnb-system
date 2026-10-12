import {useState} from 'react';
import DriveMediaBrowser from './DriveMediaBrowser.jsx';
export default function MediaLibrary({organizationId,brandId,userId}){
 const [selected,setSelected]=useState([]);
 return <div className="space-y-3">{selected.length?<div className="flex items-center justify-between gap-2 text-sm"><span>{selected.length} selected</span><button className="btn-secondary" onClick={()=>setSelected([])}>Clear selection</button></div>:null}<DriveMediaBrowser preferenceUserId={userId} organizationId={organizationId} brandId={brandId} selected={selected} onSelect={file=>{const id=file.selection_id||file.id;setSelected(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id])}}/></div>;
}
