export const statutorySchemes = ['epf', 'socso', 'lindung', 'eis', 'pcb'];
export const statutoryName = scheme => scheme === 'lindung' ? 'LINDUNG 24 Jam' : scheme === 'pcb' ? 'PCB / MTD' : scheme.toUpperCase();
export const lindungStatusLabel = status => ({ mandatory: 'Mandatory', participating: 'Participating', valid_opt_out: 'Valid Opt-Out',
  another_designated_employer: 'Another Designated Employer', before_scheme: 'Not Applicable · before June 2026', unresolved: 'Unresolved' }[status] || 'Unresolved');
