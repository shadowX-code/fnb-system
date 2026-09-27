import { useState } from "react";
import { Eye } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import { hasCompleteEmployeeBankInfo } from "../../../constants/malaysiaBanks.js";

export default function PayrollEmployeeBankInfo({ result, employeeName, onRetry }) {
  const [open, setOpen] = useState(false);
  if (!result) return <span className="text-xs text-text-secondary">Loading…</span>;
  if (result.error) return <button type="button" className="text-xs font-semibold text-primary"
    aria-label={`Retry bank information for ${employeeName}`} title="Unable to load Bank Info. Retry."
    onClick={event => { event.stopPropagation(); onRetry(); }}>Retry</button>;
  if (!result.employee) return <span className="text-xs text-text-secondary" title="Employee bank information is outside your visible Employee scope.">Unavailable</span>;
  if (!hasCompleteEmployeeBankInfo(result.employee)) return <span className="text-xs text-text-secondary">Missing</span>;
  return <span onClick={event => event.stopPropagation()}>
    <button className="icon-btn" type="button" aria-label={`View bank information for ${employeeName}`} title="View Bank Info"
      onClick={event => { event.stopPropagation(); setOpen(true); }}><Eye size={16} aria-hidden="true" /></button>
    {open && <Modal title="Bank Info" description={employeeName} size="sm" onClose={() => setOpen(false)}
      footer={<button className="btn-secondary" type="button" onClick={() => setOpen(false)}>Close</button>}>
      <dl className="divide-y divide-border text-sm">{[["Bank", result.employee.bank_name],
        ["Account Name", result.employee.bank_account_name], ["Account Number", result.employee.bank_account_number]].map(([label, value]) =>
        <div key={label} className="py-3"><dt className="text-text-secondary">{label}</dt><dd className="mt-1 break-words font-semibold text-text-primary">{value}</dd></div>)}</dl>
      <p className="mt-3 text-xs text-text-secondary">Current Employee bank information · read-only.</p>
    </Modal>}
  </span>;
}
