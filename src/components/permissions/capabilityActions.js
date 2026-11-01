export const actionLabels = {
  view: 'View Records', list: 'View Records', read: 'View Records', search: 'View Records', filter: 'View Records',
  draft: 'Draft', execute: 'Execute', create: 'Create', update: 'Update', submit: 'Submit',
  complete: 'Complete', verify: 'Verify', approve: 'Approve', cancel: 'Cancel',
};

export function capabilityDomain(capability,catalog) {
  const owner=capability.module_id&&catalog.find(row=>row.module_id===capability.module_id&&row.capability==='view');
  return owner?.domain||owner?.section||capability.domain||capability.domain_label||capability.section||'Factory';
}
