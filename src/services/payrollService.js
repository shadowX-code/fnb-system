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
  readStatutoryInput: (profileId) => command("payroll_statutory_input_read", { p_profile_id: profileId }),
  reviewStatutoryInput: (input) => command("payroll_statutory_input_adjust", {
    p_profile_id: input.profileId,
    p_effective_from: input.effectiveFrom,
    p_epf_category: input.epfCategory || null,
    p_socso_category: input.socsoCategory || null,
    p_eis_category: input.eisCategory || null,
    p_pcb_inputs: {},
    p_source_note: input.sourceNote,
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
    p_legal_entity_id: null,
    p_state_code: input.stateCode || null,
    p_outlet_id: input.outletId || null,
  }),
  readHolidayApplicability: (id) => command("payroll_holiday_applicability_read", { p_holiday_id: id }),
  readHolidayHistory: (id) => command("payroll_holiday_history_read", { p_holiday_id: id }),
  updateHoliday: (input) => command("payroll_holiday_update", {
    p_holiday_id: input.id, p_holiday_date: input.date, p_name: input.name,
    p_scope: input.scope, p_source_note: input.sourceNote,
    p_state_code: input.stateCode || null, p_outlet_id: input.outletId || null,
    p_is_active: input.active, p_reason: input.reason,
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
  updateComponent: (input) => command("payroll_component_update", {
    p_component_id: input.id,
    p_name: input.name,
    p_epf_treatment: input.epf,
    p_socso_treatment: input.socso,
    p_eis_treatment: input.eis,
    p_pcb_treatment: input.pcb,
    p_is_active: input.active,
    p_source_note: input.sourceNote,
    p_reason: input.reason,
  }),
  readComponentHistory: (id) => command("payroll_component_history_read", { p_component_id: id }),
  createRun: (input) => command("payroll_run_create", {
    p_legal_entity_id: input.legalEntityId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_reason: input.reason,
    p_supersedes_run_id: input.supersedesRunId || null,
  }),
  readRunHistory: (legalEntityId) => command("payroll_run_history_read", { p_legal_entity_id: legalEntityId }),
  transitionRun: (runId, nextStatus, reason) =>
    command("payroll_run_transition", { p_run_id: runId, p_next_status: nextStatus, p_reason: reason }),
  readTime: (legalEntityId, from, to) => command("payroll_time_read", {
    p_legal_entity_id: legalEntityId, p_from: from, p_to: to,
  }),
  reconcileTime: (legalEntityId, from, to) => command("payroll_time_reconcile", {
    p_legal_entity_id: legalEntityId, p_from: from, p_to: to,
  }),
  decideTime: ({ id, action, approvedMinutes, extraMinutes, classification, reason }) =>
    command("payroll_time_decide", {
      p_time_version_id: id, p_action: action, p_approved_minutes: approvedMinutes,
      p_extra_minutes: extraMinutes, p_classification: classification, p_reason: reason,
    }),
  runTimeReadiness: (runId) => command("payroll_run_time_readiness", { p_run_id: runId }),
  calculateRun: (runId) => command("payroll_run_calculate", { p_run_id: runId }),
  readCalculation: (runId) => command("payroll_run_calculation_read", { p_run_id: runId }),
  calculationReadiness: (runId) => command("payroll_run_calculation_readiness", { p_run_id: runId }),
  calculateStatutory: (runId) => command("payroll_run_statutory_calculate", { p_run_id: runId }),
  readStatutory: (runId) => command("payroll_run_statutory_read", { p_run_id: runId }),
  statutoryReadiness: (runId) => command("payroll_run_statutory_readiness", { p_run_id: runId }),
  readPcb: (runId) => command("payroll_run_pcb_read", { p_run_id: runId }),
  confirmPcb: (input) => command("payroll_run_pcb_confirm", {
    p_request_id: input.requestId,
    p_run_id: input.runId,
    p_employee_id: input.employeeId,
    p_amount: Number(input.amount),
    p_source_reference: input.sourceReference || null,
    p_note: input.note || null,
    p_reason: input.reason,
  }),
  readRules: () => command("payroll_rule_read", {}),
  publishRule: (input) => command("payroll_rule_publish", {
    p_rule_code: input.ruleCode,
    p_pay_basis: input.payBasis,
    p_effective_from: input.effectiveFrom,
    p_multiplier: Number(input.multiplier),
    p_monthly_divisor_minutes: input.payBasis === "monthly" && !["monthly_basic", "non_payable"].includes(input.ruleCode)
      ? Number(input.monthlyDivisorMinutes) : null,
    p_source_note: input.sourceNote,
    p_reason: input.reason,
  }),
  addRunComponent: (input) => command("payroll_run_component_add", {
    p_request_id: input.requestId,
    p_run_id: input.runId,
    p_employee_id: input.employeeId,
    p_component_id: input.componentId,
    p_amount: Number(input.amount),
    p_reason: input.reason,
  }),
  reverseRunComponent: (input) => command("payroll_run_component_reverse", {
    p_request_id: input.requestId,
    p_adjustment_id: input.adjustmentId,
    p_reason: input.reason,
  }),
};
