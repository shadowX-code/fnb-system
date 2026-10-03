import { describe, it, expect } from "vitest";
import { payrollIssueLabel } from "../payrollRunPresentation.js";

describe("Payroll statutory historical coverage explanations", () => {
  it.each(["epf", "socso", "eis", "pcb"])("explains %s unconfirmed legacy applicability without borrowing current setup", scheme => {
    const context = {statutory:{inputs:{setup_effective_date:"2026-09-01",applicability_coverage:{start:"2026-09-01",missing_through:null},applicability:{effective_from:"2026-05-01",[`${scheme}_applicable`]:null}}}};
    const text = payrollIssueLabel(`${scheme}_applicability_unreviewed`, context);
    expect(text).toContain(`${scheme.toUpperCase()} applicability is not confirmed`);
    expect(text).toContain("2026-09-01");
    expect(text).toContain("historical Effective Payroll Month");
    expect(text).not.toContain("requires review");
  });
  it("retains a server-provided missing coverage range", () => {
    expect(payrollIssueLabel("epf_applicability_unreviewed",{statutory:{inputs:{applicability_coverage:{start:"2026-09-01",missing_through:"2026-09-25"}}}})).toBe("EPF applicability missing · 2026-09-01 – 2026-09-25");
  });
  it("does not confuse missing applicability with the separate monthly PCB amount", () => {
    expect(payrollIssueLabel("pcb_confirmation_required")).toBe("PCB amount required");
    expect(payrollIssueLabel("pcb_applicability_unreviewed")).toContain("for this payroll period");
  });
});
