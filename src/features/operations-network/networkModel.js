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
    return module.id !== 'operations_network' && module.routable !== false
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

export function buildNetwork({ modules, agents = [], integrations = [], events = [], expanded = new Set(), workspace = 'all', search = '', status = 'all', selectedId, now = Date.now() }) {
  const query = search.trim().toLowerCase();
  const latest = id => events.find(event => event.moduleIds.includes(id));
  const matching = modules.filter(module => (workspace === 'all' || module.workspace === workspace)
    && (!query || `${module.label} ${module.section} ${module.workspace}`.toLowerCase().includes(query))
    && (status === 'all' || (latest(module.id)?.status ?? 'unknown') === status));
  const groups = workspaceSwitcherOptions.map(option => ({ ...option, modules: matching.filter(module => module.workspace === option.id) })).filter(option => option.modules.length);
  const nodes = [], edges = [];
  const width = Math.max(groups.length * 258, 258);
  const add = (id, layer, x, y, data) => nodes.push({ id, type: 'network', ariaLabel: `${data.label}: ${data.subtitle || statusLabels[data.status]}`, position: { x, y }, selected: id === selectedId, data: { layer, ...data }, draggable: false });
  const connect = (source, target, kind = 'dependency', event) => edges.push({
    id: `${kind}:${source}:${target}`, source, target, type: 'network',
    data: { kind, status: event?.status ?? 'idle', date: event?.date, fresh: !!event && now - Date.parse(event.date) < 12000 },
  });
  add('platform', 0, width / 2 - 116, 0, { label: 'FeedX OS', subtitle: 'F&B operations core', status: 'available', kind: 'platform', description: 'Platform architecture. Availability here describes your access, not a system health check.' });
  let operationsBottom = 360;
  groups.forEach((group, index) => {
    const x = index * 258, id = `workspace:${group.id}`;
    const open = expanded.has(group.id) || !!query || status !== 'all';
    add(id, 1, x, 180, { label: group.label, subtitle: `${group.modules.length} accessible modules`, status: 'available', kind: 'workspace', workspace: group.id, open, modules: group.modules, description: group.detail });
    connect('platform', id);
    if (open) group.modules.forEach((module, row) => {
      const event = latest(module.id), y = 360 + row * 108;
      add(module.id, 2, x, y, { ...module, kind: 'module', subtitle: module.section, status: event?.status ?? 'unknown', event });
      connect(id, module.id);
      operationsBottom = Math.max(operationsBottom, y + 100);
    });
    else add(`collapsed:${group.id}`, 2, x, 360, { label: `${group.modules.length} operations`, subtitle: 'Expand workspace to explore', status: 'unknown', kind: 'collapsed', workspace: group.id });
    if (!open) connect(id, `collapsed:${group.id}`);
  });
  const agentY = operationsBottom + 140;
  const visibleAgents = agents.filter(agent => (workspace === 'all' || agent.workspaces.includes(workspace))
    && (!query || agent.name.toLowerCase().includes(query) || matching.some(module => agent.moduleIds.includes(module.id)))
    && (status === 'all' || agent.status === status));
  if (!visibleAgents.length) add('automation-gap', 3, width / 2 - 116, agentY, { label: 'Automation visibility', subtitle: 'No matching agent evidence', status: 'unknown', kind: 'gap', description: 'No accessible agent matches this view. Other automation histories are not connected to this network.' });
  visibleAgents.forEach((agent, index) => {
    const id = `agent:${agent.id}`;
    add(id, 3, (width - visibleAgents.length * 258) / 2 + index * 258, agentY, { ...agent, label: agent.name, subtitle: agent.connectionLabel, kind: 'agent' });
    for (const group of groups.filter(group => agent.workspaces.includes(group.id))) {
      const targets = nodes.filter(node => node.data.kind === 'module' && agent.moduleIds.includes(node.id) && node.data.workspace === group.id);
      // A collapsed workspace has declared access only; never project execution onto it.
      if (!targets.length) connect(`workspace:${group.id}`, id);
      for (const target of targets) {
        const event = events.find(event => event.agentId === agent.id && event.moduleIds.includes(target.id) && ['running', 'pending', 'failed', 'completed'].includes(event.status));
        if (event) connect(id, target.id, 'execution', event);
        else connect(target.id, id);
      }
    }
  });
  add('data-platform', 4, width / 2 - 116, agentY + 220, { label: 'Supabase', subtitle: 'Database · Auth · Storage', status: 'unknown', kind: 'data', description: 'Declared platform infrastructure. Service uptime, throughput and database health are not measured by this view.' });
  if (groups.length) connect('platform', 'data-platform');
  const visibleIntegrations = integrations.filter(item => (workspace === 'all' || item.workspace === workspace) && (status === 'all' || item.status === status) && (!query || `${item.label} ${item.subtitle}`.toLowerCase().includes(query)));
  const connectionsExpanded = expanded.has('social-connections') || !!query;
  const endpoints = visibleAgents.length + (connectionsExpanded ? visibleIntegrations.length : visibleIntegrations.length ? 1 : 0);
  for (const [index, agent] of visibleAgents.entries()) {
    const id = `gateway:${agent.id}`;
    add(id, 4, (width - endpoints * 258) / 2 + index * 258, agentY + 350, { label: agent.provider || 'External provider', subtitle: 'External Agent Gateway', status: agent.status, kind: 'integration', agentId: agent.id, description: 'Recorded connection evidence. A successful request does not establish current online presence.', lastObserved: agent.lastObserved });
    connect(id, `agent:${agent.id}`);
  }
  if (!connectionsExpanded && visibleIntegrations.length) {
    add('social-connections', 4, (width - endpoints * 258) / 2 + visibleAgents.length * 258, agentY + 350, { label: 'Brand connections', subtitle: `${visibleIntegrations.length} saved social connections`, kind: 'integration-group', status: 'unknown', integrations: visibleIntegrations, description: 'Saved Brand-scoped social connections. Expand to inspect each connection and its last recorded sync.' });
    const parent = nodes.find(node => node.id === 'marketing_connections') || nodes.find(node => node.id === 'workspace:marketing');
    if (parent) connect('social-connections', parent.id);
  }
  if (connectionsExpanded) visibleIntegrations.forEach((item, index) => {
    add(item.id, 4, (width - endpoints * 258) / 2 + (visibleAgents.length + index) * 258, agentY + 350, { ...item, kind: 'integration' });
    const module = nodes.find(node => node.id === item.moduleId);
    const parent = groups.find(group => group.id === item.workspace);
    if (module || parent) connect(item.id, module?.id || `workspace:${parent.id}`);
  });
  return { nodes, edges, groups, matching, visibleAgents };
}
