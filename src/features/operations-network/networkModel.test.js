import { describe, expect, it } from 'vitest';
import { accessibleNetworkModules, buildNetwork, eventStatus, filterEvents, permissionAllowed } from './networkModel.js';
const auth = codes => ({ hasPermission: code => codes.includes(code) });
const modules = [{ id: 'inventory_stock_check', label: 'Stock Check', workspace: 'restaurant', section: 'Inventory' }, { id: 'factory_job_orders', label: 'Production Overview', workspace: 'factory', section: 'Production' }];
const now = Date.parse('2026-11-03T00:00:00Z');
const event = { id: 'e', date: new Date(now - 3000).toISOString(), status: 'completed', moduleIds: ['inventory_stock_check'], workspaces: ['restaurant'], outletId: 'o1', companyId: null, agentId: 'a' };
const agent = { id: 'a', name: 'Operator', status: 'observed', moduleIds: ['inventory_stock_check'], workspaces: ['restaurant'] };

describe('permission-derived operations network', () => {
  it('uses composed route permissions and workspace access, excluding compatibility aliases', () => {
    const routes = [{ id: 'marketing_inbox', permission: 'marketing_workspace.access AND marketing_inbox.view' }, { id: 'inventory_stock_check', permission: 'inventory_stock_check.view' }, { id: 'crew_reward_cycles', permission: '' }];
    expect(accessibleNetworkModules(routes, auth(['marketing_inbox.view']))).toEqual([]);
    expect(accessibleNetworkModules(routes, auth(['inventory_stock_check.view'])).map(row => row.id)).toEqual(['inventory_stock_check']);
    expect(permissionAllowed(auth(['b', 'c']), 'a OR b AND c')).toBe(true);
  });
  it('keeps five layers, collapses operations and never invents execution on collapsed workspaces', () => {
    const result = buildNetwork({ modules, agents: [agent], events: [event], now });
    expect(new Set(result.nodes.map(node => node.data.layer)).size).toBe(5);
    expect(result.nodes.some(node => node.id === 'inventory_stock_check')).toBe(false);
    expect(result.edges.every(edge => edge.data.kind === 'dependency')).toBe(true);
    expect(result.nodes.find(node => node.id === 'data-platform').data.status).toBe('unknown');
  });
  it('draws execution only for exact agent/module evidence and expires the success pulse', () => {
    const options = { modules, agents: [agent], events: [event], expanded: new Set(['restaurant']), now };
    const result = buildNetwork(options);
    const edge = result.edges.find(edge => edge.data.kind === 'execution');
    expect(edge).toMatchObject({ source: 'agent:a', target: 'inventory_stock_check', data: { status: 'completed', fresh: true } });
    expect(buildNetwork({ ...options, now: now + 15000 }).edges.find(edge => edge.data.kind === 'execution').data.fresh).toBe(false);
  });
  it('searches and expands matching modules without exposing unrelated workspaces', () => {
    const result = buildNetwork({ modules, search: 'stock' });
    expect(result.groups.map(group => group.id)).toEqual(['restaurant']);
    expect(result.nodes.some(node => node.id === 'inventory_stock_check')).toBe(true);
    expect(result.edges.every(edge => result.nodes.some(node => node.id === edge.source) && result.nodes.some(node => node.id === edge.target))).toBe(true);
  });
  it('filters time and recorded scope fail-closed; future/invalid events are excluded', () => {
    const rows = [event, { ...event, id: 'unscoped', outletId: null }, { ...event, id: 'old', date: new Date(now - 48 * 3600000).toISOString() }, { ...event, id: 'future', date: new Date(now + 1000).toISOString() }];
    expect(filterEvents(rows, { outlet: 'o1' }, now).map(row => row.id)).toEqual(['e']);
    expect(filterEvents(rows, { company: 'c1' }, now)).toEqual([]);
    expect(filterEvents(rows, { window: '7d', outlet: 'o1' }, now).map(row => row.id)).toEqual(['e', 'old']);
  });
  it('does not equate accepted API calls or unproven receipts with completed work', () => {
    expect(eventStatus('accepted')).toBe('unknown');
    expect(eventStatus('unproven')).toBe('unknown');
    expect(eventStatus('committed')).toBe('completed');
    expect(eventStatus('awaiting_execution')).toBe('pending');
  });
  it('retains current open requests in Live without relabeling them as recent history', () => {
    const old = { ...event, status: 'pending', current: true, date: new Date(now - 8 * 86400000).toISOString() };
    expect(filterEvents([old], { window: 'live' }, now)).toEqual([old]);
    expect(filterEvents([old], { window: '7d' }, now)).toEqual([]);
  });
});
