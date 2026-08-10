import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608100010_data_import_purchase_preparation_authority.sql"), "utf8");

describe("Data Import Purchase preparation migration contract", () => {
  it("provides request-bound canonical preparation with normalized duplicate protection and exact create permissions", () => {
    expect(migration).toContain("purchase_categories_normalized_name_unique");
    expect(migration).toContain("suppliers_normalized_name_unique");
    expect(migration).toContain("create or replace function public.import_prepare_purchase_masters");
    expect(migration).toContain("request_id=p_request_id");
    expect(migration).toContain("purchase_input.import");
    expect(migration).toContain("purchase_categories.create");
    expect(migration).toContain("suppliers.create");
    expect(migration).toContain("current_user_can_access_outlet(v_outlet_id)");
    expect(migration).toContain("jsonb_build_object('request_id',p_request_id,'categories',v_category_map,'suppliers',v_supplier_map)");
  });
});
