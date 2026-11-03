import { beforeEach, expect, it, vi } from 'vitest';
const service = vi.hoisted(() => ({ context: vi.fn(), integrations: vi.fn() }));
vi.mock('../marketing/marketingService.js', () => ({ marketingService: service }));
import { readNetworkIntegrations } from './networkIntegrations.js';
beforeEach(() => vi.clearAllMocks());
it('does not query Brand connections without the accessible canonical settings module', async () => {
  expect(await readNetworkIntegrations([])).toEqual({ integrations: [], sources: [] });
  expect(service.context).not.toHaveBeenCalled();
});
it('uses the canonical Brand-scoped read and retains only display fields', async () => {
  service.context.mockResolvedValue({ brands: [{ id: 'b', name: 'Brand', organization_id: 'org' }] });
  service.integrations.mockResolvedValue({ connections: [{ id: 'c', brand_id: 'b', account_name: 'Page', channel: 'facebook', status: 'active', last_synced_at: '2026-11-03T00:00:00Z', credential_ref: 'private' }] });
  const result = await readNetworkIntegrations([{ id: 'marketing_connections' }]);
  expect(service.integrations).toHaveBeenCalledWith('org', null, 'settings');
  expect(result.integrations[0]).toMatchObject({ label: 'Page', status: 'observed', workspace: 'marketing' });
  expect(JSON.stringify(result)).not.toContain('credential_ref');
});
it('does not infer a live connection from active configuration', async () => {
  service.context.mockResolvedValue({ brands: [{ id: 'b', organization_id: 'org' }] });
  service.integrations.mockResolvedValue({ connections: [{ id: 'c', status: 'active' }] });
  expect((await readNetworkIntegrations([{ id: 'marketing_connections' }])).integrations[0].status).toBe('unknown');
});
