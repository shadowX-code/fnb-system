import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const service = vi.hoisted(() => ({ readPhPolicy: vi.fn(), saveDefaultPhPolicy: vi.fn(), savePhPolicy: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: service }));
import { PayrollPhPolicy } from "../PayrollPhWork.jsx";
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); service.readPhPolicy.mockResolvedValue([{ id: "policy", effective_from: "2026-01-01", treatment: "additional_pay" }]); });
it("summarizes shared benefits without a permanent company form and excludes retired companies", async () => {
 render(<PayrollPhPolicy entities={[{ id: "a", name: "Company A", is_active: true }, { id: "retired", name: "Retired QA", is_active: false }]} canManage />);
 await screen.findByText(/Effective 2026-01-01/);
 expect(service.readPhPolicy).toHaveBeenCalledOnce();
 expect(service.readPhPolicy).toHaveBeenCalledWith("a");
 expect(screen.getByText("Working on a Paid Holiday")).toBeTruthy();
 expect(screen.queryByText("Retired QA")).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "Edit Policy" }));
 expect(screen.getByRole("dialog")).toBeTruthy();
 expect(service.saveDefaultPhPolicy).not.toHaveBeenCalled();
});
it("reports differing company policies truthfully rather than inventing a common default", async () => {
 service.readPhPolicy.mockImplementation(id => Promise.resolve([{ id, effective_from: "2026-01-01", treatment: id === "a" ? "additional_pay" : "replacement_leave" }]));
 render(<PayrollPhPolicy entities={[{ id: "a", name: "A" }, { id: "b", name: "B" }]} canManage={false} />);
 await waitFor(() => expect(screen.getByText("Company-specific benefits — review exceptions")).toBeTruthy());
 expect(screen.queryByRole("button", { name: "Edit Policy" })).toBeNull();
});
