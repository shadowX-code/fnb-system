import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { ArrowLeft, Activity, Bot, Focus, Maximize2, Minimize2, Network, RefreshCw } from 'lucide-react';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import { formatOperationalDateTime } from '../../lib/dateTime.js';
import { getAccessibleOutlets } from '../../utils/accessControl.js';
import { accessibleNetworkModules, buildNetwork, filterEvents, layers, statusLabels } from './networkModel.js';
import useNetworkEvidence from './useNetworkEvidence.js';
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
  const [expanded, setExpanded] = useState(new Set()), [selectedId, setSelectedId] = useState(null);
  const [fullscreen, setFullscreen] = useState(false), [fullscreenError, setFullscreenError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const rootRef = useRef(null), fitPending = useRef(true);
  const flow = useReactFlow();
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
  const graph = useMemo(() => buildNetwork({ modules, agents, integrations, events, expanded, workspace, search, status, selectedId, now: clock }), [modules, agents, integrations, events, expanded, workspace, search, status, selectedId, clock]);
  function toggleWorkspace(id) { fitPending.current = true; setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  const nodes = graph.nodes.map(node => ({ ...node, data: { ...node.data, onToggle: toggleWorkspace } }));
  const layoutKey = graph.nodes.map(node => node.id).join('|');
  useEffect(() => {
    if (!fitPending.current) return;
    const frame = requestAnimationFrame(() => { flow.fitView({ padding: 0.15, duration: 0, maxZoom: 1 }); fitPending.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [layoutKey, flow]);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  async function toggleFullscreen() {
    setFullscreenError('');
    try { if (fullscreen) await document.exitFullscreen(); else await rootRef.current.requestFullscreen(); }
    catch { setFullscreenError('Fullscreen is unavailable in this browser. Zoom and fit-to-view remain available.'); }
  }
  function selectNode(id, workspaceId) {
    if (workspaceId) setExpanded(current => new Set([...current, workspaceId]));
    else { const module = modules.find(module => module.id === id); if (module) setExpanded(current => new Set([...current, module.workspace])); }
    setSelectedId(id);
  }
  useEffect(() => {
    if (!selectedId || !graph.nodes.some(node => node.id === selectedId)) return;
    const frame = requestAnimationFrame(() => flow.fitView({ nodes: [{ id: selectedId }], padding: 0.7, maxZoom: 1, duration: 0 }));
    return () => cancelAnimationFrame(frame);
  }, [selectedId, layoutKey, flow]);
  const selected = graph.nodes.find(node => node.id === selectedId);
  const availableWorkspaces = [...new Map(modules.map(module => [module.workspace, module.workspace === 'hr' ? 'HR' : module.workspace === 'guest_ai' ? 'Guest AI' : module.workspace[0].toUpperCase() + module.workspace.slice(1)])).entries()];
  const failures = (evidence.sources || []).filter(source => source.state === 'unavailable');
  const canObserve = modules.some(module => module.id === 'external_agents');
  const agentSourceAvailable = evidence.sources?.some(source => source.name === 'AI Integrations' && source.state === 'available');
  const changeFilter = setter => value => { setter(value); setSelectedId(null); fitPending.current = true; };
  return <div ref={rootRef} className={`son-experience${evidence.active ? '' : ' son-inactive'}`}>
    <header className="son-page-header">
      <div><button type="button" className="son-return" onClick={ui.returnFromNetwork}><ArrowLeft size={15} />Return to workspace</button><h1>Smart Operations Network</h1><p>Explore how FeedX connects. Inspect the evidence behind each operation.</p></div>
      <div className="son-refresh-state"><span className="son-status" data-status={window === 'live' && evidence.active ? 'observed' : 'idle'}>{window === 'live' ? evidence.active ? 'Live · 30s polling' : 'Live paused' : 'History snapshot'}</span><span>{evidence.observedAt ? `Checked ${formatOperationalDateTime(evidence.observedAt)}` : 'Checking available sources…'}</span></div>
    </header>
    <div className="son-filter-bar" aria-label="Network filters">
      <SelectField label="Workspace" value={workspace} onChange={changeFilter(setWorkspace)} options={[{ value: 'all', label: 'All accessible workspaces' }, ...availableWorkspaces.map(([value, label]) => ({ value, label }))]} />
      <SelectField label="Company" value={company} onChange={changeFilter(setCompany)} disabled={!evidence.companies?.length} options={[{ value: 'all', label: evidence.companies?.length ? 'All accessible companies' : 'Company scope unavailable' }, ...(evidence.companies || []).map(row => ({ value: row.id, label: row.name }))]} searchable="auto" />
      <SelectField label="Outlet" value={outlet} onChange={changeFilter(setOutlet)} options={[{ value: 'all', label: 'All accessible outlets' }, ...getAccessibleOutlets(auth, store.outlets || []).map(row => ({ value: row.id, label: row.name }))]} searchable="auto" />
      <SelectField label="Status" value={status} onChange={changeFilter(setStatus)} options={[{ value: 'all', label: 'All statuses' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} />
      <AdminSearchField label="Search nodes" value={search} onChange={changeFilter(setSearch)} placeholder="Module, workspace or agent…" />
    </div>
    <div className="son-observation-strip">
      <span><Network size={17} /><strong>{graph.groups.length}</strong> matching workspaces</span><span><Activity size={17} /><strong>{graph.matching.length}</strong> matching modules</span><span><Bot size={17} /><strong>{agentSourceAvailable ? graph.visibleAgents.length : '—'}</strong> matching agents</span>
      <span className="son-muted">System health & throughput: unavailable</span>
    </div>
    {(evidence.error || failures.length > 0) && <div className="son-notice" role="alert">{evidence.error || `Some evidence could not be checked: ${failures.map(source => source.name).join(', ')}.`}<button type="button" onClick={evidence.refresh}>Retry sources</button></div>}
    {scoped && <p className="son-scope-note">Activity is limited to recorded {company !== 'all' ? 'company' : 'outlet'} attribution. Unattributed activity and agents are excluded; module architecture remains visible.</p>}
    <div className="son-workbench">
      <section className="son-map-section" aria-label="Operations network canvas">
        <div className="son-map-toolbar"><div role="group" aria-label="Activity time range">{timeOptions.map(option => <button type="button" key={option.value} aria-pressed={window === option.value} onClick={() => setWindow(option.value)}>{option.label}</button>)}</div>
          <div><button type="button" className="son-icon-button" aria-label="Refresh evidence" disabled={evidence.loading} onClick={evidence.refresh}><RefreshCw size={16} /></button><button type="button" className="son-icon-button" aria-label="Fit network to view" onClick={() => flow.fitView({ padding: 0.15, duration: 0, maxZoom: 1 })}><Focus size={17} /></button><button type="button" className="son-icon-button" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button></div>
        </div>
        {fullscreenError && <p className="son-notice" role="status">{fullscreenError}</p>}
        <div className="son-canvas">
          <ReactFlow nodes={nodes} edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} colorMode="dark" fitView fitViewOptions={{ padding: 0.15, maxZoom: 1 }} minZoom={0.05} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} deleteKeyCode={null} onlyRenderVisibleElements onNodeClick={(_, node) => { if (node.data.kind === 'collapsed') toggleWorkspace(node.data.workspace); else setSelectedId(node.id); }} onPaneClick={() => setSelectedId(null)} aria-label="FeedX operations network">
            <svg><defs><marker id="son-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#609fba" /></marker></defs></svg>
            <Background color="#183a4c" gap={28} size={1} /><Controls showInteractive={false} />
          </ReactFlow>
          {evidence.loading && <div className="son-canvas-state" role="status">Checking source evidence…</div>}
          {!graph.matching.length && <div className="son-canvas-state">No modules match this view. Change the filters or search.</div>}
        </div>
        <div className="son-layer-key" aria-label="Network layers">{layers.map((layer, index) => <span key={layer}><b>L{index + 1}</b>{layer}</span>)}</div>
        <footer className="son-map-legend"><span><i className="son-dependency-line" />Declared dependency</span><span><i className="son-execution-line" />Recorded execution</span><span>Drag to pan · scroll to zoom · select a node to inspect</span></footer>
        <div className="son-source-note"><strong>Evidence coverage</strong><p>{canObserve ? 'AI Integrations: latest 50 access events, 50 configuration events and 50 completed receipts per agent, plus saved open requests. Live includes current open requests and the latest 24 hours. Time ranges filter returned activity; they are not complete historical totals.' : 'Agent telemetry requires existing AI Integrations view authority.'}</p><p>Connections always show the latest saved snapshot. Brand social connections include last sync where accessible. Current module availability reflects your permissions. Uptime, general automation runs and cross-module business timelines are not connected here. Open the owning module for its authoritative evidence.</p></div>
      </section>
      <aside className="son-inspector" aria-label="Network inspector">{selected ? <NetworkDetailPanel node={selected} modules={modules} events={events} onClose={() => setSelectedId(null)} onNavigate={ui.navigate} onToggle={toggleWorkspace} onSelect={selectNode} /> : evidence.loading ? <p role="status">Checking recorded activity…</p> : <NetworkTimeline events={events} modules={modules} onSelect={selectNode} />}</aside>
    </div>
  </div>;
}

export default function OperationsNetworkPage(props) {
  return <ReactFlowProvider><NetworkExperience {...props} /></ReactFlowProvider>;
}
