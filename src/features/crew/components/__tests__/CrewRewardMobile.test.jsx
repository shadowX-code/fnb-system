import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CrewRewardMobile from "../CrewRewardMobile.jsx";
import i18n from "../../../../i18n/index.js";

const data = {
  period_start: "2026-08-01", status: "qualified", cycle_status: "review",
  reward_label: "Estimated Reward", reward_amount: 72.43, performance_score: 75,
  performance_level: "Meets Standard", earn_rate: .45, eligible_hours: 235,
  total_eligible_hours: 730, contribution_share: .3219, maximum_share: 160.96,
  reward_pool: 500, projection_applicable: true,
  projections: [
    { key: "current", label: "Current", score: 75, earn_rate: .45, amount: 72.43 },
    { key: "on_track", label: "On Track", score: 80, earn_rate: .65, amount: 104.62 },
    { key: "great", label: "Great", score: 85, earn_rate: .8, amount: 128.77 },
    { key: "max", label: "Max Potential", score: 95, earn_rate: 1, amount: 160.96 },
  ],
  history: [{ period_start: "2026-05-01", amount: 135.4, status: "paid", paid_at: "2026-06-05T00:00:00Z" }],
};

afterEach(cleanup);

describe("Crew Reward mobile reference UI", () => {
  it("keeps hero, current projection and calculation sheet amounts consistent", () => {
    render(<CrewRewardMobile data={data} />);
    expect(screen.getAllByText("RM 72.43").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("RM 160.96").length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole("button", { name: /How it works/ }));
    expect(screen.getByRole("dialog", { name: "About your Reward" })).not.toBeNull();
    expect(screen.getAllByText("45%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("RM 72.43").length).toBeGreaterThanOrEqual(2);
  });

  it("opens help, earn-rate, projection and history sheets", () => {
    render(<CrewRewardMobile data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Reward help" }));
    expect(screen.getByRole("dialog", { name: "About your Reward" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /How it works/ }));
    expect(screen.getByRole("dialog", { name: "About your Reward" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /View all/ }));
    expect(screen.getByRole("dialog", { name: "Reward History" })).not.toBeNull();
  });

  it("opens every hero metric explanation in a centered dialog", () => {
    render(<CrewRewardMobile data={data} />);
    for (const [buttonName, dialogName] of [
      ["About Estimated Reward", "About your Reward"],
      ["About maximum share", "Your Maximum Share"],
      ["About contribution share", "Your Contribution"],
      ["About reward pool", "Reward Pool"],
    ]) {
      fireEvent.click(screen.getByRole("button", { name: buttonName }));
      expect(screen.getByRole("dialog", { name: dialogName })).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    }
  });

  it("closes a dialog with Escape and restores page scrolling", () => {
    render(<CrewRewardMobile data={data} />);
    const trigger = screen.getByRole("button", { name: "Reward help" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
  });

  it.each([7, 75, 87, 100])("keeps score %s and its denominator on separate lines", (score) => {
    const { container } = render(<CrewRewardMobile data={{ ...data, performance_score: score }} />);
    const ring = container.querySelector(".crew-reward-score-ring");
    expect(ring.querySelector("strong").textContent).toBe(String(score));
    expect(ring.querySelector("small").textContent).toBe("/ 100");
    expect(ring.querySelector("span").children).toHaveLength(2);
  });

  it("deep-links to the existing Performance experience", () => {
    const onViewPerformance = vi.fn();
    render(<CrewRewardMobile data={data} onViewPerformance={onViewPerformance} />);
    fireEvent.click(screen.getByRole("button", { name: /View My Performance/ }));
    expect(onViewPerformance).toHaveBeenCalledTimes(1);
  });

  it("shows projection scenarios only from the current score upward", () => {
    render(<CrewRewardMobile data={{ ...data, performance_score: 87, projections: data.projections.map((item) => item.key === "current" ? { ...item, score: 87 } : item) }} />);
    expect(screen.getByText("Score 87")).not.toBeNull();
    expect(screen.queryByText("Score 80")).toBeNull();
    expect(screen.queryByText("Score 85")).toBeNull();
    expect(screen.getByText("Score 95+")).not.toBeNull();
  });

  it.each([
    ["finalized", "Final Reward"],
    ["paid", "Paid Reward"],
  ])("uses the correct %s label and hides projection", (state, label) => {
    render(<CrewRewardMobile data={{ ...data, status: state, cycle_status: state, reward_label: label, projection_applicable: false }} />);
    expect(screen.getByText(label)).not.toBeNull();
    expect(screen.getByText("Reward finalized")).not.toBeNull();
    expect(screen.queryByText("Estimated Reward Projection")).toBeNull();
  });

  it("localizes server-provided Reward labels instead of leaking English UI copy", async () => {
    await i18n.changeLanguage("ms");
    render(<CrewRewardMobile data={{ ...data, performance_score: 87, performance_level: "Strong", projections: data.projections.map((item) => item.key === "current" ? { ...item, score: 87 } : item) }} />);
    expect(screen.getByText("Anggaran Ganjaran")).not.toBeNull();
    expect(screen.getByText("Kukuh")).not.toBeNull();
    expect(screen.getByText("Semasa")).not.toBeNull();
    expect(screen.getByText("Potensi Maksimum")).not.toBeNull();
    expect(screen.queryByText("Estimated Reward")).toBeNull();
    await i18n.changeLanguage("en");
  });
});
