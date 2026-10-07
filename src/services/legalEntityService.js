import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

// Database nulls are empty form values; the save RPC retains optional-null semantics.
export function normalizeLegalEntityFields(entity = {}) {
  const normalized = { ...entity };
  for (const field of ["legal_company_name", "company_registration_no", "registered_address", "display_name"]) {
    normalized[field] = (entity[field] ?? "").trim();
  }
  return normalized;
}

// Legal Entities are People master data. Employment Documents only consume this
// service; they do not own a second representation of the legal employer.
export const legalEntityService = {
  async list() {
    const { data, error } = await supabase.rpc("legal_entity_list");
    throwSupabaseError("legalEntities.list", error);
    return data ?? [];
  },
  async save(legalEntity) {
    const { data, error } = await supabase.rpc("legal_entity_save", {
      p_legal_entity_id: legalEntity.id || null,
      p_payload: normalizeLegalEntityFields(legalEntity),
    });
    throwSupabaseError("legalEntities.save", error);
    return data;
  },
};
