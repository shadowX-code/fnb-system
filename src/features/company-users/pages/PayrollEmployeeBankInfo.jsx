import { useState } from "react";
import { Landmark, TriangleAlert } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import { hasCompleteEmployeeBankInfo } from "../../../constants/malaysiaBanks.js";
import { canonicalPathForRoute } from "../../../app/routeOwnership.js";

// Current bank data remains Employee-owned and informational, not Payroll readiness.
export default function PayrollEmployeeBankInfo({ result, employeeName, onRetry, inline = false, canEdit = false }) {
  const [open, setOpen] = useState(false);
  if (!result) return <span className="text-xs text-text-secondary">Loading…</span>;
  if (result.error) return <button type="button" className="text-xs font-semibold text-primary"
    aria-label={`Retry bank information for ${employeeName}`} title="Unable to load Bank Details. Retry."
    onClick={event => { event.stopPropagation(); onRetry(); }}>Retry</button>;
  if (!result.employee) return <span className="text-xs text-text-secondary" title="Employee bank information is outside your visible Employee scope.">Unavailable</span>;
  const complete = hasCompleteEmployeeBankInfo(result.employee);
  const details = <><dl className="divide-y divide-border text-sm">{[["Bank", result.employee.bank_name],
    ["Account Name", result.employee.bank_account_name], ["Account Number", result.employee.bank_account_number]].map(([label, value]) =>
    <div key={label} className="py-3"><dt className="text-text-secondary">{label}</dt><dd className="mt-1 break-words font-semibold text-text-primary">{value || "Not provided"}</dd></div>)}</dl>
    {!complete && <p className="mt-3 text-sm text-amber-800">Bank details are incomplete. This does not block Payroll finalization.</p>}
    <p className="mt-3 text-xs text-text-secondary">Current Employee bank details. Payment is separate from Payroll finalization.</p>
    {canEdit && result.employee.id && <a className="btn-secondary mt-3 inline-flex" target="_blank" rel="noreferrer"
      href={`${canonicalPathForRoute("employees")}?employee=${encodeURIComponent(result.employee.id)}&section=bank`}>{complete ? "Edit Bank Details" : "Add Bank Details"}</a>}</>;
  if (inline) return <div>{details}</div>;
  return <span onClick={event => event.stopPropagation()}>
    <button className={`icon-btn ${complete ? "" : "text-amber-700"}`} type="button" aria-label={`View bank information for ${employeeName}${complete ? "" : " — incomplete"}`} title={complete ? "Bank Details" : "Bank Details incomplete"}
      onClick={event => { event.stopPropagation(); setOpen(true); }}>{complete ? <Landmark size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}</button>
    {open && <Modal title="Bank Details" description={employeeName} size="sm" onClose={() => setOpen(false)}
      footer={<button className="btn-secondary" type="button" onClick={() => setOpen(false)}>Close</button>}>
      {details}
    </Modal>}
  </span>;
}
