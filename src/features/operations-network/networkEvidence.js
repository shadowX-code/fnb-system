import { externalAgentService } from '../../services/externalAgentService.js';
import { legalEntityService } from '../../services/legalEntityService.js';
import { agentActivity } from '../integrations/agentActivity.js';
import { canAccessOutlet } from '../../utils/accessControl.js';
import { eventStatus, permissionAllowed } from './networkModel.js';
import { readNetworkIntegrations } from './networkIntegrations.js';

// Only sanitized display evidence leaves this adapter. Credentials, intents and receipts stay with their owners.
export async function readNetworkEvidence({ auth, modules }) {
  const moduleById = new Map(modules.map(module => [module.id, module]));
  const sources = [], agents = [], events = [];
  let companies = [], integrations = [];
  await Promise.all([
    (async () => {
      const result = await readNetworkIntegrations(modules);
      integrations = result.integrations;
      sources.push(...result.sources);
    })(),
    (async () => {
      if (!auth.hasPermission('legal_entities.view')) return;
      try {
        companies = (await legalEntityService.list()).map(row => ({ id: row.id, name: row.display_name || row.legal_company_name || row.name || 'Company name unavailable' }));
      } catch { sources.push({ name: 'Company scope', state: 'unavailable' }); }
    })(),
    (async () => {
      if (!permissionAllowed(auth, 'roles.view OR roles_permissions.view')) return;
      let connections;
      try {
        connections = (await externalAgentService.list()).connections || [];
        sources.push({ name: 'AI Integrations', state: 'available' });
      } catch { sources.push({ name: 'AI Integrations', state: 'unavailable' }); return; }
      // Bound concurrent detail reads without truncating the identity list.
      for (let offset = 0; offset < connections.length; offset += 4) {
        await Promise.all(connections.slice(offset, offset + 4).map(async connection => {
          const moduleIds = [...new Set((connection.business_capabilities || connection.tools || []).filter(capability => capability.granted).map(capability => capability.module_id))].filter(id => moduleById.has(id));
          const workspaces = [...new Set(moduleIds.map(id => moduleById.get(id).workspace))];
          const disabled = !connection.enabled || !connection.role_active;
          const expired = ['expired', 'revoked'].includes(connection.credential?.status);
          agents.push({ id: connection.id, name: connection.name, provider: connection.provider,
            moduleIds, workspaces, status: disabled ? 'idle' : expired ? 'failed' : connection.connection_status === 'mcp_observed' ? 'observed' : 'unknown',
            connectionLabel: disabled ? 'Disabled' : expired ? 'Access expired or revoked' : connection.connection_status === 'mcp_observed' ? 'Successful request recorded' : 'No connection observed',
            lastObserved: connection.last_mcp_success || null,
          });
          try {
            const [detailResult, requestsResult] = await Promise.allSettled([
              externalAgentService.details(connection.id),
              connection.can_manage ? externalAgentService.actionRequests(connection.id) : Promise.resolve([]),
            ]);
            if (detailResult.status !== 'fulfilled') throw new Error('Unavailable');
            if (requestsResult.status !== 'fulfilled') sources.push({ name: `${connection.name} action requests`, state: 'unavailable' });
            const requests = requestsResult.status === 'fulfilled' ? requestsResult.value : [];
            const requestById = new Map(requests.map(row => [row.request_id, row]));
            const projection = agentActivity(detailResult.value, requests, connection.id);
            for (const entry of projection.events) {
              const isConfiguration = entry.state === 'configuration_changed';
              const ids = isConfiguration ? ['external_agents'] : entry.moduleIds;
              // Unattributed access history cannot be assigned to a business module by guessing.
              if (!ids.length || ids.some(id => !moduleById.has(id))) continue;
              const request = entry.diagnostics?.[0]?.request;
              const canonical = request ? requestById.get(request.request_id) : null;
              if (canonical && canonical.input === undefined) continue;
              const outletId = canonical?.input?.outlet_id || null;
              if (outletId && !canAccessOutlet(auth, outletId)) continue;
              events.push({ id: `${connection.id}:${entry.id}`, agentId: connection.id, agentName: connection.name,
                date: entry.date, title: isConfiguration ? 'Agent configuration changed' : entry.title,
                description: entry.impact, status: eventStatus(entry.state), moduleIds: ids,
                workspaces: [...new Set(ids.map(id => moduleById.get(id).workspace))],
                outletId, companyId: canonical?.input?.legal_entity_id || null,
                current: !!canonical && ['pending_approval', 'awaiting_execution', 'needs_resolution'].includes(canonical.queue_state),
              });
            }
          } catch { sources.push({ name: `${connection.name} history`, state: 'unavailable' }); }
        }));
      }
    })(),
  ]);
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return { agents, events, integrations, companies, sources, observedAt: new Date().toISOString() };
}
