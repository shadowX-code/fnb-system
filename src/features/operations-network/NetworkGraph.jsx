import { memo } from 'react';
import { BaseEdge, Handle, Position, getBezierPath } from '@xyflow/react';
import { Bot, Building2, ChevronDown, ChevronUp, Database, Layers3, Link2, Network, Workflow } from 'lucide-react';
import { statusLabels } from './networkModel.js';

const icons = { platform: Network, workspace: Building2, module: Workflow, agent: Bot, data: Database, integration: Link2, collapsed: Layers3, gap: Bot };
export const NetworkNode = memo(function NetworkNode({ data, selected }) {
  const Icon = icons[data.kind] || Network;
  return <article className={`son-node son-node-${data.kind}${selected ? ' son-selected' : ''}`} data-status={data.status}>
    <Handle type="target" position={Position.Top} isConnectable={false} />
    <div className="son-node-title"><Icon size={data.kind === 'platform' ? 30 : 20} aria-hidden="true" /><strong>{data.label}</strong></div>
    <p>{data.subtitle}</p>
    <div className="son-node-footer"><span className="son-status" data-status={data.status}><i aria-hidden="true" />{data.kind === 'module' && data.status === 'unknown' ? 'No telemetry' : statusLabels[data.status]}</span>
      {(data.kind === 'workspace' || data.kind === 'collapsed') && <button type="button" className="nodrag nopan" aria-label={`${data.open ? 'Collapse' : 'Expand'} ${data.label}`} aria-expanded={!!data.open} onClick={event => { event.stopPropagation(); data.onToggle(data.workspace); }}>{data.open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>}
    </div>
    <Handle type="source" position={Position.Bottom} isConnectable={false} />
  </article>;
});

export const NetworkEdge = memo(function NetworkEdge(props) {
  const [path] = getBezierPath(props);
  const { kind, status, fresh } = props.data;
  const moving = kind === 'execution' && status === 'running';
  return <g className={`son-edge son-edge-${kind}`} data-status={status}>
    <BaseEdge id={props.id} path={path} markerEnd="url(#son-arrow)" interactionWidth={0} />
    {(moving || (status === 'completed' && fresh)) && <path className={moving ? 'son-flow-particle' : 'son-success-pulse'} d={path} pathLength="100" />}
  </g>;
});

export const nodeTypes = { network: NetworkNode };
export const edgeTypes = { network: NetworkEdge };
