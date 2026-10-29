import {Plus, Minus, ArrowRightLeft, ShieldAlert} from 'lucide-react';
import Badge from '../ui/Badge.jsx';
import DataTable from '../tables/DataTable.jsx';
import AccessScopeSummary from './AccessScopeSummary.jsx';

function auditChanges(before,after) {
 const prior=before?.audit_modules||[],next=after?.audit_modules||[];
 return {added:next.filter(n=>!prior.some(p=>p.id===n.id)).map(n=>n.label),removed:prior.filter(p=>!next.some(n=>n.id===p.id)).map(p=>p.label)};
}
function ChangeSection({title,icon:Icon,children}) {
 return <section className="access-change-section" aria-label={title}><h3 className="external-agent-heading"><Icon size={15} aria-hidden="true"/>{title}</h3>{children}</section>;
}
export default function AccessChangeReview({plan,catalog=[]}) {
 const diff=plan.effective_diff;
 if(!diff) return <p role="alert">Review details are unavailable. Go back and review again.</p>;
 const added=plan.changes.filter(c=>c.granted),removed=plan.changes.filter(c=>!c.granted);
 const primaryBlockers=diff.blockers.filter(b=>b.kind!=='pre_existing');
 const existingBlockers=diff.blockers.filter(b=>b.kind==='pre_existing');
 const affectedNames=new Set(plan.changes.map(c=>c.name));
 const diagnostics=[...new Set([...diff.before,...diff.after].map(p=>p.key))].map(key=>({key,before:diff.before.find(p=>p.key===key),after:diff.after.find(p=>p.key===key)})).filter(row=>JSON.stringify(row.before)!==JSON.stringify(row.after));
 const affected=plan.remaining_access.filter(c=>affectedNames.has(c.name)||diff.material_changes.some(m=>(m.after||m.before).grant_name===c.name));
 return <div className="space-y-4">
  {added.length>0&&<ChangeSection title="Access added" icon={Plus}>{added.map(c=><div className="access-change-item" key={c.name}><Badge tone="success">Add</Badge><div><strong>{c.label}</strong><small>View Records</small>{diff.after.some(p=>p.grant_name===c.name)&&<p>{[...new Set(diff.after.filter(p=>p.grant_name===c.name).map(p=>p.label))].join(', ')}</p>}{diff.after.filter(p=>p.grant_name===c.name&&p.audit_modules?.length).map(p=><p key={p.key}>Recognized activity: {p.audit_modules.map(m=>m.label).join(', ')}.</p>)}</div></div>)}</ChangeSection>}
  {removed.length>0&&<ChangeSection title="Access removed" icon={Minus}>{removed.map(c=><div className="access-change-item" key={c.name}><Badge tone="danger">Remove</Badge><div><strong>{c.label}</strong><small>View Records</small></div></div>)}</ChangeSection>}
  {diff.material_changes.length>0&&<ChangeSection title="Changes to data exposure" icon={ArrowRightLeft}>{diff.material_changes.map((m,i)=><div className="access-change-item" key={i}><Badge tone={m.effect==='added'?'success':m.effect==='removed'?'danger':'warning'}>{m.effect==='added'?'Add':m.effect==='removed'?'Remove':'Change'}</Badge><div><strong>{m.owner} · {m.label}</strong><p>{m.effect==='added'?'Becomes available through existing access.':m.effect==='removed'?'Becomes unavailable through this access path.':'Related fields or recognized activity scope changes.'}</p>{auditChanges(m.before,m.after).added.length>0&&<p>Activity added: {auditChanges(m.before,m.after).added.join(', ')}.</p>}{auditChanges(m.before,m.after).removed.length>0&&<p>Activity removed: {auditChanges(m.before,m.after).removed.join(', ')}.</p>}</div></div>)}</ChangeSection>}
  {primaryBlockers.length>0&&<ChangeSection title="Affected source requirements" icon={ShieldAlert}>{primaryBlockers.map((b,i)=><div className="access-change-blocker" key={i}><Badge tone="warning">{b.kind==='new_blocker'?'New blocker':'Added access needs sources'}</Badge><strong>{b.owner} · {b.label}</strong><p>Requires {b.missing.map(d=>d.label).join(', ')}.</p></div>)}</ChangeSection>}
  {diff.remaining_shared_access.length>0&&<ChangeSection title="Access remaining after revocation" icon={ArrowRightLeft}>{diff.remaining_shared_access.map((s,i)=><div key={i} className="access-change-retained"><strong>{s.removed} → {s.via}</strong><p>{s.note}</p></div>)}</ChangeSection>}
  {(affected.length>0||existingBlockers.length>0||diagnostics.length>0)&&<details className="access-change-related"><summary>Related Access</summary>
   {existingBlockers.map((b,i)=><div className="access-change-retained" key={i}><Badge tone="neutral">Pre-existing limitation</Badge><p><strong>{b.owner} · {b.label}</strong> still requires {b.missing.map(d=>d.label).join(', ')}.</p></div>)}
   {affected.map(c=><div key={c.name} className="py-2"><strong>{c.label}</strong><AccessScopeSummary capability={c} catalog={catalog}/></div>)}
   {diagnostics.length>0&&<details className="access-scope-diagnostics"><summary>Developer Diagnostics</summary><DataTable density="compact" minWidth={0} mobileLayout="stack" rows={diagnostics} getRowKey={r=>r.key} columns={[
    {key:'resource',header:'Resource',render:r=><code>{(r.after||r.before).module_id||'Saved scope'} / {(r.after||r.before).resource}</code>},
    {key:'before',header:'Before',render:r=>r.before?`${r.before.fields?.length??'Saved'} safe fields · ${r.before.actions.join(', ')}`:'Not available'},
    {key:'after',header:'After',render:r=>r.after?`${r.after.fields?.length??'Saved'} safe fields · ${r.after.actions.join(', ')}`:'Not available'},
   ]}/></details>}
  </details>}
  <p className="text-xs text-text-secondary">Permission scope only. Requests still require an enabled agent and a valid access key. Dependencies are never granted automatically.</p>
 </div>;
}
