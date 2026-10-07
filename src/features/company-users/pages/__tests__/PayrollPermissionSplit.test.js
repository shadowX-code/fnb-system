import { describe, expect, it } from "vitest";
import { enabledActions, getModuleById, getPermissionDefinitions } from "../../../../../config/modules.ts";
import { payrollActionCodes, payrollCapabilities } from "../payrollCapabilities.js";

describe("Payroll workflow permission projection", () => {
  it("retires broad manage from selection while preserving view and finalize", () => {
    expect(enabledActions(getModuleById("payroll"))).toEqual(expect.arrayContaining(["view", "finalize", ...payrollActionCodes]));
    expect(getPermissionDefinitions().some(p => p.code === "payroll.manage")).toBe(false);
  });
  it.each(payrollActionCodes)("%s independently controls its action without granting other mutations", action => {
    const access = payrollCapabilities(code => code === `payroll.${action}`);
    for (const other of payrollActionCodes) expect(access[other]).toBe(other === action);
    expect(access.recalculate).toBe(action !== "record_payment");
    expect(access.syncTime).toBe(["prepare", "review_time"].includes(action));
  });
  it("view/finalize and legacy manage confer no workflow mutations", () => {
    const access = payrollCapabilities(code => ["payroll.view", "payroll.finalize", "payroll.manage"].includes(code));
    expect(Object.values(access).every(v => v === false)).toBe(true);
  });
});
