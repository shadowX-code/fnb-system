// A presentation of existing policies only; never used to authorize or calculate grants.
export function accessScopeSummary(capability, catalog = []) {
  const scopes = capability.scope || [];
  const labels = new Map(catalog.filter(c => c.module_id).map(c => [c.module_id, c.label]));
  for (const required of capability.required_modules || []) labels.set(required.id, required.label);
  const externalSources = scope => (scope.required_modules || []).filter(id => id !== capability.module_id);
  const standalone = scopes.filter(s => !externalSources(s).length);
  const included = standalone.map(s => s.label).filter(Boolean);
  const separate = scopes.filter(s => externalSources(s).length).map(s => ({
    label: s.label,
    sources: [...new Set(externalSources(s).map(id => labels.get(id) || 'Additional source capability'))],
  }));
  const contextualOwners = new Set();
  const standaloneOwners = new Set();
  for (const scope of scopes) {
    for (const [field, owner] of Object.entries(scope.context_fields || {})) {
      if (!scope.fields?.includes(field) || owner === capability.module_id) continue;
      contextualOwners.add(owner);
      if (!externalSources(scope).length) standaloneOwners.add(owner);
    }
  }
  const fields = new Set(standalone.flatMap(s => s.fields || []));
  if (fields.has('current_balance')) included.push('Current stock balances');
  if (fields.has('manual_unit_cost')) included.push('Saved manual cost basis');
  if (fields.has('b2b_price')) included.push('Saved selling prices');
  if (fields.has('unit_cost') || fields.has('total_cost')) included.push('Saved receiving costs');
  const contextLabels = [...standaloneOwners].map(id => labels.get(id)).filter(Boolean);
  if (contextLabels.length) included.push(`Basic related references: ${contextLabels.join(', ')}`);
  const sourceOwners = new Set(scopes.flatMap(externalSources));
  const otherOwners = [...contextualOwners].filter(id => !sourceOwners.has(id));
  if (otherOwners.length) separate.push({label:'Full related records',sources:[...new Set(otherOwners.map(id => labels.get(id) || 'Related capability')))]});
  if (capability.retained_only) separate.push({label:'Broader module access and other record collections',sources:[]});
  const notes = [];
  if (capability.capability_limitation) notes.push(capability.capability_limitation);
  if (standaloneOwners.size) notes.push('Related names and statuses, when available, reflect current records rather than historical snapshots.');
  if (capability.retained_only) notes.push('This existing grant retains its saved scope.');
  return {included:[...new Set(included)],separate,notes};
}
