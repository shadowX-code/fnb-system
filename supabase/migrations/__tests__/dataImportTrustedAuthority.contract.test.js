import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608100009_data_import_trusted_authority_phase_1.sql"), "utf8");

describe("Data Import trusted authority migration contract", () => {
  it("makes request and authoritative row outcome identities unique and exposes only the required trusted boundaries", () => {
    expect(migration).toContain("import_batches_request_id_unique");
    expect(migration).toContain("import_batch_rows_request_key_unique");
    expect(migration).toContain("create or replace function public.import_begin_request");
    expect(migration).toContain("create or replace function public.import_apply_sales_row");
    expect(migration).toContain("create or replace function public.import_apply_purchase_row");
    expect(migration).toContain("create or replace function public.import_finalize_batch");
    expect(migration).toContain("current_user_has_permission('sales_input.import')");
    expect(migration).toContain("current_user_has_permission('purchase_input.import')");
    expect(migration).toContain("current_user_can_access_outlet(v_outlet_id)");
    expect(migration).toContain("status=v_status");
  });
});
