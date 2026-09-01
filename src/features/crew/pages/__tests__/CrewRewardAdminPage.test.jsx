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
const readyReadiness = { ready: true, message: "Ready to finalize.", participant_count: 1, entry_count: 1, blocker_count: 0 };
const fixture = { cycles: [{ ...cycle, participant_count: 1 }], cycle: { ...cycle, participant_count: 1, finalization_readiness: readyReadiness }, entries: [entry], adjustments: [], participants: [{ employee_id: "employee-1", employee_name: "Alex Tan", position: "Service Crew" }], eligible_crew: [{ id: "employee-1", name: "Alex Tan", position: "Service Crew" }] };
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

  it("enables finalization only when the server readiness projection is complete", async () => {
    render(<CrewRewardAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review Campaign" }));
    const finalize = screen.getByRole("button", { name: "Finalize Reward Campaign" });
    expect(finalize.disabled).toBe(false);
    fireEvent.click(finalize);
    await waitFor(() => expect(mocks.finalize).toHaveBeenCalledWith("cycle-1"));
  });

  it("surfaces incomplete Performance as a server-readiness blocker and never calls finalize", async () => {
    const awaiting = { ...entry, id: "entry-2", employee_name: "Jamie Lee", performance_score: null, eligible_hours: 0, status: "awaiting_performance", eligibility_reason: "Finalized Performance is required." };
    const blockedFixture = {
      ...fixture,
      cycle: { ...fixture.cycle, finalization_readiness: { ready: false, message: "1 Crew still have incomplete Performance results.", blocker_count: 1, awaiting_performance_count: 1 } },
      entries: [awaiting],
    };
    mocks.data.mockResolvedValue(blockedFixture);
    render(<CrewRewardAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review Campaign" }));
    expect(screen.getByText("Finalization blocked")).not.toBeNull();
    expect(screen.getByText("1 Crew still have incomplete Performance results.")).not.toBeNull();
    expect(screen.getAllByText("Jamie Lee").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Finalize Reward Campaign" }).disabled).toBe(true);
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it("summarizes pending Performance once on the overview without duplicating affected Crew", async () => {
    const awaiting = { ...entry, id: "entry-2", employee_name: "Jamie Lee", performance_score: null, status: "awaiting_performance" };
    mocks.data.mockResolvedValue({ ...fixture, entries: [awaiting] });
    render(<CrewRewardAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByText("1 Crew awaiting finalized Performance")).not.toBeNull();
    expect(screen.getByText("Reward calculation will update automatically when their Performance is finalized.")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Reward Attention" })).toBeNull();
    expect(screen.getAllByText("Jamie Lee")).toHaveLength(1);
  });
});
