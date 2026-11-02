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
  if (!node) return null;
  const data = node.data;
  const related = data.kind === 'platform' ? events : events.filter(event => data.kind === 'workspace' ? event.workspaces.includes(data.workspace) : data.kind === 'agent' || data.kind === 'integration' ? event.agentId === (data.agentId || node.id.slice(6)) : event.moduleIds.includes(node.id));
  return <section className="son-detail" aria-label={`${data.label} details`}>
    <div className="son-section-heading"><h2>{data.label}</h2><button type="button" className="son-icon-button" onClick={onClose} aria-label="Close node details"><X size={17} /></button></div>
    <span className="son-status" data-status={data.status}>{statusLabels[data.status]}</span>
    <p>{data.description || (data.kind === 'module' ? 'An accessible FeedX operation. Open its page to inspect the authoritative records and available actions.' : data.kind === 'agent' ? 'Registered in AI Integrations. Connection evidence is historical and does not establish current online presence.' : 'Expand a workspace to inspect its operations.')}</p>
    {data.lastObserved && <dl><dt>Last successful request</dt><dd>{formatOperationalDateTime(data.lastObserved)}</dd></dl>}
    {data.kind === 'module' && <><dl><dt>Module telemetry</dt><dd>{data.event ? `${statusLabels[data.status]} · ${formatOperationalDateTime(data.event.date)}` : 'Unavailable — no matching observation returned'}</dd></dl><button type="button" className="son-button son-primary" onClick={() => onNavigate(node.id)}>Open {data.label}<ArrowUpRight size={16} /></button></>}
    {data.kind === 'integration' && data.moduleId && <button type="button" className="son-button" onClick={() => onNavigate(data.moduleId)}>Open connection settings<ArrowUpRight size={16} /></button>}
    {(data.kind === 'agent' || (data.kind === 'integration' && data.agentId)) && modules.some(module => module.id === 'external_agents') && <button type="button" className="son-button" onClick={() => onNavigate('external_agents')}>Open AI Integrations<ArrowUpRight size={16} /></button>}
    {data.kind === 'workspace' && <><button type="button" className="son-button" onClick={() => onToggle(data.workspace)}>{data.open ? 'Collapse operations' : 'Expand operations'}<ChevronRight size={16} /></button><ul className="son-module-list">{data.modules.map(module => <li key={module.id}><button type="button" onClick={() => onSelect(module.id, module.workspace)}>{module.label}<ChevronRight size={14} /></button></li>)}</ul></>}
    {data.kind === 'integration-group' && <><button type="button" className="son-button" onClick={() => onToggle('social-connections')}>Expand saved connections<ChevronRight size={16} /></button><ul className="son-module-list">{data.integrations.map(item => <li key={item.id}><button type="button" onClick={() => { onToggle('social-connections'); onSelect(item.id); }}>{item.label}<ChevronRight size={14} /></button></li>)}</ul></>}
    <p className="son-muted">Read-only view · source permissions apply</p>
    <NetworkTimeline events={related} modules={modules} onSelect={onSelect} />
  </section>;
}
