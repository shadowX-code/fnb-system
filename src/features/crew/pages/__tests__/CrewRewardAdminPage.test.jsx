import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: vi.fn(), create: vi.fn(), calculate: vi.fn(), adjust: vi.fn(), finalize: vi.fn(), paid: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: {
  rewardAdminData: mocks.data, createRewardCampaign: mocks.create, calculateRewardCycle: mocks.calculate,
  adjustRewardEntry: mocks.adjust, finalizeRewardCycle: mocks.finalize, markRewardCyclePaid: mocks.paid,
} }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) } }));
import CrewRewardAdminPage from "../CrewRewardAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const cycle = { id: "cycle-1", outlet_id: "outlet-1", period_start: "2026-08-01", configured_pool: 500, minimum_performance: 60, status: "review", calculation_version: "reward-v1", pool_unlock_rate: .75, unlocked_pool: 375, actual_payout: 322.5, unused_amount: 52.5 };
const entry = { id: "entry-1", employee_id: "employee-1", employee_name: "Alex Tan", position: "Service Crew", performance_score: 87, eligible_hours: 235, contribution_share: .322, performance_factor: 1, final_payout: 120.75, status: "qualified" };
const fixture = { cycles: [{ ...cycle, participant_count: 1 }], cycle: { ...cycle, participant_count: 1 }, entries: [entry], adjustments: [], participants: [{ employee_id: "employee-1", employee_name: "Alex Tan", position: "Service Crew" }], eligible_crew: [{ id: "employee-1", name: "Alex Tan", position: "Service Crew" }] };
const auth = { hasPermission: () => true }; const ui = { notify: vi.fn() };

beforeEach(() => { for (const mock of Object.values(mocks)) mock.mockReset(); mocks.data.mockResolvedValue(fixture); mocks.create.mockResolvedValue("cycle-1"); mocks.calculate.mockResolvedValue({}); mocks.adjust.mockResolvedValue({}); mocks.finalize.mockResolvedValue({}); mocks.paid.mockResolvedValue({}); });
afterEach(cleanup);

describe("Crew Reward Admin", () => {
  it("renders authoritative pool and employee breakdown", async () => {
    render(<CrewRewardAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByRole("heading", { name: "Reward Overview" })).not.toBeNull();
    expect(screen.getAllByText("RM 500.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Alex Tan")).not.toBeNull();
    expect(screen.getByText("32.2%")).not.toBeNull();
    expect(screen.getAllByText("Qualified").length).toBeGreaterThan(0);
  });

  it("creates a cycle through the controlled authority", async () => {
    mocks.data.mockResolvedValue({ cycles: [], cycle: null, entries: [], adjustments: [], participants: [], eligible_crew: [{ id: "employee-1", name: "Alex Tan", position: "Service Crew" }] });
    render(<CrewRewardAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Create Reward" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Reward for 1 Crew" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-1", configuredPool: 500, employeeIds: null })));
  });

  it("records adjustments with a required audit reason", async () => {
    render(<CrewRewardAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByText("Alex Tan"));
    fireEvent.click(screen.getByRole("button", { name: "Adjust Reward" }));
    fireEvent.change(screen.getByPlaceholderText("Example: 20 or -5"), { target: { value: "5" } });
    fireEvent.change(screen.getByPlaceholderText("Required audit reason"), { target: { value: "Approved service recovery" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Adjustment" }));
    await waitFor(() => expect(mocks.adjust).toHaveBeenCalledWith("entry-1", 5, "Approved service recovery"));
  });
});
