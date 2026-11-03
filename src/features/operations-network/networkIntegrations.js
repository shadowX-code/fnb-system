import { marketingService } from '../marketing/marketingService.js';

// Existing Brand-scoped settings read only; never invokes provider checks, syncs or OAuth flows.
export async function readNetworkIntegrations(modules) {
  if (!modules.some(module => module.id === 'marketing_connections')) return { integrations: [], sources: [] };
  try {
    const context = await marketingService.context();
    const organizations = [...new Set((context.brands || []).map(brand => brand.organization_id))];
    const integrations = [], sources = [];
    for (const organizationId of organizations) {
      try {
        const data = await marketingService.integrations(organizationId, null, 'settings');
        for (const row of data.connections || []) {
          const status = row.status === 'error' ? 'failed' : ['disconnected', 'revoked', 'inactive'].includes(row.status) ? 'idle' : row.last_synced_at ? 'observed' : 'unknown';
          integrations.push({ id: `social:${row.id}`, label: row.account_name || row.channel || 'Social account',
            subtitle: `${row.channel || 'Social'} · ${context.brands.find(brand => brand.id === row.brand_id)?.name || 'Brand connection'}`,
            moduleId: 'marketing_connections', workspace: 'marketing', status, lastObserved: row.last_synced_at || null,
            description: `Saved social connection${row.status ? ` · ${row.status}` : ''}. Last sync is a source observation, not current provider health.`,
          });
        }
        sources.push({ name: 'Brand social connections', state: 'available' });
      } catch { sources.push({ name: 'Brand social connections', state: 'unavailable' }); }
    }
    return { integrations, sources };
  } catch { return { integrations: [], sources: [{ name: 'Brand social connections', state: 'unavailable' }] }; }
}
