import { canonicalPathForRoute } from '../../../app/routeOwnership.js';
import { payrollIssueLabel } from './payrollRunPresentation.js';

// Only link records the canonical period read identifies; never infer members
// from today's employer/status or from the run-wide pre-cutover date range.
export function employmentHistoryRecords(preparation) {
  return (preparation?.results || []).filter(row => {
    const evidence = row.employment || row.projection?.inputs?.employment_assignment;
    return row.employee_id && evidence?.state === 'review_required'
      && ['employment_history_unresolved', 'employment_joined_date_missing', 'employment_assignment_requires_review'].includes(evidence.issue?.split(':')[0]);
  });
}
export default function PayrollEmploymentHistoryRequired({ issue, preparation, employees = [], canEditEmployee = false, heading = true }) {
  if (!issue) return null;
  const records = employmentHistoryRecords(preparation);
  return <div className="space-y-2 text-sm">
    {heading && <strong>Employment History Required</strong>}
    <p>{payrollIssueLabel(issue)}</p>
    <p>Verified employment for the payroll-period dates is required to determine which employees belong in this Payroll Run.</p>
    {records.length ? <ul className="space-y-2">{records.map(row => {
      const employee = employees.find(item => item.id === row.employee_id);
      const name = employee?.name || employee?.full_name || row.employee_name || 'Employee';
      return <li key={row.employee_id}><span>{name}</span>{canEditEmployee && <a className="ml-2 font-semibold text-primary hover:underline"
        href={`${canonicalPathForRoute('employees')}?employee=${encodeURIComponent(row.employee_id)}&section=employment`}
        target="_blank" rel="noreferrer" aria-label={`Resolve Employment History for ${name}`}>Resolve →</a>}</li>;
    })}</ul> : <p className="text-text-secondary">Verify historical assignments in People → Employees → Employment.</p>}
  </div>;
}
