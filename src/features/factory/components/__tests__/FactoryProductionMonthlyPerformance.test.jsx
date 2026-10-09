// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../../services/factoryService.js", async importOriginal => ({ ...await importOriginal(), factoryService: { getProductionMonthlyPerformance: mocks.read } }));
import FactoryProductionMonthlyPerformance, { ProductionPerformanceChart } from "../FactoryProductionMonthlyPerformance.jsx";
const data = month => ({ month, today: "2026-10-09", unattributed_runs: 0, days: [{ day: `${month}-01`, completed_runs: 2, output_kg: 60, jo_hours: 3, productivity_output_kg: 60, productivity_runs: 2, moving_average_kg: 60, average_days: 1, records: [
  { production_id: "p1", job_order_id: "j1", job_order_no: "JO-fixture-01", finished_good_name: "Sauce A", sku_code: "S01", variant_name: "1kg Pack", output_kg: 40, actual_pack_qty: 40, start_at: `${month}-01T00:00:00+08:00`, end_at: `${month}-01T02:00:00+08:00`, jo_hours: 2 },
  { production_id: "p2", job_order_id: "j2", job_order_no: "JO-fixture-02", finished_good_name: "Sauce B", sku_code: "S02", variant_name: "500g Pack", output_kg: 20, actual_pack_qty: 40, start_at: `${month}-01T02:00:00+08:00`, end_at: `${month}-01T03:00:00+08:00`, jo_hours: 1 },
] }] });
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockImplementation(month => Promise.resolve(data(month))); });
describe("Monthly Production Performance", () => {
  it.each(["Output Trend", "Productivity", "Calendar Heatmap"])("opens the same contributing runs from %s and preserves mode/month on close", async mode => {
    render(<FactoryProductionMonthlyPerformance enabled />);
    await screen.findByText("60 kg");
    fireEvent.click(screen.getByRole("tab", { name: mode }));
    const day = screen.getByRole("button", { name: /60 kg; 2 completed runs/ });
    fireEvent.click(day);
    const dialog = screen.getByRole("dialog", { name: "Daily Production" });
    expect(dialog.textContent).toContain("60 kg");
    expect(dialog.textContent).toContain("20 kg/JO-hour");
    expect(dialog.textContent).toContain("JO-fixture-01");
    expect(dialog.textContent).toContain("JO-fixture-02");
    expect(dialog.textContent).toContain("S02 · 500g Pack");
    expect(dialog.textContent).toContain("Production End");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close modal" }));
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("tab", { name: mode }).getAttribute("aria-selected")).toBe("true");
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it("opens empty dates with Enter, closes with Escape and restores chart focus", async () => {
    render(<FactoryProductionMonthlyPerformance enabled />);
    await screen.findByText("60 kg");
    const day = screen.getAllByRole("button", { name: /0 kg; 0 completed runs/ })[0];
    day.focus();
    fireEvent.keyDown(day, { key: "Enter" });
    expect(screen.getByRole("dialog").textContent).toContain("No completed Production");
    fireEvent.keyDown(screen.getByRole("button", { name: "Close modal" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(day);
  });
  it("reuses the existing completed Job Order result owner", async () => {
    const onViewResult = vi.fn();
    render(<FactoryProductionMonthlyPerformance enabled onViewResult={onViewResult} />);
    await screen.findByText("60 kg");
    fireEvent.click(screen.getByRole("button", { name: /60 kg; 2 completed runs/ }));
    fireEvent.click(screen.getByRole("button", { name: "View Production result for JO-fixture-01" }));
    expect(onViewResult).toHaveBeenCalledWith({ id: "j1", job_order_no: "JO-fixture-01", product_name: "Sauce A", status: "completed" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("labels fractional productivity ticks accurately and keeps empty scales meaningful", () => {
    const view = render(<ProductionPerformanceChart month="2026-09" mode="productivity" days={[{ day: "2026-09-01", number: 1, state: "recorded", completed_runs: 1, productivity: .99 }]} />);
    expect(screen.getByText("0.25")).toBeTruthy();
    expect(screen.getByText("0.75")).toBeTruthy();
    view.rerender(<ProductionPerformanceChart month="2026-10" mode="output" days={[{ day: "2026-10-01", number: 1, state: "recorded", completed_runs: 0, output_kg: 0 }]} />);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });
  it("loads one month and switches all chart modes without further requests", async () => {
    render(<FactoryProductionMonthlyPerformance enabled />);
    await screen.findByText("60 kg");
    expect(mocks.read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("tab", { name: "Productivity" }));
    expect(screen.getByRole("tab", { name: "Productivity" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/not factory operating hours/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Calendar Heatmap" }));
    expect(screen.getByText("Mon")).toBeTruthy();
    expect(mocks.read).toHaveBeenCalledTimes(1);
    fireEvent.focus(screen.getAllByRole("button").find(button => button.getAttribute("data-admin-chart-mark")));
    expect(screen.getByRole("tooltip").textContent).toContain("Completed runs");
  });
  it("never requests data without Production view permission", () => {
    render(<FactoryProductionMonthlyPerformance enabled={false} />);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(screen.queryByText("Monthly Production Performance")).toBeNull();
  });
  it("aborts obsolete months and ignores late completion", async () => {
    let resolve;
    mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<FactoryProductionMonthlyPerformance enabled />);
    const month = mocks.read.mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", { name: "Previous performance month" }));
    await screen.findByText("60 kg");
    expect(mocks.read.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => resolve({ ...data(month), days: [] }));
    expect(screen.getByText("60 kg")).toBeTruthy();
  });
  it("shows explicit failure and retries without displaying stale totals", async () => {
    mocks.read.mockRejectedValueOnce(new Error("network"));
    render(<FactoryProductionMonthlyPerformance enabled />);
    await screen.findByRole("alert");
    expect(screen.queryByText("0 kg")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("60 kg")).toBeTruthy());
  });
});
