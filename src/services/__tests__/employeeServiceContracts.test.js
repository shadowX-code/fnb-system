import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ operations: [], responses: [], audit: vi.fn(), invoke: vi.fn() }));

function respond(operation) {
  mocks.operations.push(operation);
  return Promise.resolve(mocks.responses.shift() ?? { data: null, error: null });
}

function query(table) {
  const operation = { table, method: "select", payload: null, filters: [] };
  const chain = {
    select(fields) { operation.fields = fields; return chain; },
    insert(payload) { operation.method = "insert"; operation.payload = payload; return chain; },
    update(payload) { operation.method = "update"; operation.payload = payload; return chain; },
    eq(column, value) { operation.filters.push([column, value]); return chain; },
    order() { return chain; },
    single() { return respond(operation); },
    maybeSingle() { return respond(operation); },
    then(resolve, reject) { return respond(operation).then(resolve, reject); },
  };
  return chain;
}

vi.mock("../../lib/supabase.ts", () => ({ supabase: { from: vi.fn((table) => query(table)), functions: { invoke: mocks.invoke } } }));
vi.mock("../auditLogService.js", () => ({ auditLogService: { createAuditLog: mocks.audit } }));

import { employeeService } from "../employeeService.js";
import { employeeAuthOnboardingService } from "../employeeAuthOnboardingService.js";

const employeeRow = {
  id: "11111111-1111-4111-8111-111111111111", full_name: "Aisha Rahman", nickname: "Aisha", email: null,
  role_id: null, enable_system_login: false, access_state: "no_access", is_active: true, role: null,
};
const loginEmployee = {
  ...employeeRow, id: "22222222-2222-4222-8222-222222222222", email: "aisha@feedx.test", role_id: "33333333-3333-4333-8333-333333333333",
  auth_user_id: "44444444-4444-4444-8444-444444444444", enable_system_login: true, access_state: "active", role: { id: "33333333-3333-4333-8333-333333333333", name: "Supervisor" },
};

beforeEach(() => {
  mocks.operations.length = 0;
  mocks.responses.length = 0;
  mocks.audit.mockReset().mockResolvedValue(undefined);
  mocks.invoke.mockReset().mockResolvedValue({ data: { ok: true, employee_id: loginEmployee.id, auth_user_id: loginEmployee.auth_user_id, email: loginEmployee.email }, error: null });
});

describe("Employee and Auth lifecycle service contracts", () => {
  it("creates an employee without login access through one employee-row write and best-effort audit", async () => {
    mocks.responses.push({ data: employeeRow, error: null });
    await expect(employeeService.saveEmployee({ full_name: "Aisha Rahman", nickname: "Aisha", contact: "0123456789", enable_system_login: false, employment_status: "active", created_by: "spoofed-actor" })).resolves.toEqual(expect.objectContaining({ id: employeeRow.id, auth_user_id: "", email: "" }));
    expect(mocks.operations).toHaveLength(1);
    expect(mocks.operations[0]).toEqual(expect.objectContaining({ table: "employees", method: "insert", payload: expect.objectContaining({ full_name: "Aisha Rahman", email: null, auth_user_id: null, role_id: null, enable_system_login: false, access_state: "no_access" }) }));
    expect(mocks.operations[0].payload).not.toHaveProperty("created_by");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "employee_created", module: "people", target: "Aisha Rahman" }));
  });

  it("edits the stable employee record while preserving its supplied auth link and login role", async () => {
    mocks.responses.push(
      { data: { id: loginEmployee.id, auth_user_id: loginEmployee.auth_user_id, email: loginEmployee.email }, error: null },
      { data: { ...loginEmployee, contact: "0199999999" }, error: null },
    );
    await employeeService.saveEmployee({ ...loginEmployee, contact: "0199999999", created_by: "spoofed-editor" });
    expect(mocks.operations[1]).toEqual(expect.objectContaining({ table: "employees", method: "update", filters: [["id", loginEmployee.id]], payload: expect.objectContaining({ auth_user_id: loginEmployee.auth_user_id, email: loginEmployee.email, role_id: loginEmployee.role_id, enable_system_login: true }) }));
    expect(mocks.operations[1].payload).not.toHaveProperty("created_by");
  });

  it("normalizes login email before the canonical employee row is persisted", async () => {
    mocks.responses.push({ data: { ...loginEmployee, email: "user@example.com" }, error: null });
    await employeeService.saveEmployee({ ...loginEmployee, id: "", auth_user_id: "", email: " User@Example.com ", access_state: "not_sent" });
    expect(mocks.operations[0].payload.email).toBe("user@example.com");
  });

  it("rejects a linked employee email change before any employee update can silently diverge from Auth", async () => {
    mocks.responses.push({ data: { id: loginEmployee.id, auth_user_id: loginEmployee.auth_user_id, email: loginEmployee.email }, error: null });
    await expect(employeeService.saveEmployee({ ...loginEmployee, email: "different@feedx.test" })).rejects.toThrow("dedicated employee identity change flow");
    expect(mocks.operations).toHaveLength(1);
    expect(mocks.operations[0].method).toBe("select");
  });

  it("surfaces employee-row rejection without a false audit success", async () => {
    mocks.responses.push({ data: null, error: new Error("employee row rejected") });
    await expect(employeeService.saveEmployee({ full_name: "Aisha Rahman", enable_system_login: false })).rejects.toThrow("employee row rejected");
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("targets exactly one onboarding Edge Function request with the persisted employee identity", async () => {
    await expect(employeeAuthOnboardingService.sendLoginSetupEmail(loginEmployee.id)).resolves.toEqual(expect.objectContaining({ employee_id: loginEmployee.id, auth_user_id: loginEmployee.auth_user_id }));
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("employee-auth-onboarding", { body: { employee_id: loginEmployee.id, mode: "email" } });
  });

  it("surfaces onboarding rejection so the caller can preserve retry state", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { ok: false, code: "AUTH_EMAIL_FAILED", message: "email failed" }, error: null });
    await expect(employeeAuthOnboardingService.sendLoginSetupEmail(loginEmployee.id)).rejects.toThrow("email failed");
  });
});
