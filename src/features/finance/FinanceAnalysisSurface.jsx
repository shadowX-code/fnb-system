import { useId } from 'react';
import DashboardSection from '../../components/layout/DashboardSection.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';

/** Local analytical views use the canonical Admin surface and controls. */
export default function FinanceAnalysisSurface({ label, modes, value, onChange, children }) {
  const panelId = useId();
  return <DashboardSection action={modes ? <AdminSegmentedControl label={label} value={value} onChange={onChange} options={modes.map(mode => ({ value: mode, label: mode, panelId }))} /> : null} className="finance-focused-surface" contentClassName="min-w-0">
    <div id={panelId} role={modes ? 'tabpanel' : undefined} aria-label={modes ? value : label} className="min-w-0">{children}</div>
  </DashboardSection>;
}
