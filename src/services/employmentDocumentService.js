import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

async function invokeDocument(body) {
  const { data, error } = await supabase.functions.invoke("employee-employment-documents", { body });
  if (error) throw new Error(data?.error || "Employment document is unavailable.");
  if (data?.error) throw new Error(data.error);
  return data;
}

export const employmentContractTemplateService = {
  async list(legalEntityId) {
    const { data, error } = await supabase.rpc("employment_contract_templates_for_legal_entity", { p_legal_entity_id: legalEntityId });
    throwSupabaseError("employmentContractTemplates.list", error);
    return data ?? [];
  },
  async save(templateId, payload) {
    const { data, error } = await supabase.rpc("employment_contract_template_save", { p_template_id: templateId || null, p_payload: payload });
    throwSupabaseError("employmentContractTemplates.save", error);
    return data;
  },
  async publish(templateId, versionId) {
    const { data, error } = await supabase.rpc("employment_contract_template_publish", { p_template_id: templateId, p_version_id: versionId });
    throwSupabaseError("employmentContractTemplates.publish", error);
    return data;
  },
  async previewEmployees(legalEntityId) {
    const { data, error } = await supabase.rpc("employment_contract_template_preview_employees", { p_legal_entity_id: legalEntityId });
    throwSupabaseError("employmentContractTemplates.previewEmployees", error);
    return data ?? [];
  },
  async previewDraft({ legalEntityId, employeeId, template }) {
    return invokeDocument({ action: "template_preview", legal_entity_id: legalEntityId, employee_id: employeeId, template });
  },
};

export const employmentDocumentService = {
  async adminDetail(employeeId) {
    const { data, error } = await supabase.rpc("employee_employment_documents_admin_detail", { p_employee_id: employeeId });
    throwSupabaseError("employmentDocuments.detail", error);
    return data ?? { legal_employer: null, documents: [] };
  },
  async saveDraft({ documentId = null, employeeId, title, effectiveDate, requestId, supersedesDocumentId = null }) {
    const { data, error } = await supabase.rpc("employee_employment_document_save_draft", {
      p_document_id: documentId,
      p_employee_id: employeeId,
      p_payload: { title, effective_date: effectiveDate },
      p_request_id: requestId,
      p_supersedes_document_id: supersedesDocumentId,
    });
    throwSupabaseError("employmentDocuments.saveDraft", error);
    return data;
  },
  async saveTemplateDraft({ documentId = null, employeeId, title, effectiveDate, templateVersionId, terms, requestId, supersedesDocumentId = null }) {
    const { data, error } = await supabase.rpc("employee_employment_contract_save_draft", {
      p_document_id: documentId,
      p_employee_id: employeeId,
      p_payload: { title, effective_date: effectiveDate, template_version_id: templateVersionId, terms },
      p_request_id: requestId,
      p_supersedes_document_id: supersedesDocumentId,
    });
    throwSupabaseError("employmentDocuments.saveTemplateDraft", error);
    return data;
  },
  async upload({ documentId, requestId, file }) {
    const form = new FormData();
    form.append("document_id", documentId);
    form.append("request_id", requestId);
    form.append("file", file, file.name || "employment-contract.pdf");
    return invokeDocument(form);
  },
  async send(documentId) {
    const { data, error } = await supabase.rpc("employee_employment_document_send", { p_document_id: documentId });
    throwSupabaseError("employmentDocuments.send", error);
    return data;
  },
  async withdraw(documentId, reason) {
    const { data, error } = await supabase.rpc("employee_employment_document_withdraw", { p_document_id: documentId, p_reason: reason });
    throwSupabaseError("employmentDocuments.withdraw", error);
    return data;
  },
  async adminRead(documentId) { return invokeDocument({ action: "admin_read", document_id: documentId }); },
  async previewTemplateContract(documentId) { return invokeDocument({ action: "contract_preview", document_id: documentId }); },
  async crewList(token) {
    const { data, error } = await supabase.rpc("crew_employee_employment_documents", { p_token: token });
    throwSupabaseError("employmentDocuments.crewList", error);
    return data ?? { documents: [] };
  },
  async crewOpen(token, documentId) { return invokeDocument({ action: "crew_read", token, document_id: documentId }); },
  async crewComplete(token, documentId, requestId) {
    const { data, error } = await supabase.rpc("crew_employee_employment_document_complete", { p_token: token, p_document_id: documentId, p_request_id: requestId });
    throwSupabaseError("employmentDocuments.crewComplete", error);
    return data;
  },
};
