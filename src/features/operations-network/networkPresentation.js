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
  const columns = narrow ? Math.min(2, Math.max(workspaces.length, 1)) : Math.min(4, Math.max(workspaces.length, 1));
  const gridWidth = Math.max(310, columns * 254 - 24);
  place(byId.get('platform'), (gridWidth - 300) / 2, 0, 300, 150);
  const rows = Math.ceil(workspaces.length / columns);
  workspaces.forEach((node, index) => {
    const row = Math.floor(index / columns), count = Math.min(columns, workspaces.length - row * columns);
    place(node, (gridWidth - (count * 254 - 24)) / 2 + index % columns * 254, 220 + row * 150, 230, 104);
  });
  let cursor = 220 + Math.max(1, rows) * 150 + 24;
  for (const section of nodes.filter(node => node.data.kind === 'operation-group')) {
    place(section, 0, cursor, gridWidth, 42);
    const children = nodes.filter(node => node.data.kind === 'module' && node.data.workspace === section.data.workspace);
    children.forEach((node, index) => place(node, index % columns * 254, cursor + 64 + Math.floor(index / columns) * 112, 230, 92));
    cursor += 88 + Math.ceil(children.length / columns) * 112;
  }
  // Each support layer owns its expanded members, so data never shares the agent row.
  for (const [groupId, kinds] of [['automation-group', ['agent']], ['data-group', ['data', 'integration']]]) {
    place(byId.get(groupId), (gridWidth - Math.min(gridWidth, 520)) / 2, cursor, Math.min(gridWidth, 520), 90);
    cursor += 130;
    const members = nodes.filter(node => kinds.includes(node.data.kind));
    members.forEach((node, index) => place(node, index % columns * 254, cursor + Math.floor(index / columns) * 112, 230, 96));
    if (members.length) cursor += Math.ceil(members.length / columns) * 112 + 24;
  }
  const edges = inputEdges.map((edge, index) => {
    const source = byId.get(edge.source), target = byId.get(edge.target);
    let routing = edge.data.routing, sourceHandle = 'bottom', targetHandle = 'top';
    const sameLayer = source.data.layer === target.data.layer;
    const distant = Math.abs(target.position.y - source.position.y) > 260;
    if (routing?.startsWith('outer') || distant || sameLayer) {
      routing = 'outer';
      sourceHandle = source.position.y > target.position.y ? 'top' : 'bottom';
    }
    if (edge.data.routing === 'module') { routing = 'module'; targetHandle = 'left'; }
    const leftLane = (source.position.x + source.width / 2 < gridWidth / 2) || edge.data.routing === 'outer-left';
    return { ...edge, sourceHandle: `out-${sourceHandle}`, targetHandle: `in-${targetHandle}`, data: { ...edge.data, routing, departureY: sourceHandle === 'top' ? source.position.y - 22 : source.position.y + source.height + 22, startMode: sourceHandle, entryGap: 24, outerX: leftLane ? -28 - index % 3 * 9 : gridWidth + 28 + index % 3 * 9 } };
  });
  const primaryIds = ['platform', ...workspaces.map(node => node.id), 'automation-group', 'data-group'];
  return { nodes, edges, primaryIds: narrow && workspaces.length > 2 ? ['platform', ...workspaces.slice(0, 2).map(node => node.id)] : primaryIds };
}

// Synthetic motion is a rendering flag only. It never replaces evidence, outcomes or timestamps.
export function presentNetworkEdges(edges, visualDemo, selectedId = null) {
  let synthetic = 0;
  return edges.map(edge => {
    const demoMotion = visualDemo && edge.data.kind === 'dependency' && (edge.source === 'platform' || edge.source === 'automation-group') && synthetic++ < 5;
    return { ...edge, data: { ...edge.data, demoMotion: !!demoMotion, dimmed: !!selectedId && edge.source !== selectedId && edge.target !== selectedId } };
  });
}
