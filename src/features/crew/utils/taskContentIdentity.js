const newIdentity = () => crypto.randomUUID();

export function duplicateTaskBlock(block) {
  const config = structuredClone(block.config || block.block_config || {});
  config.localization_key = newIdentity();
  if (config.options) config.options = config.options.map((option) => typeof option === "string" ? option : { ...option, id: newIdentity() });
  return { ...block, id: `temp:${newIdentity()}`, config };
}

// Repair only editable Draft projections. Preserve the first existing identity
// (and its translations); ambiguous copies start with independent translations.
export function repairDraftTaskIdentity(task) {
  if (task.status && task.status !== "draft") return task;
  const seen = new Set();
  return { ...task, blocks: (task.blocks || []).map((block) => {
    const config = { ...(block.config || block.block_config || {}) };
    let key = config.localization_key || block.id || newIdentity();
    if (seen.has(key)) key = newIdentity();
    seen.add(key);
    return { ...block, config: { ...config, localization_key: key } };
  }) };
}

export function moveTaskBlock(blocks, id, targetId, placement) {
  if (id === targetId) return blocks;
  const block = blocks.find((item) => item.id === id);
  if (!block || !blocks.some((item) => item.id === targetId)) return blocks;
  const next = blocks.filter((item) => item.id !== id);
  const index = next.findIndex((item) => item.id === targetId);
  next.splice(index + (placement === "after" ? 1 : 0), 0, block);
  return next;
}
