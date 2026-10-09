// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../../services/factoryService.js", async importOriginal => ({ ...await importOriginal(), factoryService: { getProductionMonthlyPerformance: mocks.read } }));
import FactoryProductionMonthlyPerformance, { ProductionPerformanceChart } from "../FactoryProductionMonthlyPerformance.jsx";
const data = month => ({ month, today: "2026-10-09", unattributed_runs: 0, days: [{ day: `${month}-01`, completed_runs: 2, output_kg: 60, jo_hours: 3, productivity_output_kg: 60, productivity_runs: 2, moving_average_kg: 60, average_days: 1 }] });
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockImplementation(month => Promise.resolve(data(month))); });
describe("Monthly Production Performance", () => {
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
