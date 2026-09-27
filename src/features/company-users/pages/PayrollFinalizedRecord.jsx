import { useEffect, useState } from "react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import { payrollService } from "../../../services/payrollService.js";
import { ResultDetail } from "./PayrollRunCalculationPanel.jsx";
import { payrollEmployeeResult } from "./payrollRunPresentation.js";
import PayrollEmployeeBankInfo from "./PayrollEmployeeBankInfo.jsx";
import { employeeService } from "../../../services/employeeService.js";
import PayrollPayslipAction from './PayrollPayslipAction.jsx';

const money = value => value == null ? "—" : new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(Number(value));
const deductionTotal = row => row.statutory ? Number(row.calculation?.non_statutory_deductions || 0) + (row.statutory.lines || []).reduce((sum, line) => sum + Number(line.employee_amount || 0), 0) : null;

// This surface deliberately receives no Employee master or draft read models.
export default function PayrollFinalizedRecord({ run, onSnapshot, commandHeader = false }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [retry, setRetry] = useState(0);
  const [banks, setBanks] = useState(null);
  const [bankRetry, setBankRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setRecord(null); setSelected(null); setError("");
    payrollService.readFinalizedRecord(run.id).then(value => { if (active) setRecord(value); })
      .catch(cause => { if (active) setError(cause.message || "Unable to load Payroll record."); });
    return () => { active = false; };
  }, [run.id, retry]);
  useEffect(() => {
    if (record) onSnapshot?.({ runId: run.id, approverName: record.finalized_by_name, rows: (record.results || []).map(row => ({ ...row, needsReview: false,
      result: payrollEmployeeResult(row.calculation && { ...row.calculation, status: "ready", is_stale: false }, row.statutory && { ...row.statutory, status: "ready", is_stale: false }) })) });
  }, [record, run.id, onSnapshot]);
  useEffect(() => {
    let active = true;
    setBanks(null);
    const ids = (record?.results || []).map(row => row.employee_id);
    if (ids.length) employeeService.readBankInfo(ids).then(employees => { if (active) setBanks({ employees }); })
      .catch(() => { if (active) setBanks({ error: true }); });
    return () => { active = false; };
  }, [record, bankRetry]);
  if (error) return <Card className="p-5"><p role="alert">{error}</p><button className="btn-secondary mt-3" onClick={() => setRetry(value => value + 1)}>Retry</button></Card>;
  if (!record) return <Card className="p-5">Loading finalized Payroll record…</Card>;
  const rows = record.results || [];
  const bankFor = row => banks ? { error: banks.error, employee: banks.employees?.find(employee => employee.id === row.employee_id) } : null;
  const total = get => rows.length && rows.every(row => get(row) != null) ? money(rows.reduce((sum, row) => sum + Number(get(row)), 0)) : "—";
  const columns = [
    { key: "employee", header: "Employee", render: row => <strong>{row.employee_name}</strong> },
    { key: "basis", header: "Pay Basis", render: row => row.calculation?.pay_basis === "hourly" ? "Hourly" : row.calculation?.pay_basis === "monthly" ? "Monthly" : "—" },
    { key: "basic", header: "Basic / Hours", render: row => row.calculation?.basic_or_hours || "—" },
    { key: "gross", header: "Gross", align: "right", render: row => money(row.calculation?.gross_earnings) },
    { key: "deductions", header: "Deductions", align: "right", render: row => money(deductionTotal(row)) },
    { key: "statutory", header: "Statutory", render: row => row.statutory ? "Complete" : "Snapshot unavailable" },
    { key: "net", header: "Net Pay", align: "right", render: row => <strong>{money(row.statutory?.net_pay)}</strong> },
    { key: "bank", header: "Bank Info", render: row => <PayrollEmployeeBankInfo result={bankFor(row)} employeeName={row.employee_name} onRetry={() => setBankRetry(value => value + 1)} /> },
    { key: "status", header: "Status", render: () => <Badge tone="success">Finalized</Badge> },
    { key: "action", header: "Action", render: row => row.calculation && row.statutory ? <div className="inline-flex gap-1"><button type="button" className="btn-ghost" onClick={() => setSelected(row)}>View</button><PayrollPayslipAction runId={run.id} employeeId={row.employee_id} /></div> : <span className="text-xs text-text-secondary">Financial snapshot unavailable</span> },
  ];
  return <div className="space-y-4">
    {!commandHeader && <Card className="p-5"><h3 className="text-lg font-bold">Payroll Record</h3>
      <p className="mt-1 text-sm text-text-secondary">Revision {record.run.revision} · Finalized {record.run.finalized_at ? new Date(record.run.finalized_at).toLocaleString() : "—"} · {record.finalized_by_name || "Authorized approver"}. Changes require a Correction Revision.</p>
      <dl className="mt-5 grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {[["Employees", rows.length], ["Gross Payroll", total(row => row.calculation?.gross_earnings)], ["Employee Deductions", total(deductionTotal)], ["Employer Contributions", total(row => row.statutory?.employer_statutory_cost)], ["Net Payroll", total(row => row.statutory?.net_pay)]].map(([name, value]) => <div key={name}><dt className="text-xs text-text-secondary">{name}</dt><dd className="mt-1 font-bold tabular-nums">{value}</dd></div>)}
      </dl>
    </Card>}
    <Card className="overflow-hidden"><DataTable density="compact" columns={columns} rows={rows} getRowKey={row => row.employee_id} /></Card>
    {selected && <ResultDetail result={{ ...selected.calculation, employee_name: selected.employee_name }} statutory={selected.statutory}
      payslip={<PayrollPayslipAction runId={run.id} employeeId={selected.employee_id} />}
      bankInfo={<PayrollEmployeeBankInfo inline result={bankFor(selected)} employeeName={selected.employee_name} onRetry={() => setBankRetry(value => value + 1)} />}
      frozenPeriod={record.period.period_start.slice(0, 7)} onClose={() => setSelected(null)} />}
  </div>;
}
