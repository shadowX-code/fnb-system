import {CheckCircle2, LockKeyhole, Info, Code2} from 'lucide-react';
import DataTable from '../tables/DataTable.jsx';
import {accessScopeSummary} from './accessScopeSummary.js';

function ScopeSection({title,icon:Icon,children,className=''}) {
 return <section className={`access-scope-section ${className}`} aria-label={title}>
  <h4><Icon size={14} aria-hidden="true"/>{title}</h4>{children}
 </section>;
}
export default function AccessScopeSummary({capability,catalog=[]}) {
 const {included,separate,notes}=accessScopeSummary(capability,catalog);
 const labelFor=id=>catalog.find(c=>c.module_id===id)?.label||capability.required_modules?.find(c=>c.id===id)?.label||id;
 return <details className="module-access-details access-scope-summary"><summary>Access Details</summary>
  <div className="access-scope-grid">
   <ScopeSection title="Included with this access" icon={CheckCircle2}>
    {included.length?<ul>{included.map(label=><li key={label}>{label}</li>)}</ul>:<p>The listed collections require source access shown alongside.</p>}
   </ScopeSection>
   <ScopeSection title="Requires separate access" icon={LockKeyhole}>
    {separate.length?<ul>{separate.map((item,i)=><li key={`${item.label}:${i}`}><span>{item.label}</span>{item.sources.length>0&&<small>Source access: {item.sources.join(', ')}</small>}</li>)}</ul>:<p>No additional source capabilities are declared for these collections.</p>}
   </ScopeSection>
   {notes.length>0&&<ScopeSection title="Data notes" icon={Info} className="access-scope-notes"><ul>{notes.map(note=><li key={note}>{note}</li>)}</ul></ScopeSection>}
  </div>
  <details className="access-scope-diagnostics"><summary><Code2 size={14} aria-hidden="true"/>Developer Diagnostics</summary>
   <dl><div><dt>Capability</dt><dd>{capability.name}</dd></div><div><dt>Permission</dt><dd>{capability.permission||'Not supplied'}</dd></div></dl>
   {(capability.scope||[]).map((scope,i)=><details key={`${scope.resource}:${i}`}><summary>{scope.label} <code>{scope.resource}</code></summary>
    {scope.required_modules?.length>0&&<dl><div><dt>Required sources</dt><dd>{scope.required_modules.map(id=><span key={id}>{labelFor(id)} <code>{id}</code><br/></span>)}</dd></div></dl>}
    {Object.keys(scope.row_scope||{}).length>0&&<dl>{Object.entries(scope.row_scope).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>}
    {scope.fields?.length>0?<DataTable density="compact" mobileLayout="stack" minWidth={0} rows={scope.fields.map(field=>({field,context:scope.context_fields?.[field],separate:scope.relationships?.[field]}))} getRowKey={row=>row.field} columns={[
     {key:'field',header:'Field',render:row=><code>{row.field}</code>},
     {key:'policy',header:'Field policy',render:row=>row.separate?'Separate related access required':row.context?'Minimal reference context':'Declared record field'},
     {key:'source',header:'Related owner',render:row=>(row.context||row.separate)?<><span>{labelFor(row.context||row.separate)}</span><br/><code>{row.context||row.separate}</code></>:'—'},
    ]}/>:<p>Field mappings are not supplied for this saved grant.</p>}
   </details>)}
  </details>
 </details>;
}
