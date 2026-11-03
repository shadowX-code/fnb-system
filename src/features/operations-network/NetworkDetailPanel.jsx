import { useState } from 'react';
import { ArrowUpRight, ChevronRight, X } from 'lucide-react';
import { formatOperationalDateTime } from '../../lib/dateTime.js';
import { statusLabels } from './networkModel.js';

export function NetworkTimeline({ events, modules, onSelect }) {
  return <section className="son-timeline" aria-label="Network activity">
    <div className="son-section-heading"><h2>Recorded activity</h2><span>{events.length} returned</span></div>
    <p className="son-muted">Gateway observations and canonical action receipts.</p>
    {!events.length ? <div className="son-empty"><strong>No matching recorded activity</strong><p>Try a wider time range or scope. Missing history does not establish inactivity.</p></div> : <ol>{events.slice(0, 40).map(event => <li key={event.id}>
      <span className="son-timeline-dot" data-status={event.status} aria-hidden="true" />
      <button type="button" onClick={() => onSelect(event.moduleIds[0])}><strong>{event.title}</strong><span>{event.agentName}</span><time dateTime={event.date}>{formatOperationalDateTime(event.date)}</time><span className="son-status" data-status={event.status}>{statusLabels[event.status]}</span></button>
      <p>{event.description}</p>
      <span className="son-muted">{event.moduleIds.map(id => modules.find(module => module.id === id)?.label).filter(Boolean).join(' · ')}</span>
    </li>)}</ol>}
    {events.length > 40 && <p className="son-muted">Showing the newest 40 returned observations. Select a node to narrow activity.</p>}
  </section>;
}

export default function NetworkDetailPanel({ node, events, modules, onClose, onNavigate, onToggle, onSelect }) {
  const [tab, setTab] = useState('overview');
  if (!node) return null;
  const data = node.data;
  const related = data.kind === 'platform' ? events : events.filter(event => data.members ? data.members.some(member => (member.agentId || (member.kind === 'agent' && member.id)) === event.agentId) : data.kind === 'workspace' ? event.workspaces.includes(data.workspace) : data.kind === 'agent' || data.kind === 'integration' ? event.agentId === (data.agentId || node.id.slice(6)) : event.moduleIds.includes(node.id));
  return <section className="son-detail" aria-label={`${data.label} details`}>
    <div className="son-section-heading"><h2>{data.label}</h2><button type="button" className="son-icon-button" onClick={onClose} aria-label="Close node details"><X size={17} /></button></div>
    <div className="son-detail-tabs" role="group" aria-label="Inspector sections">{[['overview','Overview'],['connections','Connections'],['activity','Activity'],...(['agent','module'].includes(data.kind) ? [['execution','Execution']] : [])].map(([id,label])=><button type="button" key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</div>
    {tab === 'overview' && <>
    <span className="son-status" data-status={data.status}>{statusLabels[data.status]}</span>
    <p>{data.description || (data.kind === 'module' ? 'An accessible FeedX operation. Open its page to inspect the authoritative records and available actions.' : data.kind === 'agent' ? 'Registered in AI Integrations. Connection evidence is historical and does not establish current online presence.' : 'Expand a workspace to inspect its operations.')}</p>
    {data.collapsed && <><p className="son-muted">This workspace is collapsed. Module connections are hidden.</p><button type="button" className="son-button" onClick={() => onSelect(node.id, data.workspace)}>Show on network<ChevronRight size={16} /></button></>}
    {data.lastObserved && <dl><dt>Last successful request</dt><dd>{formatOperationalDateTime(data.lastObserved)}</dd></dl>}
    {data.kind === 'module' && <><dl><dt>Module telemetry</dt><dd>{data.event ? `${statusLabels[data.status]} · ${formatOperationalDateTime(data.event.date)}` : 'Unavailable — no matching observation returned'}</dd></dl><button type="button" className="son-button son-primary" onClick={() => onNavigate(node.id)}>Open {data.label}<ArrowUpRight size={16} /></button></>}
    {data.kind === 'integration' && data.moduleId && <button type="button" className="son-button" onClick={() => onNavigate(data.moduleId)}>Open connection settings<ArrowUpRight size={16} /></button>}
    {(data.kind === 'agent' || (data.kind === 'integration' && data.agentId)) && modules.some(module => module.id === 'external_agents') && <button type="button" className="son-button" onClick={() => onNavigate('external_agents')}>Open AI Integrations<ArrowUpRight size={16} /></button>}
    </>}
    {(tab === 'connections' || tab === 'overview') && <>
    {data.kind === 'workspace' && <><button type="button" className="son-button" onClick={() => onToggle(data.workspace)}>{data.open ? 'Collapse operations' : 'Expand operations'}<ChevronRight size={16} /></button><ul className="son-module-list">{data.modules.map(module => <li key={module.id}><button type="button" onClick={() => onSelect(module.id, module.workspace)}>{module.label}<ChevronRight size={14} /></button></li>)}</ul></>}
    {data.members && <><button type="button" className="son-button" onClick={() => onToggle(data.expandKey)}>Focus connections<ChevronRight size={16} /></button><ul className="son-module-list">{data.members.map(member => <li key={member.nodeId}><button type="button" onClick={() => onSelect(member.nodeId)}>{member.label}<ChevronRight size={14} /></button></li>)}</ul></>}
    {data.kind === 'agent' && <ul className="son-module-list">{(data.moduleIds || []).map(id=><li key={id}><button type="button" onClick={()=>onSelect(id)}>{modules.find(module=>module.id===id)?.label || 'Accessible operation'}<ChevronRight size={14}/></button></li>)}</ul>}
    {tab === 'connections' && !data.members && data.kind !== 'workspace' && data.kind !== 'agent' && <p className="son-muted">{data.kind === 'module' ? 'Owning workspace: ' + data.workspace : 'See the highlighted declared relationships on the network. These are not execution events.'}</p>}
    </>}
    {tab === 'activity' && <NetworkTimeline events={related} modules={modules} onSelect={onSelect} />}
    {tab === 'execution' && <><h3>Recorded execution</h3><p className="son-muted">Step-level execution trace unavailable. The connected read models do not return ordered steps, durations or progress. No trace is simulated.</p><NetworkTimeline events={related.filter(event=>['running','pending','failed','completed'].includes(event.status))} modules={modules} onSelect={onSelect}/></>}
    <p className="son-muted">Read-only view · source permissions apply</p>
  </section>;
}
