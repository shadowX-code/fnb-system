import { ArrowRight, ChartNoAxesCombined, Layers3, Landmark, FileText } from 'lucide-react';
import DashboardSection from '../../components/layout/DashboardSection.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import { navigateAdminRoute } from '../../app/routeOwnership.js';

const sourcesAction = <button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('finance_data_sources')}>Review Data Sources <ArrowRight size={15}/></button>;
export function FinancePlanningReadiness() {
  const prerequisites = [
    {title:'Forecasting', icon:ChartNoAxesCombined, description:'Validated monthly history, opening balances and explicit forecast assumptions.'},
    {title:'Scenarios', icon:Layers3, description:'A validated baseline, scenario assumptions and an approved model.'},
    {title:'Capital Allocation', icon:Landmark, description:'Authoritative cash, debt and commitments, plus investment evidence.'},
  ];
  return <div className="grid min-w-0 gap-6">
    <DashboardSection title="Planning readiness" subtitle="Evidence and models must be validated before planning can begin." action={<StatusBadge status="neutral">Not available</StatusBadge>}>
      <p className="type-body-sm text-text-secondary">Forecasting, Scenarios and Capital Allocation are not implemented. Review financial evidence before establishing a planning baseline.</p><div className="mt-4">{sourcesAction}</div>
    </DashboardSection>
    <div className="grid min-w-0 gap-6 lg:grid-cols-3">{prerequisites.map(({title,icon:Icon,description}) => <DashboardSection key={title} title={title} action={<Icon size={18} className="text-text-secondary" aria-hidden="true"/>}><StatusBadge status="neutral">Prerequisites required</StatusBadge><p className="mt-3 type-body-sm leading-relaxed text-text-secondary">{description}</p></DashboardSection>)}</div>
  </div>;
}
export function FinanceStatements() {
  return <div className="grid min-w-0 gap-6 lg:grid-cols-3">
    <DashboardSection title="Profit & Loss" subtitle="Operational management reporting" action={<FileText size={18} aria-hidden="true" className="text-text-secondary"/>}>
      <StatusBadge status="info">Operational reporting available</StatusBadge><p className="my-4 type-body-sm leading-relaxed text-text-secondary">Monthly and Yearly/YTD management P&L remain owned by Reporting. Purchase-based COGS retains its operational basis.</p><button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('reports')}>Open Monthly / Yearly P&L <ArrowRight size={15}/></button>
    </DashboardSection>
    {[{title:'Balance Sheet', description:'Requires a validated provider statement or authoritative account balances.'},{title:'Cash Flow',description:'Requires validated accounting cash flows and cash-flow classifications.'}].map(item => <DashboardSection key={item.title} title={item.title} subtitle="Accounting statement"><StatusBadge status="neutral">Accounting evidence not ready</StatusBadge><p className="my-4 type-body-sm leading-relaxed text-text-secondary">{item.description}</p>{sourcesAction}</DashboardSection>)}
  </div>;
}
