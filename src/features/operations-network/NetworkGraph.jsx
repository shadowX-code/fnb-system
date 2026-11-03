import { Fragment, memo, useId, useLayoutEffect, useRef } from 'react';
import { BaseEdge, Handle, Position, getBezierPath } from '@xyflow/react';
import { Bot, Building2, ChevronDown, ChevronUp, Database, Factory, Layers3, Link2, Megaphone, Network, ShieldCheck, Sparkles, Users, UtensilsCrossed, Wallet, Workflow } from 'lucide-react';
import { roundedRoute } from './networkRouting.js';
import { NETWORK_DEMO_ALLOWED } from './networkEnvironment.js';
import { statusLabels } from './networkModel.js';

const workspaceIcons = { restaurant: UtensilsCrossed, factory: Factory, hr: Users, crew: ShieldCheck, finance: Wallet, marketing: Megaphone, guest_ai: Sparkles };
const icons = { platform: Network, workspace: Building2, module: Workflow, agent: Bot, data: Database, integration: Link2, 'agent-group': Bot, 'data-group': Database, 'operation-group': Layers3 };
const sides = { top: Position.Top, bottom: Position.Bottom, left: Position.Left, right: Position.Right };

export const NetworkNode = memo(function NetworkNode({ data, selected }) {
  const Icon = workspaceIcons[data.workspace] && data.kind === 'workspace' ? workspaceIcons[data.workspace] : icons[data.kind] || Network;
  const group = ['agent-group', 'data-group'].includes(data.kind);
  const toggleKey = data.kind === 'workspace' ? data.workspace : data.expandKey;
  const caption = data.kind === 'platform' ? 'Platform architecture' : data.kind === 'data' ? 'Not measured' : data.kind === 'module' && data.status === 'unknown' ? 'No telemetry' : statusLabels[data.status];
  return <article className={`son-node son-node-${data.kind}${selected ? ' son-selected' : ''}${data.related ? ' son-node-related' : ''}${data.dimmed ? ' son-node-dimmed' : ''}`} data-status={data.status} title={data.label}>
    {Object.entries(sides).map(([side, position]) => <Fragment key={side}><Handle id={`in-${side}`} type="target" position={position} isConnectable={false} /><Handle id={`out-${side}`} type="source" position={position} isConnectable={false} /></Fragment>)}
    {data.kind === 'platform' ? <>
      <div className="son-hub-body"><Network size={26} strokeWidth={1.6} aria-hidden="true" /><strong>FeedX OS</strong><p>F&B operations core</p></div>
    </> : (data.kind === 'operation-group' || group) ? <div className="son-bay-title"><Layers3 size={17} /><strong>L{data.layer + 1} · {data.label}</strong><span>{data.subtitle}</span></div> : <>
      <div className="son-node-title"><span className="son-node-icon"><Icon size={group ? 25 : 22} strokeWidth={1.6} aria-hidden="true" /></span><div><span className="son-node-layer">L{data.layer + 1}{data.kind === 'workspace' ? ' · Access allowed' : ''}</span><strong>{data.label}</strong></div></div>
      {data.kind === 'workspace' ? <div className="son-workspace-bottom"><span><span className="son-mini-layer">L3</span><b>{data.modules.length}</b> operations</span><button type="button" className="nodrag nopan" aria-label={`${data.open ? 'Collapse' : 'Expand'} ${data.label}`} aria-expanded={!!data.open} onClick={event => { event.stopPropagation(); data.onToggle(toggleKey); }}>{data.open ? 'Collapse' : 'Explore'}{data.open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button></div> : <div className="son-node-footer"><span className={group ? 'son-node-summary' : 'son-status'} data-status={data.status}>{group ? data.subtitle : <><i aria-hidden="true" />{caption}</>}</span>{group && <button type="button" className="nodrag nopan" aria-label={`${data.open ? 'Collapse' : 'Expand'} ${data.label}`} aria-expanded={!!data.open} onClick={event => { event.stopPropagation(); data.onToggle(toggleKey); }}>{data.open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>}</div>}
      {!group && data.kind !== 'workspace' && <p className="son-node-subtitle">{data.subtitle}</p>}
    </>}
  </article>;
});

export function networkEdgePath(props) {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, data } = props;
  if (data.routePoints) return roundedRoute(data.routePoints);
  return getBezierPath({ ...props, curvature: 0.32 })[0];
}

export const NetworkEdge = memo(function NetworkEdge(props) {
  const groupRef = useRef(null), previousDuration = useRef(null);
  const uid = useId().replace(/:/g, ''), path = networkEdgePath(props);
  const { kind, status, fresh, accent, dimmed } = props.data;
  const demoMotion = NETWORK_DEMO_ALLOWED && kind !== 'execution' && !!props.data.demoMotion;
  const executing = kind === 'execution' && !!props.data.eventId && !!props.data.agentId;
  const ambientMotion = kind === 'dependency' && !!props.data.ambientMotion && !demoMotion;
  const moving = ambientMotion || demoMotion || (executing && status === 'running');
  const completion = executing && status === 'completed' && fresh;
  useLayoutEffect(() => {
    if (!moving && !completion) { previousDuration.current = null; return; }
    const group=groupRef.current, length=group.querySelector('.son-edge-aura').getTotalLength();
    const duration=Math.max(.1,length/(ambientMotion ? 38 : 95)), phase=[...props.id].reduce((sum,c)=>sum+c.charCodeAt(0),0)%17/17;
    group.querySelectorAll('.son-motion-particle').forEach((particle,index)=>{
      const animation=particle.getAnimations()[0], oldDuration=previousDuration.current;
      const oldDelay=oldDuration ? -phase*oldDuration+index*.06 : 0;
      const progress=animation&&oldDuration ? (Number(animation.currentTime)/1000-oldDelay)/oldDuration : null;
      particle.style.animationDuration=`${duration}s`;
      const delay=-phase*duration+index*.06;
      particle.style.animationDelay=`${delay}s`;
      if(animation&&progress!==null) animation.currentTime=(progress*duration+delay)*1000;
    });
    previousDuration.current=duration;
  },[path,moving,completion,ambientMotion,props.id]);
  const color = executing ? ({ pending: '#f9c872', running: '#61fff0', completed: '#8df0be', failed: '#ff819c', unknown: '#8595aa', idle: '#527b91' }[status] || '#88bbc5') : accent || '#4de9dd';
  return <g ref={groupRef} data-long={props.data.longStructural || undefined} data-focused={!dimmed && props.data.focused || undefined} className={`son-edge son-edge-${kind}`} data-status={status} data-dimmed={dimmed || undefined} data-demo={demoMotion || undefined} data-ambient={ambientMotion || undefined} style={{ '--son-edge-color': color }}>
    <defs><linearGradient id={`${uid}-line`} gradientUnits="userSpaceOnUse" x1={props.sourceX} y1={props.sourceY} x2={props.targetX} y2={props.targetY}><stop stopColor={color} stopOpacity=".12" /><stop offset=".5" stopColor={color} stopOpacity=".55" /><stop offset="1" stopColor={color} stopOpacity=".8" /></linearGradient><marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={color} strokeWidth="1.5" /></marker></defs>
    <path id={`${uid}-track`} className="son-edge-aura" d={path} /><path className="son-edge-sheath" d={path} />
    <BaseEdge id={props.id} path={path} markerEnd={`url(#${uid}-arrow)`} interactionWidth={0} style={{ stroke: `url(#${uid}-line)` }} />
    {(moving || completion) && (ambientMotion ? [0] : [0, 1, 2]).map(index => <circle key={index} className={`son-motion-particle${ambientMotion ? ' son-ambient-particle' : ''}${completion && !moving ? ' son-completion-particle' : ''}`} data-motion-source={ambientMotion ? 'ambient-network' : demoMotion ? 'synthetic-demo' : 'recorded-execution'} r={ambientMotion ? 1.4 : index === 0 ? 2.6 : index === 1 ? 1.7 : 1} style={{ offsetPath: `path('${path}')`, animationDelay: `${index * 0.075}s`, opacity: ambientMotion ? .7 : 1 - index * 0.24 }} />)}
  </g>;
});

export const nodeTypes = { network: NetworkNode };
export const edgeTypes = { network: NetworkEdge };
