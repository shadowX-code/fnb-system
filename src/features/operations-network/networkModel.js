import { layoutNetworkNodes, workspaceAccents } from './networkPresentation.js';
import { moduleRegistry, moduleWorkspace, workspaceSwitcherOptions } from '../../../config/modules.ts';
import { canonicalRouteId, getAdminRouteDefinition } from '../../app/routeOwnership.js';

export const statusLabels = {
  running: 'Running', completed: 'Completed', pending: 'Pending', failed: 'Failed',
  idle: 'Idle', unknown: 'Unavailable', observed: 'Observed', available: 'Available',
};
export const layers = ['Platform core', 'Workspaces', 'Operations', 'Agents & automation', 'Data & integrations'];

export function permissionAllowed(auth, expression) {
  return !expression || expression.split(' OR ').some(clause => clause.split(' AND ').every(code => auth.hasPermission(code.trim())));
}

// Route composition supplies permissions, including compound and compatibility grants.
export function accessibleNetworkModules(routes, auth) {
  const routeById = new Map(routes.map(route => [route.id, route]));
  return moduleRegistry.filter(module => {
    const route = routeById.get(module.id);
    const workspace = workspaceSwitcherOptions.find(option => option.id === moduleWorkspace(module));
    return !['operations_network', 'ai_assistant'].includes(module.id) && module.routable !== false
      && canonicalRouteId(module.id) === module.id && route && permissionAllowed(auth, route.permission)
      && permissionAllowed(auth, workspace?.permission);
  }).map(module => ({
    id: module.id, label: module.label, workspace: moduleWorkspace(module),
    section: module.section, description: routeById.get(module.id).description,
    implemented: routeById.get(module.id).component?.name !== 'ModulePlaceholderPage',
    route: getAdminRouteDefinition(module.id)?.canonicalPath,
  }));
}

export function eventStatus(state) {
  if (state === 'committed') return 'completed';
  if (['failed', 'denied', 'needs_resolution', 'expired'].includes(state)) return 'failed';
  if (['pending_approval', 'awaiting_execution'].includes(state)) return 'pending';
  if (state === 'running') return 'running';
  if (['read', 'configuration_changed'].includes(state)) return 'observed';
  return 'unknown';
}

export function filterEvents(events, { workspace = 'all', company = 'all', outlet = 'all', status = 'all', window = 'live' }, now = Date.now()) {
  const hours = { live: 24, '24h': 24, '7d': 168, '30d': 720 }[window];
  return events.filter(event => {
    const date = Date.parse(event.date);
    return Number.isFinite(date) && date <= now && ((window === 'live' && event.current) || date >= now - hours * 3600000)
      && (workspace === 'all' || event.workspaces.includes(workspace))
      && (company === 'all' || event.companyId === company)
      && (outlet === 'all' || event.outletId === outlet)
      && (status === 'all' || event.status === status);
  }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id));
}

export function buildNetwork({ modules, agents = [], integrations = [], events = [], expanded = new Set(), workspace = 'all', search = '', status = 'all', selectedId, now = Date.now(), narrow = false }) {
  const query = search.trim().toLowerCase();
  const latest = id => events.find(event => event.moduleIds.includes(id));
  const matching = modules.filter(module => (workspace === 'all' || module.workspace === workspace)
    && (!query || `${module.label} ${module.section} ${module.workspace}`.toLowerCase().includes(query))
    && (status === 'all' || (latest(module.id)?.status ?? 'unknown') === status));
  const groups = workspaceSwitcherOptions.map(option => ({ ...option, modules: matching.filter(module => module.workspace === option.id) })).filter(option => option.modules.length);
  const visibleAgents = agents.filter(agent => (workspace === 'all' || agent.workspaces.includes(workspace))
    && (!query || agent.name.toLowerCase().includes(query) || matching.some(module => agent.moduleIds.includes(module.id)))
    && (status === 'all' || agent.status === status));
  const visibleIntegrations = integrations.filter(item => (workspace === 'all' || item.workspace === workspace)
    && (status === 'all' || item.status === status) && (!query || `${item.label} ${item.subtitle}`.toLowerCase().includes(query)));
  const nodes = [], edges = [];
  const add = (id, layer, data) => nodes.push({ id, type: 'network', position: { x: 0, y: 0 }, selected: id === selectedId,
    ariaLabel: `${data.label}: ${data.subtitle || statusLabels[data.status]}`, data: { layer, ...data }, draggable: false });
  const connect = (source, target, kind = 'dependency', event, routing = 'curve') => edges.push({
    id: `${kind}:${source}:${target}${event ? `:${event.agentId}:${event.id}` : ''}`, source, target, type: 'network',
    data: { kind, routing, agentId: event?.agentId, eventId: event?.id, status: event?.status ?? 'idle', date: event?.date, fresh: !!event && now - Date.parse(event.date) < 12000,
      accent: workspaceAccents[nodes.find(node => node.id === target)?.data.workspace] || '#4de9dd' },
  });
  add('platform', 0, { label: 'FeedX OS', subtitle: 'F&B operations core', status: 'available', kind: 'platform', description: 'Platform architecture. Availability describes your access, not a system health check.' });
  const openWorkspace = groups.find(group => expanded.has(group.id))?.id || ((query || status !== 'all') ? groups[0]?.id : null);
  for (const group of groups) {
    const id = `workspace:${group.id}`, open = group.id === openWorkspace;
    add(id, 1, { label: group.label, subtitle: group.detail, status: 'available', kind: 'workspace', workspace: group.id, open, modules: group.modules, description: group.detail });
    connect('platform', id, 'dependency', null, 'hub');
    if (!open) continue;
    const sectionId = `operations:${group.id}`;
    add(sectionId, 2, { label: `${group.label} operations`, subtitle: `${group.modules.length} accessible modules`, kind: 'operation-group', workspace: group.id, status: 'available' });
    connect(id, sectionId, 'dependency', null, 'outer');
    for (const module of group.modules) {
      const event = latest(module.id);
      add(module.id, 2, { ...module, kind: 'module', subtitle: module.section, status: event?.status ?? 'unknown', event });
      connect(sectionId, module.id, 'dependency', null, 'module');
    }
  }
  const agentMembers = visibleAgents.map(agent => ({ ...agent, nodeId: `agent:${agent.id}`, label: agent.name, subtitle: agent.connectionLabel, kind: 'agent', layer: 3 }));
  add('automation-group', 3, { label: 'Agents & Automation', subtitle: visibleAgents.length ? `${visibleAgents.length} registered agents in view` : 'No matching agent evidence', kind: 'agent-group', status: 'unknown', members: agentMembers, open: true, expandKey: 'agents', description: 'Registered identities and their existing evidence. Connection observations do not establish current online presence.' });
  for (const member of agentMembers) {
    add(member.nodeId, 3, member);

  }
  for (const group of groups.filter(group => visibleAgents.some(agent => agent.workspaces.includes(group.id)))) for (const agent of visibleAgents.filter(agent => agent.workspaces.includes(group.id))) connect(`workspace:${group.id}`, `agent:${agent.id}`, 'authorization', null, 'outer');
  for (const agent of visibleAgents) for (const target of nodes.filter(node => node.data.kind === 'module' && agent.moduleIds.includes(node.id))) {
    connect(`agent:${agent.id}`, target.id, 'authorization', null, 'outer');
    const event = events.find(event => event.agentId === agent.id && event.moduleIds.includes(target.id) && ['running', 'pending', 'failed', 'completed'].includes(event.status));
    // Only exact recorded agent/module evidence can become an execution relationship.
    if (event) connect(`agent:${agent.id}`, target.id, 'execution', event, 'outer');
  }
  const dataMembers = [
    { nodeId: 'data-platform', layer: 4, label: 'Supabase', subtitle: 'Database · Auth · Storage', status: 'unknown', kind: 'data', description: 'Declared platform infrastructure. Uptime, throughput and database health are not measured by this view.' },
    ...visibleAgents.map(agent => ({ nodeId: `gateway:${agent.id}`, layer: 4, label: agent.provider || 'External provider', subtitle: `${agent.name} · Gateway`, status: agent.status, kind: 'integration', agentId: agent.id, lastObserved: agent.lastObserved, description: 'Recorded connection evidence. A successful request does not establish current online presence.' })),
    ...visibleIntegrations.map(item => ({ ...item, nodeId: item.id, layer: 4, kind: 'integration' })),
  ];
  add('data-group', 4, { label: 'Data & Integrations', subtitle: 'Database · gateway · saved connections', status: 'unknown', kind: 'data-group', members: dataMembers, open: true, expandKey: 'data-integrations', description: 'Declared infrastructure and accessible saved connection snapshots. This is not a system health measurement.' });
  connect('platform', 'data-platform', 'dependency', null, 'outer-left');

  for (const member of dataMembers) {
    add(member.nodeId, 4, member);
    if (member.agentId) connect(`agent:${member.agentId}`, member.nodeId, 'dependency', null, 'outer');
    if (member.workspace && groups.some(group=>group.id===member.workspace)) connect(`workspace:${member.workspace}`, member.nodeId, 'dependency', null, 'outer');
  }

  const laidOut = layoutNetworkNodes(nodes, edges, { narrow });
  const selectedModule = matching.find(module => module.id === selectedId);
  const selectedEvent = selectedModule && latest(selectedId);
  const selection = laidOut.nodes.find(node => node.id === selectedId) || (selectedModule && {
    id: selectedId, data: { ...selectedModule, kind: 'module', layer: 2, collapsed: true, event: selectedEvent, status: selectedEvent?.status ?? 'unknown' },
  });
  return { ...laidOut, groups, matching, visibleAgents, selection };
}
