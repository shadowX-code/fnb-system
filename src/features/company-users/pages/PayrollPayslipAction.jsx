import { useEffect, useRef, useState } from 'react';
import { payrollService } from '../../../services/payrollService.js';
import Modal from '../../../components/feedback/Modal.jsx';
import { FileText } from 'lucide-react';

// Both row actions share private document access and the canonical PDF layout.
export default function PayrollPayslipAction({ runId, employeeId, draft = false }) {
  const [pdf, setPdf] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [open, setOpen] = useState(false);
  const request = useRef(0), transient = useRef(null);
  const release = () => { if (transient.current) URL.revokeObjectURL(transient.current); transient.current = null; };
  useEffect(() => () => { request.current += 1; release(); }, [runId, employeeId, draft]);
  const close = () => { request.current += 1; release(); setOpen(false); setPdf(null); setBusy(false); };
  async function load() {
    const id = ++request.current;
    release(); setPdf(null); setError(''); setOpen(true); setBusy(true);
    try {
      const value = await payrollService.openPayslip({ runId, employeeId, draft });
      if (id !== request.current) { if (value.transient) URL.revokeObjectURL(value.document_url); return; }
      if (value.transient) transient.current = value.document_url;
      setPdf(value);
    } catch (cause) { if (id === request.current) setError(cause.message); }
    finally { if (id === request.current) setBusy(false); }
  }
  const title = draft ? 'Draft Payslip' : 'Payslip';
  return <>
    <button type="button" className="btn-secondary" disabled={busy} onClick={event => { event.stopPropagation(); load(); }}>{!draft && <FileText size={16} aria-hidden="true" />}{title}</button>
    {open && <Modal title={title} size="xl" description={draft ? 'DRAFT · NOT FINAL · Admin preview of the current calculation.' : 'Private document from the finalized Payroll snapshot.'}
      onClose={close} footer={<button type="button" className="btn-secondary" onClick={close}>Close</button>}>
      {busy && <p role="status">Opening payslip…</p>}
      {error && <div role="alert"><p>{error}</p><button className="btn-secondary mt-3" onClick={load}>Retry</button></div>}
      {pdf && <><a className="font-semibold text-primary" href={pdf.download_url || pdf.document_url} target="_blank" rel="noreferrer">Open {title}</a>
        <iframe title={title} className="mt-3 h-[60vh] w-full border border-border" src={pdf.document_url} />
        {!draft && <p className="mt-2 text-xs text-text-secondary">Private access expires after one minute. Reopen Payslip to renew it.</p>}</>}
    </Modal>}
  </>;
}
