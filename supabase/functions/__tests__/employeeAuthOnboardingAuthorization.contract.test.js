import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "supabase/functions/employee-auth-onboarding/index.ts"), "utf8");

describe("Employee onboarding authorization contract", () => {
  it("selects the required employee-login permission from the authoritative employee access state", () => {
    const employeeLookup = source.indexOf('.from("employees")');
    const accessState = source.indexOf('const accessState = String(employee.access_state');
    const permissionCheck = source.indexOf('permission_code: requiredPermission');

    expect(employeeLookup).toBeGreaterThan(-1);
    expect(accessState).toBeGreaterThan(employeeLookup);
    expect(permissionCheck).toBeGreaterThan(accessState);
    expect(source).toContain('const requiredPermission = requiresResetPermission ? "employees.reset_password" : "employees.enable_login";');
    expect(source).not.toContain('permission_code: "roles.edit"');
  });

  it("retains canonical identity and concurrent-link protections around the narrow authorization change", () => {
    expect(source).toContain("normalizeEmail(linkedResult.user.email) !== email");
    expect(source).toContain("This Auth account is already linked to a different employee.");
    expect(source).toContain("auth_user_id.is.null,auth_user_id.eq.${authUser.id}");
    expect(source).toContain('code: "IDENTITY_CONFLICT"');
  });
});
