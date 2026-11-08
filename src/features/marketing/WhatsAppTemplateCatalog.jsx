import {useState} from 'react';
import {marketingService} from './marketingService.js';

const placeholder = /{{\s*([a-z][a-z0-9_]*|[1-9]\d*)\s*}}/gi;

export default function WhatsAppTemplateCatalog({organizationId,brandId,connection}){
 const [catalog,setCatalog]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [selected,setSelected]=useState(''),[values,setValues]=useState({});
 const template=catalog?.templates.find(item=>item.id===selected);
 const fields=template?.components.flatMap((component,index)=>
  [...new Set([...String(component.text??'').matchAll(placeholder)].map(match=>match[1]))].map(name=>({index,name,key:`${index}:${name}`}))
 )||[];
 async function load(){
  setBusy(true);setError('');setCatalog(null);setSelected('');setValues({});
  try{
   const result=await marketingService.whatsappTemplates({organizationId,brandId,connectionId:connection.id,generation:connection.credential_generation});
   setCatalog(result);
   setSelected((result.templates.find(item=>item.status==='APPROVED')||result.templates[0])?.id||'');
  }catch(error){setError(error.message);}
  finally{setBusy(false);}
 }
 return <div className="mt-4 space-y-2 border-t border-border-default pt-3">
  <h3 className="font-semibold">Meta message templates</h3>
  <p>Read and preview templates for this test WABA. Template sending is disabled.</p>
  <button className="btn-secondary" disabled={busy} onClick={load}>{busy?'Checking Meta…':'Refresh templates from Meta'}</button>
  {error&&<p role="alert">{error}</p>}
  {catalog&&!catalog.templates.length&&<p role="status">Meta returned no templates for this WABA.</p>}
  {catalog?.templates.length>0&&<label className="block">Template
   <select className="control block max-w-full" value={selected} onChange={event=>{setSelected(event.target.value);setValues({});}}>
    {catalog.templates.map(item=><option key={item.id} value={item.id}>{item.name} · {item.language} · {item.status}</option>)}
   </select>
  </label>}
  {template&&<>
   <p>{template.category} · {template.language} · {template.status}</p>
   {template.status!=='APPROVED'&&<p role="status">Meta approval is required before this template can be used.</p>}
   {fields.map(field=><label className="block" key={field.key}>{template.components[field.index].type} variable {field.name}
    <input className="control block max-w-full" maxLength={1024} value={values[field.key]||''}
     onChange={event=>setValues(previous=>({...previous,[field.key]:event.target.value}))}/>
   </label>)}
   {fields.some(field=>!values[field.key]?.trim())&&<p>Fill all variables to preview the completed text.</p>}
   <div className="break-words rounded border border-border-default p-3" aria-label="Template preview">
    {template.components.map((component,index)=><div key={index}>
     {component.text&&<p className="whitespace-pre-wrap">{component.text.replace(placeholder,(token,name)=>values[`${index}:${name}`]?.trim()||token)}</p>}
     {component.type==='HEADER'&&component.format&&component.format!=='TEXT'&&<p>Header requires {component.format.toLowerCase()} media or data.</p>}
     {component.buttons.length>0&&<ul className="mt-2">{component.buttons.map((button,i)=><li key={i}>{button.text||'Button'} · {button.type.replaceAll('_',' ').toLowerCase()}</li>)}</ul>}
    </div>)}
   </div>
  </>}
 </div>;
}
