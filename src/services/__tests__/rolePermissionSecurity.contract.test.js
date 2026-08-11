import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const scopeSql = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/202605290002_role_management_rls_scope.sql"), "utf8");
const aliasSql = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/202605290004_roles_permissions_alias.sql"), "utf8");

describe("Roles current server permission-scope contracts", () => {
  it("uses RLS to limit non-protected editors to editable roles, permissions they possess, and outlets they can access", () => {
    expect(scopeSql).toContain("public.role_is_editable_by_current_user(role_id)");
    expect(scopeSql).toContain("public.current_user_can_assign_permission(permission_id)");
    expect(scopeSql).toContain("public.current_user_can_access_outlet(outlet_id)");
    expect(scopeSql).toContain("lower(r.name) not in ('owner', 'admin')");
  });

  it("keeps canonical and legacy role-management permission aliases aligned in server authorization", () => {
    expect(aliasSql).toContain("public.current_user_has_role_management_permission");
    expect(aliasSql).toContain("roles_permissions.");
    expect(aliasSql).toContain("roles.");
  });
});
