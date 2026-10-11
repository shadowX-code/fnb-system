import { useEffect, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Download, CheckCircle2 } from 'lucide-react';
import Modal from '../../components/feedback/Modal.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import { readTabularFile, downloadCsv } from '../../lib/tabularFile.js';
import { outreachService } from './outreachService.js';
import { customerImportFields, defaultCustomerMapping, mapCustomerRows, initialImportDecisions, selectedImportCount, importNames } from './customerImport.js';
const steps=['Upload','Map fields','Validate & preview','Confirm import','Results'];
export default function CustomerImportDialog({org,brand,brandName,outlets=[],onClose,onImported}) {
 const [step,setStep]=useState(0),[file,setFile]=useState(null),[table,setTable]=useState(null),[mapping,setMapping]=useState({}),[rows,setRows]=useState([]),[preview,setPreview]=useState([]),[decisions,setDecisions]=useState({}),[result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[page,setPage]=useState(1),[size,setSize]=useState(20),[filter,setFilter]=useState(''),[confirmed,setConfirmed]=useState(false);
 const live=useRef(true),request=useRef(null),flight=useRef(false);
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[]);
 const selected=selectedImportCount(preview,decisions);
 async function run(action){if(flight.current)return;flight.current=true;setBusy(true);setError('');try{await action();}catch(e){if(live.current)setError(e.message||'Unable to process this file.');}finally{flight.current=false;if(live.current)setBusy(false);}}
 async function upload(value){await run(async()=>{const parsed=await readTabularFile(value);if(!live.current)return;setFile(value);setTable(parsed);setMapping(defaultCustomerMapping(parsed.headers));setPreview([]);setResult(null);setStep(1);});}
 async function validate(){await run(async()=>{const mapped=mapCustomerRows(table,mapping,outlets);const response=await outreachService.importPreview(org,brand,mapped);if(!live.current)return;setRows(mapped);setPreview(response.rows);setDecisions(initialImportDecisions(response.rows));setPage(1);setFilter('');setConfirmed(false);request.current=null;setStep(2);});}
 async function commit(){await run(async()=>{const fp=JSON.stringify([rows,decisions]);if(request.current?.fp!==fp)request.current={fp,id:crypto.randomUUID()};const response=await outreachService.importCommit(request.current.id,org,brand,rows,decisions);if(!live.current)return;setResult(response);setStep(4);setPage(1);setFilter('');onImported?.();});}
 function selectField(row,key,checked){setDecisions(d=>{const fields=checked?[...d[row.row].fields,key]:d[row.row].fields.filter(f=>f!==key);return {...d,[row.row]:{...d[row.row],fields,selected:fields.length>0}}});}
 const shown=(result?result.rows.map(r=>({...preview.find(p=>p.row===r.row),...r})):preview).filter(r=>!filter||(r.status||r.classification)===filter);
 const counts={};for(const row of result?.rows||preview){const k=row.status||row.classification;counts[k]=(counts[k]||0)+1;}
 const renderDetails=r=>r.reason?<span className="text-danger">{r.reason}</span>:r.classification==='review'&&!result?<div className="import-differences">{Object.entries(r.differences).map(([key,diff])=><label key={key}><input type="checkbox" aria-label={`Update ${key} for row ${r.row}`} checked={decisions[r.row]?.fields.includes(key)||false} onChange={e=>selectField(r,key,e.target.checked)}/><span><strong>{customerImportFields.find(f=>f.key===key)?.label}</strong><small>{display(diff.before,outlets)} → {display(diff.after,outlets)}</small></span></label>)}</div>:<small>{r.classification==='unchanged'?'No changes. No customer write.':r.classification==='new'?'New brand relationship · consent not imported':result?r.status==='updated'?`Updated: ${(r.fields||[]).join(', ')}`:'Processing outcome recorded':'Select only fields you approve.'}</small>;
 function report(){downloadCsv('feedx-customer-import-results.csv',[['File row','Name','Phone','Result','Details'],...result.rows.map(r=>{const p=preview.find(p=>p.row===r.row);return [table.rows[r.row-1].__row,p?.values?.name||'',p?.values?.phone||'',importNames[r.status],r.reason||(r.fields||[]).join(', ')];})]);}
 return <Modal open title="Import customers" size="xl" onClose={()=>{if(!busy)onClose()}} footer={<>
  <button className="btn-secondary" disabled={busy} onClick={onClose}>{step===4?'Done':'Cancel'}</button>
  {step>0&&step<4?<button className="btn-secondary" disabled={busy} onClick={()=>{setStep(step-1);setConfirmed(false)}}>Back</button>:null}
  {step===1?<button className="btn-primary" disabled={busy||!mapping.name||!mapping.phone} onClick={validate}>{busy?'Validating…':'Validate & preview'}</button>:null}
  {step===2?<button className="btn-primary" disabled={busy||!preview.length} onClick={()=>{setStep(3);setConfirmed(false)}}>Review {selected} selected</button>:null}
  {step===3?<button className="btn-primary" disabled={busy||!confirmed||!preview.length} onClick={commit}>{busy?'Importing…':`Confirm import (${selected})`}</button>:null}
  {step===4?<button className="btn-primary" onClick={report}><Download size={15}/> Download results</button>:null}
 </>}><div className="customer-import">
  <ol className="import-steps" aria-label="Import steps">{steps.map((label,i)=><li key={label} aria-current={step===i?'step':undefined}><span>{i<step?'✓':i+1}</span>{label}</li>)}</ol>
  <p className="text-sm text-text-secondary">{brandName} · Import does not grant WhatsApp consent or change suppression.</p>
  {error?<p role="alert" className="text-danger">{error}</p>:null}
  {step===0?<label className="import-upload"><Upload size={24}/><strong>Upload CSV or Excel file</strong><span>Up to 10 MB · 500 customer rows · first worksheet</span><input aria-label="Customer import file" type="file" accept=".csv,.xlsx" disabled={busy} onChange={e=>{if(e.target.files?.[0])upload(e.target.files[0]);e.target.value=''}}/><small>{busy?'Reading file…':'Name and Malaysian phone are required. Other fields are optional.'}</small></label>:null}
  {file&&step<4?<p className="import-file"><FileSpreadsheet size={18}/><strong>{file.name}</strong><span>{table.rows.length} rows</span></p>:null}
  {step===1?<><div className="outreach-form-grid">{customerImportFields.map(f=><SelectField key={f.key} label={f.label+(f.required?' *':'')} value={mapping[f.key]||''} onChange={v=>setMapping(m=>({...m,[f.key]:v}))} options={[{value:'',label:f.required?'Select column':'Do not import'},...table.headers.map(h=>({value:h,label:h}))]}/>)}</div><p className="text-sm text-text-secondary">Unmapped fields stay unchanged. Consent, suppression, phone changes and cross-brand sharing require their existing review workflows.</p></>:null}
  {[2,4].includes(step)?<>
   {step===4?<div role="status" className="import-complete"><CheckCircle2 size={22}/><strong>Import processed</strong><span>{selected} selected · {result.rows.length} rows reviewed</span></div>:null}
   <div className="import-summary">{Object.entries(counts).map(([key,count])=><button type="button" key={key} aria-pressed={filter===key} onClick={()=>{setFilter(filter===key?'':key);setPage(1)}}><strong>{count}</strong><span>{importNames[key]}</span></button>)}</div>
   <p className="text-sm text-text-secondary">{result?'Download results for row-level outcomes.':'Existing records are not selected automatically. Choose each field to approve its change.'}</p>
   <div className="outreach-desktop-table"><DataTable minWidth={640} density="compact" rows={shown.slice((page-1)*size,page*size)} getRowKey={r=>r.row} columns={[
    {key:'row',header:'File row',width:70,render:r=>table.rows[r.row-1].__row},
    {key:'customer',header:'Customer',render:r=><><strong>{r.values?.name||rows[r.row-1]?.name||'—'}</strong><small>{r.values?.phone||rows[r.row-1]?.phone||'—'}</small></>},
    {key:'result',header:'Result',width:140,render:r=><Badge tone={['invalid','conflict'].includes(r.status||r.classification)?'danger':(r.status||r.classification)==='review'?'warning':'default'}>{importNames[r.status||r.classification]}</Badge>},
    {key:'details',header:'Review differences / details',render:renderDetails},
    {key:'selected',header:result?'':'Import',width:70,render:r=>!result&&r.classification==='new'?<input type="checkbox" aria-label={`Import row ${r.row}`} checked={!!decisions[r.row]?.selected} onChange={e=>setDecisions(d=>({...d,[r.row]:{...d[r.row],selected:e.target.checked}}))}/>:null}
   ]}/></div>
   <div className="outreach-mobile-list">{shown.slice((page-1)*size,page*size).map(r=><article key={r.row}><strong>Row {table.rows[r.row-1].__row} · {r.values?.name||rows[r.row-1]?.name||'—'}</strong><small>{r.values?.phone||rows[r.row-1]?.phone||'—'} · {importNames[r.status||r.classification]}</small>{renderDetails(r)}{!result&&r.classification==='new'?<label><input type="checkbox" checked={!!decisions[r.row]?.selected} onChange={e=>setDecisions(d=>({...d,[r.row]:{...d[r.row],selected:e.target.checked}}))}/> Import this customer</label>:null}</article>)}</div>
   <AdminPagination total={shown.length} page={page} pageSize={size} noun="rows" onPageChange={setPage} onPageSizeChange={v=>{setSize(v);setPage(1)}}/>
  </>:null}
  {step===3?<div className="import-confirm"><h3>Import {selected} selected records into {brandName}</h3><p>Only new customers and explicitly selected field changes will be applied. Unchanged records are skipped. Invalid and conflicting rows remain untouched.</p><p>Matches are checked again when you confirm. A changed customer is reported as a conflict.</p><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I approve these selected customer changes. Consent and suppression stay unchanged.</label></div>:null}
 </div></Modal>;
}
function display(value,outlets){if(value===null||value==='')return 'Not set';if(Array.isArray(value))return value.join(', ')||'No tags';return outlets.find(o=>o.id===value)?.name||String(value);}
