import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

async function command(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  throwSupabaseError(name, error);
  return data;
}

// Payroll is the only owner of compensation and run commands. Employee and
// Employment Document services remain read/provenance sources, not writers here.
export const payrollService = {
  read: (profileId = null, periodId = null) =>
    command("payroll_foundation_read", { p_profile_id: profileId, p_period_id: periodId }),
  createProfile: (input) => command("payroll_profile_create", {
    p_employee_id: input.employeeId,
    p_effective_from: input.effectiveFrom,
    p_pay_basis: input.payBasis,
    p_rate: input.rate,
    p_currency: input.currency || "MYR",
    p_reason: input.reason,
    p_source_document_id: input.sourceDocumentId || null,
    p_default_cost_outlet_id: input.defaultCostOutletId || null,
    p_epf: input.epf ?? null,
    p_socso: input.socso ?? null,
    p_eis: input.eis ?? null,
    p_pcb: input.pcb ?? null,
  }),
  adjustCompensation: (input) => command("payroll_compensation_adjust", {
    p_profile_id: input.profileId,
    p_effective_from: input.effectiveFrom,
    p_pay_basis: input.payBasis,
    p_rate: input.rate,
    p_currency: input.currency || "MYR",
    p_reason: input.reason,
    p_source_document_id: input.sourceDocumentId || null,
    p_default_cost_outlet_id: input.defaultCostOutletId || null,
  }),
  adjustStatutory: (input) => command("payroll_statutory_adjust", {
    p_profile_id: input.profileId,
    p_effective_from: input.effectiveFrom,
    p_epf: input.epf ?? null,
    p_socso: input.socso ?? null,
    p_eis: input.eis ?? null,
    p_pcb: input.pcb ?? null,
    p_reason: input.reason,
  }),
  adjustRecurring: (input) => command("payroll_recurring_adjust", {
    p_profile_id: input.profileId,
    p_component_id: input.componentId,
    p_effective_from: input.effectiveFrom,
    p_amount: input.active ? input.amount : 0,
    p_is_active: Boolean(input.active),
    p_reason: input.reason,
  }),
  addHoliday: (input) => command("payroll_holiday_save", {
    p_holiday_date: input.date,
    p_name: input.name,
    p_scope: input.scope,
    p_source_note: input.sourceNote,
    p_legal_entity_id: input.legalEntityId,
    p_state_code: input.stateCode || null,
    p_outlet_id: input.outletId || null,
  }),
  createComponent: (input) => command("payroll_component_create", {
    p_code: input.code,
    p_name: input.name,
    p_component_type: input.type,
    p_epf_treatment: input.epf,
    p_socso_treatment: input.socso,
    p_eis_treatment: input.eis,
    p_pcb_treatment: input.pcb,
    p_reason: input.reason,
  }),
  createRun: (input) => command("payroll_run_create", {
    p_legal_entity_id: input.legalEntityId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_reason: input.reason,
    p_supersedes_run_id: input.supersedesRunId || null,
  }),
  transitionRun: (runId, nextStatus, reason) =>
    command("payroll_run_transition", { p_run_id: runId, p_next_status: nextStatus, p_reason: reason }),
};
