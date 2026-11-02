import { Fragment, memo, useId } from 'react';
import { BaseEdge, Handle, Position, getBezierPath } from '@xyflow/react';
import { Bot, Building2, ChevronDown, ChevronUp, Database, Factory, Layers3, Link2, Megaphone, Network, ShieldCheck, Sparkles, Users, UtensilsCrossed, Wallet, Workflow } from 'lucide-react';
import { statusLabels } from './networkModel.js';

const workspaceIcons = { restaurant: UtensilsCrossed, factory: Factory, hr: Users, crew: ShieldCheck, finance: Wallet, marketing: Megaphone, guest_ai: Sparkles };
const icons = { platform: Network, workspace: Building2, module: Workflow, agent: Bot, data: Database, integration: Link2, 'agent-group': Bot, 'data-group': Database, 'operation-group': Layers3 };
const sides = { top: Position.Top, bottom: Position.Bottom, left: Position.Left, right: Position.Right };

export const NetworkNode = memo(function NetworkNode({ data, selected }) {
  const Icon = workspaceIcons[data.workspace] && data.kind === 'workspace' ? workspaceIcons[data.workspace] : icons[data.kind] || Network;
  const group = ['agent-group', 'data-group'].includes(data.kind);
  const toggleKey = data.kind === 'workspace' ? data.workspace : data.expandKey;
  const caption = data.kind === 'platform' ? 'Platform architecture' : data.kind === 'data' ? 'Not measured' : data.kind === 'module' && data.status === 'unknown' ? 'No telemetry' : statusLabels[data.status];
  return <article className={`son-node son-node-${data.kind}${selected ? ' son-selected' : ''}`} data-status={data.status}>
    {Object.entries(sides).map(([side, position]) => <Fragment key={side}><Handle id={`in-${side}`} type="target" position={position} isConnectable={false} /><Handle id={`out-${side}`} type="source" position={position} isConnectable={false} /></Fragment>)}
    {data.kind === 'platform' ? <>
      <div className="son-hub-orbit son-hub-orbit-outer" aria-hidden="true" /><div className="son-hub-orbit" aria-hidden="true" />
      <div className="son-hub-body"><Network size={35} strokeWidth={1.6} aria-hidden="true" /><strong>FeedX OS</strong><p>{data.subtitle}</p><span>L1 · {caption}</span></div>
      <div className="son-hub-base" aria-hidden="true" />
    </> : data.kind === 'operation-group' ? <div className="son-bay-title"><Layers3 size={17} /><strong>{data.label}</strong><span>L3 · {data.subtitle}</span></div> : <>
      <div className="son-node-title"><span className="son-node-icon"><Icon size={group ? 25 : 22} strokeWidth={1.6} aria-hidden="true" /></span><div><span className="son-node-layer">L{data.layer + 1}{group ? ' · ' + (data.kind === 'agent-group' ? 'Intelligence' : 'Foundation') : ''}</span><strong>{data.label}</strong></div></div>
      {data.kind === 'workspace' ? <div className="son-workspace-bottom"><span><span className="son-mini-layer">L3</span><b>{data.modules.length}</b> operations</span><button type="button" className="nodrag nopan" aria-label={`${data.open ? 'Collapse' : 'Expand'} ${data.label}`} aria-expanded={!!data.open} onClick={event => { event.stopPropagation(); data.onToggle(toggleKey); }}>{data.open ? 'Collapse' : 'Explore'}{data.open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button></div> : <div className="son-node-footer"><span className={group ? 'son-node-summary' : 'son-status'} data-status={data.status}>{group ? data.subtitle : <><i aria-hidden="true" />{caption}</>}</span>{group && <button type="button" className="nodrag nopan" aria-label={`${data.open ? 'Collapse' : 'Expand'} ${data.label}`} aria-expanded={!!data.open} onClick={event => { event.stopPropagation(); data.onToggle(toggleKey); }}>{data.open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>}</div>}
      {!group && data.kind !== 'workspace' && <p className="son-node-subtitle">{data.subtitle}</p>}
    </>}
  </article>;
});

export function networkEdgePath(props) {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, data } = props;
  if (data.routing === 'module') {
    const laneX = tx - 14, lineY = sy + 18, r = 8;
    return `M ${sx} ${sy} L ${sx} ${lineY} L ${laneX + r} ${lineY} Q ${laneX} ${lineY} ${laneX} ${lineY + r} L ${laneX} ${ty - r} Q ${laneX} ${ty} ${laneX + r} ${ty} L ${tx} ${ty}`;
  }
  if (data.routing?.startsWith('outer')) {
    const x = data.outerX, turn = x < tx ? 16 : -16, entry = ty - data.entryGap;
    const departure = ['top', 'bottom'].includes(data.startMode) ? data.departureY : sy;
    const direction = entry >= departure ? 1 : -1, bend = Math.min(16, Math.abs(entry - departure) / 3);
    const start = ['left', 'right'].includes(data.startMode)
      ? `M ${sx} ${sy} C ${sx + (x < sx ? -45 : 45)} ${sy} ${x} ${sy} ${x} ${sy + direction * bend}`
      : `M ${sx} ${sy} L ${sx} ${departure} L ${x + turn} ${departure} Q ${x} ${departure} ${x} ${departure + direction * bend}`;
    return `${start} L ${x} ${entry - direction * bend} Q ${x} ${entry} ${x + turn} ${entry} L ${tx - turn} ${entry} Q ${tx} ${entry} ${tx} ${ty}`;
  }
  return getBezierPath({ ...props, curvature: 0.32 })[0];
}

export const NetworkEdge = memo(function NetworkEdge(props) {
  const uid = useId().replace(/:/g, ''), path = networkEdgePath(props);
  const { kind, status, fresh, demoMotion, accent, dimmed } = props.data;
  const executing = kind === 'execution';
  const moving = demoMotion || (executing && status === 'running');
  const completion = executing && status === 'completed' && fresh;
  const color = executing ? ({ pending: '#f9c872', running: '#61fff0', completed: '#8df0be', failed: '#ff819c', unknown: '#8595aa', idle: '#527b91' }[status] || '#88bbc5') : accent || '#4de9dd';
  return <g className={`son-edge son-edge-${kind}`} data-status={status} data-dimmed={dimmed || undefined} data-demo={demoMotion || undefined} style={{ '--son-edge-color': color }}>
    <defs><linearGradient id={`${uid}-line`}><stop stopColor={color} stopOpacity=".35" /><stop offset=".5" stopColor={color} stopOpacity=".95" /><stop offset="1" stopColor={color} stopOpacity=".6" /></linearGradient><marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={color} strokeWidth="1.5" /></marker></defs>
    <path id={`${uid}-track`} className="son-edge-aura" d={path} /><path className="son-edge-sheath" d={path} />
    <BaseEdge id={props.id} path={path} markerEnd={`url(#${uid}-arrow)`} interactionWidth={0} style={{ stroke: `url(#${uid}-line)` }} />
    {(demoMotion || executing) && <text className="son-edge-label" dy="-9"><textPath href={`#${uid}-track`} startOffset="50%" textAnchor="middle">{demoMotion ? 'Demo flow' : statusLabels[status]}</textPath></text>}
    {(moving || completion) && [0, 1, 2].map(index => <circle key={index} className={`son-motion-particle${completion && !moving ? ' son-completion-particle' : ''}`} data-motion-source={demoMotion ? 'synthetic-demo' : 'recorded-execution'} r={index === 0 ? 4 : index === 1 ? 2.8 : 1.7} style={{ offsetPath: `path('${path}')`, animationDelay: `${index * 0.075}s`, opacity: 1 - index * 0.24 }} />)}
  </g>;
});

export const nodeTypes = { network: NetworkNode };
export const edgeTypes = { network: NetworkEdge };
