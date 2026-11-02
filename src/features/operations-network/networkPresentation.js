export const workspaceAccents = { restaurant: '#f5b86b', factory: '#51e5dc', hr: '#bda6ff', crew: '#8be1b3', finance: '#ead17c', marketing: '#f393bf', guest_ai: '#92beff' };
const workspaceOrder = ['restaurant', 'factory', 'hr', 'crew', 'finance', 'marketing', 'guest_ai'];
const slots = {
  1: [[440, 285]], 2: [[180, 290], [700, 290]], 3: [[100, 280], [440, 390], [780, 280]],
  4: [[40, 140], [840, 140], [220, 410], [660, 410]],
  5: [[20, 100], [860, 100], [80, 330], [800, 330], [440, 460]],
  6: [[20, 90], [860, 90], [0, 280], [880, 280], [220, 460], [660, 460]],
  7: [[20, 90], [860, 90], [0, 270], [880, 270], [200, 445], [440, 485], [680, 445]],
};

export function layoutNetworkNodes(inputNodes, inputEdges, { narrow = false } = {}) {
  const nodes = inputNodes.map(node => ({ ...node, data: { ...node.data }, position: { ...node.position } }));
  const workspaces = nodes.filter(node => node.data.kind === 'workspace').sort((a, b) => workspaceOrder.indexOf(a.data.workspace) - workspaceOrder.indexOf(b.data.workspace));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const place = (node, x, y, width = 220, height = 118) => {
    node.position = { x, y }; node.width = width; node.height = height;
    node.style = { width, height, '--son-accent': workspaceAccents[node.data.workspace] || '#55e5db' };
  };
  const columns = narrow ? Math.min(2, Math.max(workspaces.length, 1)) : 4;
  const gridWidth = narrow ? columns * 242 - 22 : 1060;
  const hubX = narrow ? (gridWidth - 260) / 2 : 420;
  place(byId.get('platform'), hubX, narrow || workspaces.length < 4 ? 0 : 160, 260, 186);
  workspaces.forEach((node, index) => {
    const [x, y] = narrow ? [(index % columns) * 242, 240 + Math.floor(index / columns) * 168] : slots[workspaces.length][index];
    place(node, x, y);
  });
  let cursor = Math.max(390, ...workspaces.map(node => node.position.y + 118)) + 42;
  // Expansion lives in owned operation bays, keeping every workspace and its labels clear.
  for (const section of nodes.filter(node => node.data.kind === 'operation-group')) {
    place(section, narrow ? 0 : 40, cursor, gridWidth, 42);
    const children = nodes.filter(node => node.data.kind === 'module' && node.data.workspace === section.data.workspace);
    children.forEach((node, index) => place(node, (narrow ? 0 : 40) + (index % columns) * (narrow ? 242 : 270), cursor + 68 + Math.floor(index / columns) * 112, narrow ? 220 : 250, 92));
    cursor += 80 + Math.ceil(children.length / columns) * 112;
  }
  const groupWidth = narrow ? Math.max(310, gridWidth) : 350;
  place(byId.get('automation-group'), narrow ? 0 : 140, cursor, groupWidth, 106);
  place(byId.get('data-group'), narrow ? 0 : 640, narrow ? cursor + 142 : cursor, groupWidth, 106);
  cursor += narrow ? 290 : 158;
  for (const kind of ['agent', 'data', 'integration']) {
    const members = nodes.filter(node => node.data.kind === kind);
    members.forEach((node, index) => place(node, (narrow ? 0 : 40) + (index % columns) * (narrow ? 242 : 270), cursor + Math.floor(index / columns) * 112, narrow ? 220 : 250, 96));
    if (members.length) cursor += Math.ceil(members.length / columns) * 112 + 28;
  }
  const handles = (source, target, routing) => {
    if (routing === 'hub') {
      const center = source.position.x + source.width / 2, targetCenter = target.position.x + target.width / 2;
      if (target.position.y > source.position.y + source.height - 20) return ['bottom', 'top'];
      return targetCenter < center ? ['left', 'right'] : ['right', 'left'];
    }
    if (routing === 'outer-left') return ['left', target.data.kind.endsWith('-group') ? 'top' : 'left'];
    if (routing === 'outer') return ['right', target.data.kind.endsWith('-group') ? 'top' : 'right'];
    if (routing === 'module') return ['bottom', 'left'];
    return ['right', 'left'];
  };
  const edges = inputEdges.map((edge, index) => {
    const source = byId.get(edge.source), target = byId.get(edge.target);
    const [sourceHandle, targetHandle] = handles(source, target, edge.data.routing);
    return { ...edge, sourceHandle: `out-${sourceHandle}`, targetHandle: `in-${targetHandle}`, data: { ...edge.data, endAtTop: targetHandle === 'top', lane: index % 5, outerX: edge.data.routing === 'outer-left' ? -46 - index % 3 * 12 : (narrow ? gridWidth : 1100) + 38 + index % 5 * 12 } };
  });
  const primaryIds = ['platform', ...workspaces.map(node => node.id), 'automation-group', 'data-group'];
  return { nodes, edges, primaryIds: narrow && workspaces.length > 2 ? ['platform', ...workspaces.slice(0, 2).map(node => node.id)] : primaryIds };
}

// Synthetic motion is a rendering flag only. It never replaces evidence, outcomes or timestamps.
export function presentNetworkEdges(edges, visualDemo) {
  let synthetic = 0;
  return edges.map(edge => {
    const demoMotion = visualDemo && edge.data.kind === 'dependency' && (edge.source === 'platform' || edge.source === 'automation-group') && synthetic++ < 5;
    return { ...edge, data: { ...edge.data, demoMotion: !!demoMotion } };
  });
}
