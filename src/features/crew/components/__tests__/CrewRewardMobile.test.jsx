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
    expect(screen.getAllByText("RM 72.43").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("RM 160.96").length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole("button", { name: /How it works/ }));
    expect(screen.getByRole("dialog", { name: "How your Reward is calculated" })).not.toBeNull();
    expect(screen.getAllByText("45%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("RM 72.43").length).toBeGreaterThanOrEqual(1);
  });

  it("uses one calculation disclosure from the header and potential section", () => {
    render(<CrewRewardMobile data={data} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Reward help" })[0]);
    expect(screen.getByRole("dialog", { name: "How your Reward is calculated" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /How it works/ }));
    expect(screen.getByRole("dialog", { name: "How your Reward is calculated" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: /View all/ }));
    expect(screen.getByRole("dialog", { name: "Reward History" })).not.toBeNull();
  });

  it("keeps hero metric helpers scoped to the selected metric", () => {
    render(<CrewRewardMobile data={{ ...data, performance_score: 87, earn_rate: .8 }} />);
    expect(screen.getByText("Maximum Share")).not.toBeNull();
    expect(screen.getByText("Reward Pool")).not.toBeNull();
    expect(screen.getByText("Your Contribution")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Reward help" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Maximum Share" }));
    expect(screen.getByRole("dialog", { name: "Maximum Share" })).not.toBeNull();
    expect(screen.getByText("Your potential share is based on your eligible contribution.")).not.toBeNull();
    expect(screen.queryByText("Performance earn rate table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Current Earn Rate" }));
    expect(screen.getByRole("dialog", { name: "Current Earn Rate" })).not.toBeNull();
    expect(screen.getByText("Your Performance Score determines the percentage of your Maximum Share earned.")).not.toBeNull();
    expect(screen.getByLabelText("Performance earn rate table")).not.toBeNull();
    expect(screen.queryByText("RM 500.00 × 32.19% = RM 160.96")).toBeNull();
  });

  it("uses canonical success status and the requested score-to-rate hierarchy", () => {
    const { container } = render(<CrewRewardMobile data={{ ...data, performance_score: 87, earn_rate: .8, performance_level: "Strong" }} />);
    const hero = container.querySelector(".crew-reward-hero");
    const rate = container.querySelector(".crew-reward-performance-rate");
    expect(hero.querySelector(".crew-ui-status.is-success").textContent).toBe("Qualified");
    expect(container.querySelector(".crew-reward-score-ring")).not.toBeNull();
    expect(rate.children[0].textContent).toBe("80%");
    expect(rate.children[1].textContent).toBe("Strong");
    expect(rate.children[2].textContent).toContain("Current Earn Rate");
    expect(rate.children[2].querySelector(".crew-ui-help-trigger.is-inline")).not.toBeNull();
  });

  it("uses the approved static background with only the traveling-light presentation layer", () => {
    const { container } = render(<CrewRewardMobile data={data} />);
    const hero = container.querySelector(".crew-reward-hero");
    expect(hero.style.getPropertyValue("--crew-reward-hero-background")).toContain("reward-hero-approved");
    expect(hero.querySelector(".crew-reward-hero-sheen")).toBeNull();
    expect(hero.querySelector(".crew-reward-hero-light-path path")).not.toBeNull();
    expect(hero.querySelector(".crew-reward-hero-light-pulse")).not.toBeNull();
    expect(hero.querySelector(".crew-reward-hero-light-trail")).not.toBeNull();
    expect(hero.querySelector(".crew-reward-hero-light-leading-edge")).not.toBeNull();
    expect(hero.querySelector(".crew-reward-hero-light-pulse circle")).toBeNull();
    expect(hero.querySelector(".crew-reward-hero-orbit")).toBeNull();
    expect(hero.querySelector(".crew-reward-hero-total p")).toBeNull();
  });

  it.each([0, 72.43, 123456.78])("retains the canonical reward amount %s for the hero reveal", (rewardAmount) => {
    const { container } = render(<CrewRewardMobile data={{ ...data, reward_amount: rewardAmount, estimated_reward: rewardAmount }} />);
    expect(container.querySelector(".crew-reward-hero-total strong")).not.toBeNull();
    expect(container.querySelector(".crew-reward-hero-light-pulse")).not.toBeNull();
  });

  it("keeps a non-qualified Crew member on the existing unavailable state instead of rendering the hero", () => {
    const { container } = render(<CrewRewardMobile data={{ ...data, status: "not_qualified", reward_amount: 0 }} />);
    expect(container.querySelector(".crew-reward-hero")).toBeNull();
  });

  it("closes a dialog with Escape and restores page scrolling", () => {
    render(<CrewRewardMobile data={data} />);
    const trigger = screen.getAllByRole("button", { name: "Reward help" })[0];
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
  });

  it("uses the shared helper sheet for metric explanations and closes it from the backdrop", () => {
    render(<CrewRewardMobile data={data} />);
    const trigger = screen.getByRole("button", { name: "Maximum Share" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.querySelector(".crew-ui-help-sheet")).not.toBeNull();
    fireEvent.mouseDown(document.querySelector(".crew-ui-help-backdrop"));
    expect(screen.queryByRole("dialog", { name: "Maximum Share" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("ports long helper content to the viewport-level scroll container", () => {
    render(<CrewRewardMobile data={data} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Reward help" })[0]);
    const dialog = screen.getByRole("dialog", { name: "How your Reward is calculated" });
    const content = dialog.querySelector(".crew-ui-help-sheet-content");
    Object.defineProperties(content, {
      clientHeight: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 480 },
    });
    content.scrollTop = 180;
    fireEvent.scroll(content);
    expect(content.scrollTop).toBe(180);
    expect(dialog.parentElement.parentElement).toBe(document.body);
    expect(document.body.style.position).toBe("fixed");
  });

  it.each([7, 75, 87, 100])("keeps score %s in the open score-to-rate relationship", (score) => {
    const { container } = render(<CrewRewardMobile data={{ ...data, performance_score: score }} />);
    const relationship = container.querySelector(".crew-reward-performance-relationship");
    expect(relationship.querySelector("strong").textContent).toBe(String(score));
    expect(relationship.textContent).toContain(String(score));
    expect(relationship.textContent).toContain("/100");
    expect(container.querySelector(".crew-reward-score-ring")).not.toBeNull();
    expect(container.querySelector(".crew-reward-score-ring-progress").getAttribute("stroke-dasharray")).toBe(`${score} 100`);
    expect(container.querySelector(".crew-reward-performance-connector")).not.toBeNull();
    expect(container.querySelector(".crew-reward-performance-connector-track")).not.toBeNull();
    expect(container.querySelector(".crew-reward-performance-connector-flow")).not.toBeNull();
    expect(container.querySelector(".crew-reward-performance-score").tagName).toBe("BUTTON");
    expect(container.querySelector(".crew-reward-performance.crew-reward-surface")).toBeNull();
    expect(container.querySelector(".crew-reward-performance-rate-action")).toBeNull();
    expect(screen.queryByText("How earn rate works")).toBeNull();
    expect(screen.queryByText("View My Performance")).toBeNull();
    expect(container.querySelectorAll(".crew-reward-performance-title")).toHaveLength(0);
    expect(container.querySelectorAll(".crew-reward-performance-insight")).toHaveLength(0);
  });

  it("deep-links to the existing Performance experience", () => {
    const onViewPerformance = vi.fn();
    render(<CrewRewardMobile data={data} onViewPerformance={onViewPerformance} />);
    fireEvent.click(screen.getByRole("button", { name: /View My Performance/ }));
    expect(onViewPerformance).toHaveBeenCalledTimes(1);
  });

  it("shows projection scenarios only from the current score upward", () => {
    const { container } = render(<CrewRewardMobile data={{ ...data, performance_score: 87, projections: data.projections.map((item) => item.key === "current" ? { ...item, score: 87 } : item) }} />);
    expect(screen.getByText("Score 87")).not.toBeNull();
    expect(screen.queryByText("Score 80")).toBeNull();
    expect(screen.queryByText("Score 85")).toBeNull();
    expect(screen.getByText("Score 95+")).not.toBeNull();
    const current = container.querySelector(".crew-reward-potential .is-current");
    const potential = container.querySelector(".crew-reward-potential .is-potential");
    expect(current.textContent).toContain("Current");
    expect(current.textContent).toContain("Score 87");
    expect(current.textContent).toContain("45% earned");
    expect(potential.textContent).toContain("Max Potential");
    expect(potential.textContent).toContain("Score 95+");
    expect(potential.textContent).toContain("100% earned");
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
    expect(screen.getAllByText("Anggaran Ganjaran").length).toBeGreaterThan(0);
    expect(screen.getByText("Kukuh")).not.toBeNull();
    expect(screen.getByText("Semasa")).not.toBeNull();
    expect(screen.getByText("Potensi Maksimum")).not.toBeNull();
    expect(screen.queryByText("Estimated Reward")).toBeNull();
    await i18n.changeLanguage("en");
  });

  it.each(["zh-CN", "ms"])("keeps Reward helper and projection copy localized in %s", async (language) => {
    await i18n.changeLanguage(language);
    render(<CrewRewardMobile data={data} />);
    expect(screen.getByText(i18n.t("reward.projectionAssumption"))).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("reward.maximumShare") }));
    expect(screen.getByText(i18n.t("reward.maximumShareHelp"))).not.toBeNull();
    await i18n.changeLanguage("en");
  });
});
