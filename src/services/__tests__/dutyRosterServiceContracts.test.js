import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), getUser: vi.fn(), audit: vi.fn() }));

vi.mock("../../lib/supabase", () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc, auth: { getUser: mocks.getUser } },
}));
vi.mock("../auditLogService.js", () => ({ auditLogService: { createAuditLog: mocks.audit } }));

import { dutyRosterService } from "../dutyRosterService.js";

function query(result, calls) {
  const chain = {};
  ["select", "eq", "gte", "lte", "order", "upsert", "update", "delete", "single"].forEach((method) => {
    chain[method] = vi.fn((...args) => { calls.push([method, ...args]); return chain; });
  });
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function queueQueries(...responses) {
  const calls = [];
  mocks.from.mockImplementation((table) => {
    calls.push(["from", table]);
    return query(responses.shift(), calls);
  });
  return calls;
}

const outletId = "outlet-1";
const template = { id: "template-1", outlet_id: outletId, name: "Morning", code: "MORNING", start_time: "09:00", end_time: "17:00", break_minutes: 60, shift_type: "working", color: "green" };
const sourceRow = { id: "source-1", outlet_id: outletId, employee_id: "employee-1", roster_date: "2026-08-03", shift_template_id: template.id, start_time: "09:00", end_time: "17:00", break_minutes: 60, status: "draft", remark: "", created_at: "created", updated_at: "created", shift_template: template };

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: "auth-1" } } });
  mocks.audit.mockReset().mockResolvedValue(undefined);
});

describe("Duty Roster current browser lifecycle contracts", () => {
  it("loads only server-authorized employees for the selected roster outlet", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ id: "employee-1", nickname: "Aina", roster_eligible: true }], error: null });
    await expect(dutyRosterService.listRosterEligibleEmployees(outletId)).resolves.toEqual([
      { id: "employee-1", nickname: "Aina", roster_eligible: true },
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("list_roster_eligible_employees", { p_outlet_id: outletId });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("maps a complete week snapshot to the single trusted RPC without browser roster DML", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { period: { id: "period-1", status: "draft" }, rows: [{ ...sourceRow, roster_date: "2026-08-10" }] }, error: null });
    await expect(dutyRosterService.saveRosterWeekSnapshot({
      requestId: "00000000-0000-4000-8000-000000000012", outletId, weekStartDate: "2026-08-10",
      rows: [{ employee_id: "employee-1", roster_date: "2026-08-10", shift_template_id: "template-1", remark: "Open" }],
    })).resolves.toEqual(expect.objectContaining({ period: expect.objectContaining({ id: "period-1" }), rows: [expect.objectContaining({ id: "source-1" })] }));
    expect(mocks.rpc).toHaveBeenCalledWith("save_roster_week_snapshot", {
      p_request_id: "00000000-0000-4000-8000-000000000012", p_outlet_id: outletId, p_week_start_date: "2026-08-10",
      p_rows: [{ employee_id: "employee-1", roster_date: "2026-08-10", shift_template_id: "template-1", remark: "Open" }],
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("surfaces a week snapshot rejection without a browser fallback write", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("week rejected") });
    await expect(dutyRosterService.saveRosterWeekSnapshot({ requestId: "request-1", outletId, weekStartDate: "2026-08-10", rows: [] })).rejects.toThrow("week rejected");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("maps Copy Week, Publish, Unlock, and Lock to their single trusted RPCs without browser choreography", async () => {
    mocks.rpc.mockResolvedValue({ data: { period: { id: "period-1", status: "draft" }, rows: [] }, error: null });
    await dutyRosterService.copyRosterWeek({ requestId: "copy-1", outletId, sourceWeekStartDate: "2026-08-03", targetWeekStartDate: "2026-08-10", overwrite: true });
    await dutyRosterService.publishRosterWeek({ requestId: "publish-1", outletId, weekStartDate: "2026-08-10" });
    await dutyRosterService.unpublishRosterWeek({ requestId: "unlock-1", outletId, weekStartDate: "2026-08-10" });
    await dutyRosterService.lockRosterWeek({ requestId: "lock-1", outletId, weekStartDate: "2026-08-10" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["copy_roster_week", "publish_roster_week", "unpublish_roster_week", "lock_roster_week"]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("creates or edits one shift with the employee UUID/date composite identity and browser-supplied actor", async () => {
    const calls = queueQueries({ data: { ...sourceRow, roster_date: "2026-08-10", updated_at: "updated" }, error: null });
    await dutyRosterService.saveDutyRoster({ outletId, employeeId: "employee-1", rosterDate: "2026-08-10", template, remark: "Open" });
    expect(calls).toContainEqual(["upsert", expect.objectContaining({ outlet_id: outletId, employee_id: "employee-1", roster_date: "2026-08-10", updated_by: "auth-1" }), { onConflict: "outlet_id,employee_id,roster_date" }]);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("uses a hard delete for one shift and keeps audit best effort after persistence", async () => {
    const calls = queueQueries({ error: null });
    mocks.audit.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(dutyRosterService.deleteDutyRoster("shift-1", { outletId, rosterDate: "2026-08-10" })).resolves.toBeUndefined();
    expect(calls).toContainEqual(["delete"]);
    expect(calls).toContainEqual(["eq", "id", "shift-1"]);
  });

  it("copy week deletes the destination before its separate upsert, so an upsert failure leaves the deletion already persisted", async () => {
    const calls = queueQueries(
      { data: [sourceRow], error: null },
      { error: null },
      { data: null, error: new Error("copy insert failed") },
    );
    await expect(dutyRosterService.copyWeek({
      outletId, sourceStartDate: "2026-08-03", sourceEndDate: "2026-08-09", targetDates: ["2026-08-10"], overwrite: true,
    })).rejects.toThrow("copy insert failed");
    const deleteAt = calls.findIndex(([method]) => method === "delete");
    const upsertAt = calls.findIndex(([method]) => method === "upsert");
    expect(deleteAt).toBeGreaterThan(-1);
    expect(upsertAt).toBeGreaterThan(deleteAt);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("has no request-ID/in-flight authority for repeated copy submissions; each call starts another direct upsert", async () => {
    const calls = queueQueries(
      { data: [sourceRow], error: null }, { data: [{ ...sourceRow, roster_date: "2026-08-10" }], error: null },
      { data: [sourceRow], error: null }, { data: [{ ...sourceRow, roster_date: "2026-08-10" }], error: null },
    );
    const input = { outletId, sourceStartDate: "2026-08-03", sourceEndDate: "2026-08-09", targetDates: ["2026-08-10"] };
    await dutyRosterService.copyWeek(input);
    await dutyRosterService.copyWeek(input);
    expect(calls.filter(([method]) => method === "upsert")).toHaveLength(2);
  });

  it("publishes snapshots as independent row updates, so a later failure occurs after earlier row updates have been attempted", async () => {
    const calls = queueQueries(
      { data: { ...sourceRow, id: "shift-1", updated_at: "published" }, error: null },
      { data: null, error: new Error("second publish failed") },
    );
    await expect(dutyRosterService.setWeekRosterStatus({
      outletId, startDate: "2026-08-10", endDate: "2026-08-16", status: "published",
      snapshots: [{ ...sourceRow, id: "shift-1", template }, { ...sourceRow, id: "shift-2", template }],
    })).rejects.toThrow("second publish failed");
    expect(calls.filter(([method]) => method === "update")).toHaveLength(2);
  });
});
