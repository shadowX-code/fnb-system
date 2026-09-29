import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

export const employeeEmploymentService = {
  async read(employeeId, asOf = null) {
    const { data, error } = await supabase.rpc("employee_employment_assignment_read", {
      p_employee_id: employeeId,
      p_on: asOf,
    });
    throwSupabaseError("employeeEmployment.read", error);
    return data;
  },

  async save({ employeeId, effectiveFrom, assignment, reason, expectedRevisionId, evidenceReference = null }) {
    const { data, error } = await supabase.rpc("employee_employment_assignment_save", {
      p_employee_id: employeeId,
      p_effective_from: effectiveFrom,
      p_assignment: assignment,
      p_reason: reason,
      p_expected_revision_id: expectedRevisionId,
      p_evidence_reference: evidenceReference,
    });
    throwSupabaseError("employeeEmployment.save", error);
    return data;
  },
};
