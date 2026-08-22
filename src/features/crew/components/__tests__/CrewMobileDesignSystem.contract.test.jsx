import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const system = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileSystem.css"), "utf8");
const leave = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewLeaveMobile.jsx"), "utf8");
const schedule = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewScheduleMobile.jsx"), "utf8");
const growth = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewGrowthMobile.jsx"), "utf8");
const learning = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewLearningMobile.jsx"), "utf8");

describe("Crew Mobile design system contract", () => {
  it("owns the FeedX palette and shared surface/row/header primitives centrally", () => {
    expect(system).toContain("--crew-color-deep-teal: #164b50");
    expect(system).toContain("--crew-color-cyan: #00b7c7");
    expect(system).toContain("--crew-color-mist-mint: #b1d5c9");
    expect(system).toContain("--crew-color-mineral: #f5f7f6");
    expect(system).toContain("/* Shared row DNA");
    expect(system).toContain(".crew-mobile-detail-header");
    expect(system).toContain("/* Canonical Bottom Nav");
  });

  it("routes Leave, Schedule, Learning and Growth details through the shared DetailHeader", () => {
    expect(leave).toContain("import CrewMobileDetailHeader");
    expect(leave).not.toContain("ArrowLeft");
    expect(schedule).toContain("<CrewMobileDetailHeader className=\"crew-schedule-final-header\"");
    expect(growth).toContain("if (onBack) return <CrewMobileDetailHeader");
    expect(learning).not.toContain("crew-learning-back");
    expect(learning).toContain("<CrewMobileDetailHeader title={t(\"learn.onboarding\")}");
  });
});
