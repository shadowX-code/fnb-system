import { routeNetworkEdges } from './networkRouting.js';
export const workspaceAccents = { restaurant: '#f5b86b', factory: '#51e5dc', hr: '#bda6ff', crew: '#8be1b3', finance: '#ead17c', marketing: '#f393bf', guest_ai: '#92beff' };
const workspaceOrder = ['restaurant', 'factory', 'hr', 'crew', 'finance', 'marketing', 'guest_ai'];
export function layoutNetworkNodes(inputNodes, inputEdges, { narrow = false } = {}) {
  const nodes = inputNodes.map(node => ({ ...node, data: { ...node.data }, position: { ...node.position } }));
  const workspaces = nodes.filter(node => node.data.kind === 'workspace').sort((a, b) => workspaceOrder.indexOf(a.data.workspace) - workspaceOrder.indexOf(b.data.workspace));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const place = (node, x, y, width = 220, height = 118) => {
    node.position = { x, y }; node.width = width; node.height = height;
    node.focusable = node.data.kind !== 'operation-group';
    node.style = { width, height, '--son-accent': workspaceAccents[node.data.workspace] || '#55e5db' };
  };
  const columns = narrow ? Math.min(2, Math.max(workspaces.length, 1)) : Math.min(7, Math.max(workspaces.length, 1));
  const pitch = narrow ? 242 : 216, cardWidth = narrow ? 220 : 200;
  const gridWidth = Math.max(310, columns * pitch - (pitch - cardWidth));
  place(byId.get('platform'), (gridWidth - 280) / 2, 0, 280, 112);
  const rows = Math.ceil(workspaces.length / columns);
  workspaces.forEach((node, index) => {
    const row = Math.floor(index / columns), count = Math.min(columns, workspaces.length - row * columns);
    place(node, (gridWidth - (count * pitch - (pitch - cardWidth))) / 2 + index % columns * pitch, 160 + row * 108, cardWidth, 84);
  });
  let cursor = 160 + Math.max(1, rows) * 108 + 14;
  for (const section of nodes.filter(node => node.data.kind === 'operation-group')) {
    place(section, 0, cursor, gridWidth, 42);
    const children = nodes.filter(node => node.data.kind === 'module' && node.data.workspace === section.data.workspace);
    children.forEach((node, index) => place(node, index % columns * pitch, cursor + 64 + Math.floor(index / columns) * 112, cardWidth, 92));
    cursor += 88 + Math.ceil(children.length / columns) * 112;
  }
  // Each support layer owns its expanded members, so data never shares the agent row.
  for (const [groupId, kinds] of [['automation-group', ['agent']], ['data-group', ['data', 'integration']]]) {
    place(byId.get(groupId), (gridWidth - gridWidth) / 2, cursor, gridWidth, 30);
    cursor += 44;
    const members = nodes.filter(node => kinds.includes(node.data.kind));
    members.forEach((node, index) => {
      const count = Math.min(columns, members.length - Math.floor(index / columns) * columns);
      place(node, (gridWidth - (count * pitch - (pitch - cardWidth))) / 2 + index % columns * pitch, cursor + Math.floor(index / columns) * 98, cardWidth, 80);
    });
    if (members.length) cursor += Math.ceil(members.length / columns) * 98 + 18;
  }
  const edges = routeNetworkEdges(nodes, inputEdges);
  const primaryIds = ['platform', ...workspaces.map(node => node.id), ...nodes.filter(node => ['agent-group','data-group','agent','data','integration'].includes(node.data.kind)).map(node=>node.id)];
  return { nodes, edges, primaryIds: narrow && workspaces.length > 2 ? ['platform', ...workspaces.slice(0, 2).map(node => node.id)] : primaryIds };
}

// Synthetic motion is a rendering flag only. It never replaces evidence, outcomes or timestamps.
export function presentNetworkEdges(edges, visualDemo, selectedId = null, visibleNodeIds = []) {
  const representatives = new Map(), visible = new Set(visibleNodeIds);
  const priority = edge => (edge.source === selectedId || edge.target === selectedId ? 10 : 0) + Number(visible.has(edge.source)) + Number(visible.has(edge.target));
  const candidates = edges.filter(edge=>edge.data.kind !== 'execution');
  for (const edge of [...candidates].sort((a,b)=>priority(b)-priority(a)||a.id.localeCompare(b.id))) {
    const category=`${edge.data.sourceLayer}:${edge.data.targetLayer}:${edge.data.kind}`;
    if(!representatives.has(category)) representatives.set(category,edge.id);
  }
  const demoIds=new Set([...representatives.values()].slice(0,10));
  return edges.map(edge => ({ ...edge, data: { ...edge.data, demoMotion: !!visualDemo && demoIds.has(edge.id), focused: !!selectedId && (edge.source === selectedId || edge.target === selectedId), dimmed: !!selectedId && edge.source !== selectedId && edge.target !== selectedId } }));
}
