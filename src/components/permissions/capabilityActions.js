export const actionLabels = {prepare:'Prepare',calculate:'Calculate / Recalculate',shortlist:'Shortlist',advance:'Advance',reject:'Reject',reverse:'Reverse',
  confirm:'Confirm Supplier',receive:'Receive',return_to_draft:'Return to Draft',view: 'View Records', list: 'View Records', read: 'View Records', search: 'View Records', filter: 'View Records',
  draft: 'Draft', execute: 'Execute', create: 'Create', update: 'Update', submit: 'Submit',
  complete: 'Complete', verify: 'Verify', approve: 'Approve', cancel: 'Cancel',
};

export function capabilityDomain(capability,catalog) {
  const owner=capability.module_id&&catalog.find(row=>row.module_id===capability.module_id&&row.capability==='view');
  return owner?.domain||owner?.section||capability.domain||capability.domain_label||capability.section||'Factory';
}

export function actionLabel(action) {
  return actionLabels[String(action || '').toLowerCase()] || action;
}
export function actionTypeCounts(capabilities) {
  const counts = new Map();
  for (const c of capabilities) {
    const label = actionLabel(c.capability) || 'Other';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts].map(([label, count]) => `${label === 'View Records' ? 'View' : label} ${count}`).join(' · ');
}

export const executionPolicyLabels = {autonomous:'Autonomous',conditional:'Conditional',human_approval:'Human approval required'};

// Workspace labels describe the canonical capability catalog, not the retained adapter name.
export function capabilityWorkspaceLabel(capabilities = []) {
  return [...new Set(capabilities.map(row => row.workspace).filter(Boolean))].sort().join(' · ');
}
export function agentWorkspaceLabel(agent) {
  return capabilityWorkspaceLabel((agent.business_capabilities || agent.tools || []).filter(row => row.granted)) || agent.workspace || 'Not configured';
}
