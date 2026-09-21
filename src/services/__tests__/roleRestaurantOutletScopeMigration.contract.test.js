import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921180000_factory_employee_workplace_role_outlet_scope.sql"), "utf8");

describe("Restaurant-only Role Outlet Access contract", () => {
  it("classifies permissions server-side and records no outlet scope for Factory-only roles", () => {
    expect(sql).toContain("requires_restaurant_outlet_scope boolean not null default true");
    expect(sql).toContain("outlet_access_type in ('all', 'selected', 'none')");
    expect(sql).toContain("permission.requires_restaurant_outlet_scope");
    expect(sql).toContain("v_outlet_access_type := 'none'");
  });

  it("requires Restaurant scope only when Restaurant permissions are present", () => {
    expect(sql).toContain("Restaurant permissions require All Outlets or Selected Outlets access.");
    expect(sql).toContain("Select at least one outlet for Restaurant permissions.");
    expect(sql).toContain("Outlet Access is not applicable when a role has no Restaurant permissions.");
  });
});
