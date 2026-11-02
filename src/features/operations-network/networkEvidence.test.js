import { beforeEach, expect, it, vi } from 'vitest';
const service = vi.hoisted(() => ({ list: vi.fn(), details: vi.fn(), actionRequests: vi.fn() }));
vi.mock('../../services/externalAgentService.js', () => ({ externalAgentService: service }));
vi.mock('../../services/legalEntityService.js', () => ({ legalEntityService: { list: vi.fn().mockResolvedValue([]) } }));
import { readNetworkEvidence } from './networkEvidence.js';
const modules = [{ id: 'inventory_stock_check', workspace: 'restaurant' }, { id: 'external_agents', workspace: 'restaurant' }];
const auth = { hasPermission: code => code === 'roles.view', profile: { role_outlet_access_type: 'selected', role_outlet_ids: ['allowed'] } };
beforeEach(() => {
  vi.clearAllMocks();
  service.list.mockResolvedValue({ connections: [{ id: 'a', name: 'Operator', enabled: true, role_active: true, connection_status: 'mcp_observed', can_manage: true, credential: { status: 'active' }, business_capabilities: [{ module_id: 'inventory_stock_check', granted: true }, { module_id: 'secret_module', granted: true }] }] });
  service.details.mockResolvedValue({ access_events: [
    { id: 'allowed', occurred_at: '2026-11-03T00:00:00Z', tool: 'query_restaurant_resources', outcome: 'success', resource_actions: [{ business_module: 'inventory_stock_check' }] },
    { id: 'secret', occurred_at: '2026-11-03T00:00:00Z', tool: 'query_restaurant_resources', outcome: 'success', resource_actions: [{ business_module: 'secret_module' }] },
  ] });
  service.actionRequests.mockResolvedValue([]);
});
it('does not request integration telemetry without existing authority', async () => {
  const result = await readNetworkEvidence({ auth: { hasPermission: () => false }, modules });
  expect(service.list).not.toHaveBeenCalled();
  expect(result.agents).toEqual([]);
});
it('redacts unauthorized relationships and never treats a connection observation as running', async () => {
  const result = await readNetworkEvidence({ auth, modules });
  expect(result.agents[0]).toMatchObject({ status: 'observed', moduleIds: ['inventory_stock_check'] });
  expect(result.events.map(row => row.id)).toEqual(['a:access:allowed']);
  expect(JSON.stringify(result)).not.toContain('secret_module');
  expect(result.agents[0]).not.toHaveProperty('credential');
  expect(result.events[0]).not.toHaveProperty('diagnostics');
});
it('keeps partial source failures visible instead of manufacturing successful counts', async () => {
  service.details.mockRejectedValue(new Error('private provider error'));
  const result = await readNetworkEvidence({ auth, modules });
  expect(result.events).toEqual([]);
  expect(result.sources).toContainEqual({ name: 'Operator history', state: 'unavailable' });
  expect(JSON.stringify(result)).not.toContain('private provider error');
});
it('does not read action-request evidence for identities the viewer cannot manage', async () => {
  service.list.mockResolvedValue({ connections: [{ id: 'a', name: 'Reader', enabled: true, role_active: true, can_manage: false }] });
  await readNetworkEvidence({ auth, modules });
  expect(service.actionRequests).not.toHaveBeenCalled();
});
