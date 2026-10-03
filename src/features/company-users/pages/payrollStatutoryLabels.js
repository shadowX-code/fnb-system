export const statutorySchemes = ['epf', 'socso', 'lindung', 'eis', 'pcb'];
export const statutoryName = scheme => scheme === 'lindung' ? 'LINDUNG 24 Jam' : scheme === 'pcb' ? 'PCB / MTD' : scheme.toUpperCase();
export const lindungStatusLabel = status => ({ not_applicable: 'Not Applicable', mandatory: 'Mandatory', participating: 'Participating', valid_opt_out: 'Valid Opt-Out',
  another_designated_employer: 'Another Designated Employer', before_scheme: 'Not Applicable · before June 2026', unresolved: 'Unresolved' }[status] || 'Unresolved');

export const statutoryCategories = {
  epf: [{value:'malaysian_under_60',label:'Malaysian · under 60'},{value:'malaysian_60_to_74',label:'Malaysian · 60–74'}],
  socso: [{value:'first_category_base',label:'Act 4 · First Category'},{value:'second_category_base',label:'Act 4 · Second Category'}],
  eis: [{value:'standard',label:'Standard'}],
};
const categories = statutoryCategories;
export const statutorySchemeLabel = (scheme, state) => {
  if (scheme === 'lindung') return state?.issue ? 'Evidence Required' : lindungStatusLabel(state?.status);
  if (state?.state === 'confirmation_required') return 'Confirmation Required';
  if (state?.state === 'not_applicable') return 'Not Applicable';
  if (state?.state !== 'confirmed' && state?.state !== 'scheduled') return 'Setup Required';
  if (state.applicable === false) return 'Not Applicable';
  if (scheme === 'pcb') return 'Applicable · monthly confirmation';
  return categories[scheme]?.find(c=>c.value===state.category)?.label || 'Confirmed';
};
