import { ArrowLeft, FileText } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import { hasPermission } from "../../../utils/accessControl.js";
import ContractTemplatesWorkspace from "../components/ContractTemplatesWorkspace.jsx";

export default function LegalEntityContractWorkspacePage({ legalEntity, loading, auth, ui, onBack }) {
  const canViewTemplates = hasPermission(auth, "employment_contract_templates.view");
  const canManageTemplates = hasPermission(auth, "employment_contract_templates.manage") && hasPermission(auth, "employee_employment_documents.manage");

  if (loading) return <div className="card p-8 text-center text-sm font-semibold text-text-secondary">Loading Contract Workspace...</div>;
  if (!legalEntity) return <div className="space-y-4"><PageHeader section="People" title="Contract Workspace" description="The requested Legal Entity is unavailable or outside your current scope." actions={<button className="btn-secondary" type="button" onClick={onBack}><ArrowLeft size={16} /> Back to Legal Entities</button>} /><div className="card p-8 text-sm text-text-secondary">Choose an active Legal Entity from the Legal Entities list to author its contract templates.</div></div>;

  return <div className="space-y-4">
    <PageHeader
      section="People"
      title="Contract Workspace"
      description={`${legalEntity.display_name || legalEntity.legal_company_name} · Draft, preview and publish reusable employment contract templates.`}
      actions={<button className="btn-secondary" type="button" onClick={onBack}><ArrowLeft size={16} /> Back</button>}
    />
    {!canViewTemplates ? <div className="card flex items-start gap-3 p-6 text-sm text-text-secondary"><FileText className="mt-0.5 text-text-muted" size={18} /><div><strong className="block text-text-primary">Contract Templates access is required</strong><span className="mt-1 block">You need permission to view contract templates for this Legal Entity.</span></div></div> : <ContractTemplatesWorkspace legalEntity={legalEntity} canManage={canManageTemplates} ui={ui} onBack={onBack} />}
  </div>;
}
