import { expect, it } from 'vitest';
import { buildNetwork } from './networkModel.js';
import { deriveNetworkFocus, presentNetworkEdges } from './networkPresentation.js';

const workspaces = ['factory', 'restaurant', 'hr', 'finance', 'marketing', 'crew', 'guest_ai'];
const modules = workspaces.flatMap(workspace => [0, 1].map(index => ({ id: `${workspace}-${index}`, label: `Operation ${index}`, workspace, section: 'Operations' })));
const agents = [{ id: 'a', name: 'Agent A', status: 'observed', workspaces: ['factory'], moduleIds: ['factory-0'] }, { id: 'b', name: 'Agent B', status: 'idle', workspaces: ['restaurant'], moduleIds: ['restaurant-0'] }];
const events = [{ id: 'e', agentId: 'a', status: 'pending', date: new Date().toISOString(), moduleIds: ['factory-0'], workspaces: ['factory'] }];
const options = { modules, agents, events, expanded: new Set(['factory']) };
const focused = (graph, id) => deriveNetworkFocus(graph, id);

it.each(workspaces)('keeps the full structural ownership path for a selected %s module', workspace => {
  const graph = buildNetwork({ modules, expanded: new Set([workspace]) });
  const focus = focused(graph, `${workspace}-0`);
  expect([...focus.nodeIds].sort()).toEqual(['platform', `workspace:${workspace}`, `operations:${workspace}`, `${workspace}-0`].sort());
  expect(focus.edgeIds.size).toBe(3);
  expect(focus.nodeIds.has(`${workspace}-1`)).toBe(false);
});

it('highlights the L1 parent of L2 without spreading into sibling workspaces', () => {
  const graph = buildNetwork({ modules });
  const focus = focused(graph, 'workspace:factory');
  expect([...focus.nodeIds].sort()).toEqual(['platform', 'workspace:factory']);
  expect(focus.edgeIds.size).toBe(1);
});

it('follows actual Agent authorization/execution plus module ancestry, without unrelated actors', () => {
  const graph = buildNetwork(options);
  const focus = focused(graph, 'agent:a');
  for (const id of ['agent:a', 'gateway:a', 'factory-0', 'operations:factory', 'workspace:factory', 'platform']) expect(focus.nodeIds.has(id), id).toBe(true);
  for (const id of ['factory-1', 'agent:b', 'workspace:restaurant', 'gateway:b']) expect(focus.nodeIds.has(id), id).toBe(false);
  const edges = presentNetworkEdges(graph.edges, false, 'agent:a', [], focus);
  expect(new Set(edges.filter(edge => edge.data.focused).map(edge => edge.data.kind))).toEqual(new Set(['dependency', 'authorization', 'execution']));
  expect(edges.every(edge => !edge.data.demoMotion)).toBe(true);
  expect(edges.find(edge => edge.data.kind === 'execution').data.status).toBe('pending');
});

it('follows an Integration through its connected Agent and upstream ownership only', () => {
  const graph = buildNetwork(options);
  const focus = focused(graph, 'gateway:a');
  for (const id of ['gateway:a', 'agent:a', 'factory-0', 'workspace:factory', 'platform']) expect(focus.nodeIds.has(id), id).toBe(true);
  expect(focus.nodeIds.has('agent:b')).toBe(false);
  const dataFocus = focused(graph, 'data-platform');
  expect([...dataFocus.nodeIds].sort()).toEqual(['data-platform', 'platform']);
  const social = buildNetwork({ ...options, integrations: [{ id: 'social:s', label: 'Saved page', workspace: 'marketing', status: 'observed' }] });
  expect([...focused(social, 'social:s').nodeIds].sort()).toEqual(['platform', 'social:s', 'workspace:marketing']);
});

it('retains collapsed selected-module context without adding hidden nodes or edges', () => {
  const graph = buildNetwork({ ...options, expanded: new Set(), selectedId: 'factory-0' });
  expect(graph.selection).toMatchObject({ id: 'factory-0', data: { kind: 'module', collapsed: true, status: 'pending' } });
  expect(graph.nodes.some(node => node.id === 'factory-0')).toBe(false);
  const focus = focused(graph, 'factory-0');
  expect([...focus.nodeIds].sort()).toEqual(['platform', 'workspace:factory']);
  expect([...focus.edgeIds]).toEqual(['dependency:platform:workspace:factory']);
  const filtered = buildNetwork({ ...options, workspace: 'restaurant', selectedId: 'factory-0' });
  expect(filtered.selection).toBeUndefined();
  expect(focused(filtered, 'factory-0').active).toBe(false);
});

it('restores normal presentation when selection clears and leaves routes/evidence untouched', () => {
  const graph = buildNetwork(options), before = JSON.stringify(graph);
  const focus = focused(graph, 'factory-0');
  const selected = presentNetworkEdges(graph.edges, false, 'factory-0', [], focus);
  const cleared = presentNetworkEdges(graph.edges, false, null, [], focused(graph, null));
  expect(selected.some(edge => edge.data.dimmed)).toBe(true);
  expect(cleared.every(edge => !edge.data.dimmed && !edge.data.focused && !edge.data.demoMotion)).toBe(true);
  expect(selected.map(edge => edge.data.routePoints)).toEqual(graph.edges.map(edge => edge.data.routePoints));
  expect(JSON.stringify(graph)).toBe(before);
});
