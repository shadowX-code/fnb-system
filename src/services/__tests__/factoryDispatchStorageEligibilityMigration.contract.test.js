import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260905034937_factory_dispatch_storage_location_eligibility.sql"), "utf8");
const allocationProjection = readFileSync(resolve(process.cwd(), "supabase/migrations/20260927061441_factory_dispatch_allocation_location_authority.sql"), "utf8");

describe("Factory Dispatch storage eligibility migration", () => {
  it("keeps saved allocation eligibility aligned with discovery and trusted validation", () => {
    expect(allocationProjection).toContain("factory_get_finished_good_dispatch_allocation_details");
    expect(allocationProjection).toContain("and lower(coalesce(location.status, '')) = 'active'");
    expect(allocationProjection).toContain("and coalesce(location.is_storage_location, false)");
    expect(allocationProjection).not.toContain("finished goods area");
    expect(allocationProjection).toContain("security invoker");
    expect(allocationProjection).toContain("current_user_has_permission('factory_finished_goods_dispatch.view')");
    expect(allocationProjection).not.toMatch(/\b(insert into|update public|delete from)\b/i);
  });
  it("moves the Dispatch authority from retired location taxonomy to canonical storage-enabled Locations only", () => {
    expect(migration).toContain("factory_replace_finished_good_dispatch_draft_items");
    expect(migration).toContain("factory_complete_finished_good_dispatch_locked");
    expect(migration).toContain("factory_get_finished_good_batch_availability");
    expect(migration).toContain("coalesce(location.is_storage_location, false)");
    expect(migration).toContain("Storage Location Is Not Storage Enabled");
  });

  it("is a contract-only migration and contains no data mutation statement", () => {
    expect(migration).not.toMatch(/^\s*(insert|update|delete)\s+into\s+public\.(factory_finished_goods|factory_finished_good_batch_balances|factory_finished_good_dispatches)/im);
  });
});
