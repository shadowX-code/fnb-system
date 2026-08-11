import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ operations: [], responses: [], rpc: vi.fn() }));

function respond(operation) {
  mocks.operations.push(operation);
  return Promise.resolve(mocks.responses.shift() ?? { data: null, error: null });
}

function query(table) {
  const operation = { table, method: "select", filters: [] };
  const chain = {
    select(fields) { operation.fields = fields; return chain; },
    update(payload) { operation.method = "update"; operation.payload = payload; return chain; },
    or(value) { operation.filters.push(["or", value]); return chain; },
    eq(column, value) { operation.filters.push(["eq", column, value]); return chain; },
    maybeSingle() { return respond(operation); },
    single() { return respond(operation); },
    then(resolve, reject) { return respond(operation).then(resolve, reject); },
  };
  return chain;
}

vi.mock("../../lib/supabase.ts", () => ({ supabase: { from: vi.fn((table) => query(table)), rpc: mocks.rpc, auth: {} } }));

import { authService } from "../authService.js";

const user = { id: "11111111-1111-4111-8111-111111111111", email: "crew@feedx.test" };

beforeEach(() => {
  mocks.operations.length = 0;
  mocks.responses.length = 0;
  mocks.rpc.mockReset();
});

describe("Auth employee identity compatibility contracts", () => {
  it("uses auth-user identity before legacy employee-ID and normalized-email compatibility fallbacks", async () => {
    mocks.responses.push({ data: { id: "employee-1", auth_user_id: user.id, email: user.email, enable_system_login: true, access_state: "disabled", is_active: false, role: null }, error: null });
    await expect(authService.getUserContext(user)).rejects.toThrow("Employee profile is inactive.");
    expect(mocks.operations[0]).toEqual(expect.objectContaining({
      table: "employees", method: "select",
      filters: [["eq", "auth_user_id", user.id]],
    }));
    expect(mocks.operations.filter((operation) => operation.method === "update")).toHaveLength(0);
  });

  it("keeps a disabled employee session from loading permissions or touching the active-login timestamp", async () => {
    mocks.responses.push({ data: { id: "employee-1", auth_user_id: user.id, email: user.email, enable_system_login: true, access_state: "disabled", is_active: false, role: { name: "Crew" } }, error: null });
    await expect(authService.getUserContext(user)).rejects.toThrow("Employee profile is inactive.");
    expect(mocks.operations.map((operation) => operation.table)).toEqual(["employees"]);
  });

  it("uses normalized email only after linked and legacy employee-ID lookups are empty", async () => {
    mocks.responses.push(
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "employee-1", auth_user_id: null, email: user.email, enable_system_login: true, access_state: "disabled", is_active: false, role: null }, error: null },
    );
    await expect(authService.getUserContext({ ...user, email: " Crew@FeedX.Test " })).rejects.toThrow("Employee profile is inactive.");
    expect(mocks.operations.map((operation) => operation.filters)).toEqual([
      [["eq", "auth_user_id", user.id]],
      [["eq", "id", user.id]],
      [["eq", "email", "crew@feedx.test"]],
    ]);
  });

  it("completes password setup only through the narrow server RPC before loading the active employee profile", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    mocks.responses.push({ data: { id: "employee-1", auth_user_id: user.id, email: user.email, enable_system_login: true, access_state: "active", is_active: true, role: { name: "Crew" } }, error: null });
    await expect(authService.completeEmployeePasswordSetup(user)).resolves.toEqual(expect.objectContaining({ id: "employee-1", access_state: "active" }));
    expect(mocks.rpc).toHaveBeenCalledWith("complete_employee_password_setup");
  });
});
