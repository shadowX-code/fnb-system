import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controls, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { ArrowLeft, Focus, Maximize2, Minimize2, RefreshCw, FlaskConical, Pause, Play, PanelRightOpen, PanelRightClose, Layers, Info, SlidersHorizontal } from 'lucide-react';
import PageHeader from '../../components/layout/PageHeader.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import { formatOperationalDateTime } from '../../lib/dateTime.js';
import { getAccessibleOutlets } from '../../utils/accessControl.js';
import { accessibleNetworkModules, buildNetwork, filterEvents, layers, statusLabels } from './networkModel.js';
import useNetworkEvidence from './useNetworkEvidence.js';
import { presentNetworkEdges } from './networkPresentation.js';
import useNetworkFullscreen from './useNetworkFullscreen.js';
import { edgeTypes, nodeTypes } from './NetworkGraph.jsx';
import NetworkDetailPanel, { NetworkTimeline } from './NetworkDetailPanel.jsx';
import '@xyflow/react/dist/style.css';
import './operationsNetwork.css';

const timeOptions = [{ value: 'live', label: 'Live' }, { value: '24h', label: '24H' }, { value: '7d', label: '7D' }, { value: '30d', label: '30D' }];

function NetworkExperience({ auth, ui, store }) {
  const modules = useMemo(() => accessibleNetworkModules(ui.networkRoutes, auth), [ui.networkRoutes, auth]);
  const [workspace, setWorkspace] = useState(() => globalThis.matchMedia?.('(max-width: 767px)').matches && modules.some(module => module.workspace === ui.networkWorkspace) ? ui.networkWorkspace : 'all');
  const [company, setCompany] = useState('all'), [outlet, setOutlet] = useState('all');
  const [status, setStatus] = useState('all'), [window, setWindow] = useState('live'), [search, setSearch] = useState('');
  const [information, setInformation] = useState(null);
  const [visibleNodeIds, setVisibleNodeIds] = useState([]);
  const [expanded, setExpanded] = useState(new Set()), [selectedId, setSelectedId] = useState(null);
  const [inspectorOpen, setInspectorOpen] = useState(false), [visualDemo, setVisualDemo] = useState(false), [motionPaused, setMotionPaused] = useState(false);
  const [narrow, setNarrow] = useState(() => !!globalThis.matchMedia?.('(max-width: 767px)').matches);
  const [reducedMotion, setReducedMotion] = useState(() => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const queries = [['(max-width: 767px)', setNarrow], ['(prefers-reduced-motion: reduce)', setReducedMotion]].map(([query, set]) => {
      const media = globalThis.matchMedia?.(query), update = () => set(!!media?.matches);
      media?.addEventListener('change', update); return [media, update];
    });
    return () => queries.forEach(([media, update]) => media?.removeEventListener('change', update));
  }, []);
  const [clock, setClock] = useState(Date.now());
  const rootRef = useRef(null), fitPending = useRef(true), fitRequest = useRef('primary');
  const { fullscreen, notice: fullscreenNotice, toggleFullscreen } = useNetworkFullscreen(rootRef);
  const flow = useReactFlow();
  useEffect(() => { fitPending.current = true; fitRequest.current = 'primary'; }, [narrow]);
  const evidence = useNetworkEvidence(auth, modules, window === 'live');
  useEffect(() => {
    if (!evidence.active) return;
    const timer = globalThis.setInterval(() => setClock(Date.now()), 12000);
    return () => globalThis.clearInterval(timer);
  }, [evidence.active]);
  const events = useMemo(() => filterEvents(evidence.events || [], { workspace, company, outlet, status, window }, clock), [evidence.events, workspace, company, outlet, status, window, clock]);
  const scoped = company !== 'all' || outlet !== 'all';
  const agents = scoped ? (evidence.agents || []).filter(agent => events.some(event => event.agentId === agent.id)) : evidence.agents || [];
  const integrations = scoped ? [] : evidence.integrations || [];
  const graph = useMemo(() => buildNetwork({ modules, agents, integrations, events, expanded, workspace, search, status, selectedId, now: clock, narrow }), [modules, agents, integrations, events, expanded, workspace, search, status, selectedId, clock, narrow]);
  const selectNode = useCallback((id, workspaceId) => {
    fitPending.current = false;
    const owner = workspaceId || modules.find(module => module.id === id)?.workspace;
    if (owner && !expanded.has(owner)) { fitPending.current = true; fitRequest.current = owner; }
    if (workspaceId) setExpanded(current => new Set([...current, workspaceId]));
    else { const module = modules.find(module => module.id === id); if (module) setExpanded(current => new Set([...current, module.workspace])); }
    if (id.startsWith('agent:')) setExpanded(current => new Set([...current, 'agents']));
    if (id === 'data-platform' || id.startsWith('gateway:') || id.startsWith('social:')) setExpanded(current => new Set([...current, 'data-integrations']));
    setSelectedId(id); setInspectorOpen(true);
  }, [modules, expanded]);
  const toggleWorkspace = useCallback((id) => {
    fitPending.current = true; fitRequest.current = expanded.has(id) ? 'primary' : id;
    setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else { if (!['agents', 'data-integrations', 'social-connections'].includes(id)) for (const key of next) if (!['agents', 'data-integrations', 'social-connections'].includes(key)) next.delete(key); next.add(id); } return next; });
  }, [expanded]);
  const nodes = useMemo(() => graph.nodes.map(node => ({ ...node, data: { ...node.data, onToggle: toggleWorkspace, dimmed: !!selectedId && node.id !== selectedId && !graph.edges.some(edge => (edge.source === selectedId && edge.target === node.id) || (edge.target === selectedId && edge.source === node.id)) }, domAttributes: { onKeyDown: event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key) && node.data.kind !== 'operation-group') { event.preventDefault(); selectNode(node.id); } } } })), [graph.nodes, graph.edges, selectedId, toggleWorkspace, selectNode]);
  const edges = useMemo(() => presentNetworkEdges(graph.edges, visualDemo, selectedId, visibleNodeIds), [graph.edges, visualDemo, selectedId, visibleNodeIds]);
  const layoutKey = `${narrow}:${graph.nodes.map(node => node.id).join('|')}`;
  function fitPrimary() { flow.fitView({ nodes: graph.primaryIds.map(id => ({ id })), padding: 0.08, duration: reducedMotion ? 0 : 240, maxZoom: 1.15 }); }
  useEffect(() => {
    if (!fitPending.current && (fitRequest.current !== 'primary' || selectedId)) return;
    const focus = fitRequest.current;
    let ids = graph.primaryIds;
    if (focus !== 'primary') {
      const members = graph.nodes.filter(node => focus === 'agents' ? node.data.kind === 'agent' : ['data-integrations', 'social-connections'].includes(focus) ? ['data', 'integration'].includes(node.data.kind) : node.data.kind === 'module' && node.data.workspace === focus);
      if (members.length) ids = members.slice(0, 8).map(node => node.id);
    }
    const frame = requestAnimationFrame(() => { flow.fitView({ nodes: ids.map(id => ({ id })), padding: 0.12, duration: reducedMotion ? 0 : 240, maxZoom: 1.15 }); fitPending.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [layoutKey, flow]);
  const selected = graph.nodes.find(node => node.id === selectedId);
  const availableWorkspaces = [...new Map(modules.map(module => [module.workspace, module.workspace === 'hr' ? 'HR' : module.workspace === 'guest_ai' ? 'Guest AI' : module.workspace[0].toUpperCase() + module.workspace.slice(1)])).entries()];
  const failures = (evidence.sources || []).filter(source => source.state === 'unavailable');
  const canObserve = modules.some(module => module.id === 'external_agents');
  const agentSourceAvailable = evidence.sources?.some(source => source.name === 'AI Integrations' && source.state === 'available');
  const changeFilter = setter => value => { setter(value); setSelectedId(null); fitPending.current = true; fitRequest.current = 'primary'; };
  const activeFilters = [workspace !== 'all' && (availableWorkspaces.find(([id])=>id===workspace)?.[1] || 'Workspace scoped'), company !== 'all' && (evidence.companies?.find(row=>row.id===company)?.name || 'Company scoped'), outlet !== 'all' && (store.outlets?.find(row=>row.id===outlet)?.name || 'Outlet scoped'), status !== 'all' && statusLabels[status], search && `“${search}”`].filter(Boolean);
  function resetFilters() { setWorkspace('all'); setCompany('all'); setOutlet('all'); setStatus('all'); setSearch(''); setSelectedId(null); fitPending.current = true; fitRequest.current = 'primary'; }
  return <div ref={rootRef} className={`son-experience${evidence.active ? '' : ' son-inactive'}${fullscreen ? ' son-fullscreen' : ''}${visualDemo ? ' son-demo-active' : ''}${motionPaused ? ' son-motion-paused' : ''}`}>
    <header className="son-admin-header">
      <div className="son-admin-title"><button type="button" className="icon-btn" title="Back to Workspace" aria-label="Back to Workspace" onClick={ui.returnFromNetwork}><ArrowLeft size={18}/></button><PageHeader title="Smart Operations Network" wrapTitle actions={<span className="son-polling" role="status" title={evidence.observedAt ? `Checked ${formatOperationalDateTime(evidence.observedAt)}` : 'Checking available sources…'}>{window === 'live' ? evidence.active ? 'Auto-refresh · 30s' : 'Auto-refresh paused' : 'Snapshot · manual refresh'}</span>}/></div>
      <div className="son-header-controls">
    <details className="son-filters" onKeyDown={event=>{if(event.key==='Escape' && !event.defaultPrevented){event.preventDefault();event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}}><summary className="btn-secondary"><SlidersHorizontal size={14}/>Filters & search{activeFilters.length>0 && <span className="son-filter-count">{activeFilters.length}</span>}</summary><div className="son-filter-bar" aria-label="Network filters">
      <SelectField label="Workspace" value={workspace} onChange={changeFilter(setWorkspace)} options={[{ value: 'all', label: 'All accessible workspaces' }, ...availableWorkspaces.map(([value, label]) => ({ value, label }))]} />
      <SelectField label="Company" value={company} onChange={changeFilter(setCompany)} disabled={!evidence.companies?.length} options={[{ value: 'all', label: evidence.companies?.length ? 'All accessible companies' : 'Company scope unavailable' }, ...(evidence.companies || []).map(row => ({ value: row.id, label: row.name }))]} searchable="auto" />
      <SelectField label="Outlet" value={outlet} onChange={changeFilter(setOutlet)} options={[{ value: 'all', label: 'All accessible outlets' }, ...getAccessibleOutlets(auth, store.outlets || []).map(row => ({ value: row.id, label: row.name }))]} searchable="auto" />
      <SelectField label="Status" value={status} onChange={changeFilter(setStatus)} options={[{ value: 'all', label: 'All statuses' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} />
      <AdminSearchField label="Search nodes" value={search} onChange={changeFilter(setSearch)} placeholder="Module, workspace or agent…" />
      <button type="button" className="btn-secondary son-reset-filters" disabled={!activeFilters.length} onClick={resetFilters}>Reset filters</button>
    </div>
    </details>
        <div className="son-header-counts" aria-label="Scoped network counts"><span><strong>{graph.groups.length}</strong> Workspaces</span><span><strong>{graph.matching.length}</strong> Modules</span><span><strong>{agentSourceAvailable ? graph.visibleAgents.length : '—'}</strong> Agents</span></div>
        <AdminSegmentedControl label="Activity time range" value={window} onChange={setWindow} options={timeOptions}/>
      </div>
      {activeFilters.length>0 && <div className="son-active-scope" aria-label="Active filters">{activeFilters.join(' · ')}</div>}
    </header>
    {(evidence.error || failures.length > 0) && <div className="son-notice" role="alert">{evidence.error || `Some evidence could not be checked: ${failures.map(source => source.name).join(', ')}.`}<button type="button" onClick={evidence.refresh}>Retry sources</button></div>}
    {scoped && <p className="son-scope-note">Activity is limited to recorded {company !== 'all' ? 'company' : 'outlet'} attribution. Unattributed activity and agents are excluded; module architecture remains visible.</p>}
    <div className={`son-workbench${inspectorOpen ? ' son-inspector-open' : ''}`}>
      <section className="son-map-section" aria-label="Operations network canvas">
        {fullscreenNotice && <p className="son-scope-note" role="status">{fullscreenNotice}</p>}
        <div className="son-canvas">
        <div className="son-map-toolbar" role="group" aria-label="Canvas controls">
          <div className="son-canvas-actions">
            <button type="button" className="son-demo-toggle" aria-label="Visual Demo" title="Visual Demo: synthetic directional motion only; recorded evidence is unchanged" aria-pressed={visualDemo} onClick={() => setVisualDemo(value => !value)}><FlaskConical size={16} />{visualDemo ? 'Demo · Synthetic' : 'Demo'}</button>
            <button type="button" className="son-icon-button" title={motionPaused ? 'Resume motion' : 'Pause motion'} aria-label={motionPaused ? 'Resume motion' : 'Pause motion'} aria-pressed={motionPaused} onClick={() => setMotionPaused(value => !value)}>{motionPaused ? <Play size={16} /> : <Pause size={16} />}</button>
            <button type="button" className="son-icon-button" title="Refresh evidence" aria-label="Refresh evidence" disabled={evidence.loading} onClick={evidence.refresh}><RefreshCw size={16} /></button>
            <button type="button" className="son-icon-button" title="Fit network to view" aria-label="Fit network to view" onClick={fitPrimary}><Focus size={16} /></button>
            <button type="button" className="son-icon-button" title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
            <button type="button" className="son-activity-toggle" aria-label="Activity" title="Recorded activity and node details" aria-expanded={inspectorOpen} aria-controls="son-inspector" onClick={() => { fitPending.current = true; fitRequest.current = 'primary'; setInspectorOpen(value => !value); }}>{inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}<span>Activity</span></button>
          </div>
        </div>


          <ReactFlow onMoveEnd={(_, viewport) => {
            const bounds = rootRef.current?.querySelector('.son-canvas')?.getBoundingClientRect();
            if (!bounds) return;
            const ids = graph.nodes.filter(node => node.position.x * viewport.zoom + viewport.x < bounds.width && (node.position.x + node.width) * viewport.zoom + viewport.x > 0 && node.position.y * viewport.zoom + viewport.y < bounds.height && (node.position.y + node.height) * viewport.zoom + viewport.y > 0).map(node => node.id);
            setVisibleNodeIds(current => JSON.stringify(current) === JSON.stringify(ids) ? current : ids);
          }} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} colorMode="dark" fitView fitViewOptions={{ padding: 0.08, maxZoom: 1.15, nodes: graph.primaryIds.map(id => ({ id })) }} minZoom={0.15} maxZoom={1.8} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} deleteKeyCode={null} onNodeClick={(_, node) => { if (node.data.kind !== 'operation-group') selectNode(node.id); }} onPaneClick={() => setSelectedId(null)} aria-label="FeedX operations network">
            <Controls showInteractive={false} showFitView={false} />
          </ReactFlow>
          <div className="son-canvas-mode" role="status">{[visualDemo && 'Synthetic motion · recorded evidence unchanged', reducedMotion ? 'Reduced motion' : motionPaused ? 'Motion paused' : !evidence.active ? 'Motion paused while inactive' : ''].filter(Boolean).join(' · ')}</div>
          {evidence.loading && <div className="son-canvas-state" role="status">Checking source evidence…</div>}
          {!graph.matching.length && <div className="son-canvas-state">No modules match this view. Change the filters or search.</div>}
        </div>
        <footer className="son-information-bar"><div className="son-semantics" aria-label="Connection semantics"><span><i className="son-structural-swatch"/>Structural</span><span><i className="son-authorization-swatch"/>Authorization</span><span><i className="son-recorded-swatch"/>Recorded Execution</span></div><span className="son-pan-hint">Drag to pan · scroll to zoom</span><div className="son-information-actions"><button type="button" onClick={()=>setInformation('layers')} aria-haspopup="dialog"><Layers size={14}/>Layers</button><button type="button" onClick={()=>setInformation('coverage')} aria-haspopup="dialog"><Info size={14}/>Data Coverage</button></div></footer>
      </section>
      {inspectorOpen && <aside id="son-inspector" className="son-inspector" aria-label="Network inspector">{selected ? <NetworkDetailPanel key={selected.id} node={selected} modules={modules} events={events} onClose={() => setSelectedId(null)} onNavigate={ui.navigate} onToggle={toggleWorkspace} onSelect={selectNode} /> : evidence.loading ? <p role="status">Checking recorded activity…</p> : <NetworkTimeline events={events} modules={modules} onSelect={selectNode} />}</aside>}
    </div>
    <Drawer open={!!information} width="sm" title={information==='layers' ? 'Network layers' : 'Data Coverage'} onClose={()=>setInformation(null)}>
      {information==='layers' ? <ol className="son-layer-explanations">{layers.map((layer,index)=><li key={layer}><strong>L{index+1}</strong><span>{layer}</span></li>)}</ol> : <div className="son-coverage-content"><p>Last evidence check: {evidence.observedAt ? formatOperationalDateTime(evidence.observedAt) : 'Not available yet'}.</p><p>System health & throughput: unavailable. Uptime, success rates and universal execution totals are not measured by this view.</p><p>{canObserve ? 'AI Integrations: latest 50 access events, 50 configuration events and 50 completed receipts per agent, plus saved open requests. Live includes current open requests and the latest 24 hours. Time ranges filter returned activity; they are not complete historical totals.' : 'Agent telemetry requires existing AI Integrations view authority.'}</p><p>Connections show the latest saved snapshot. Brand social connections include last sync where accessible. Module availability reflects your permissions. Uptime, general automation runs and cross-module business timelines are not connected here. Visual Demo is synthetic presentation only.</p></div>}
    </Drawer>
  </div>;
}

export default function OperationsNetworkPage(props) {
  return <ReactFlowProvider><NetworkExperience {...props} /></ReactFlowProvider>;
}
