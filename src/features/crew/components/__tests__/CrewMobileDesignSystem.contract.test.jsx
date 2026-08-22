import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const system = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileSystem.css"), "utf8");
const appStyles = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileApp.css"), "utf8");
const mobileApp = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileApp.jsx"), "utf8");
const authStyles = readFileSync(resolve(process.cwd(), "src/features/crew/CrewAuthMobile.css"), "utf8");
const sharedStyles = readFileSync(resolve(process.cwd(), "src/styles/index.css"), "utf8");
const home = readFileSync(resolve(process.cwd(), "src/features/crew/CrewHome.css"), "utf8");
const cashCheckout = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewCashCheckoutMobile.css"), "utf8");
const performanceModal = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewPerformanceComponentModal.css"), "utf8");
const learningStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewLearningMobile.css"), "utf8");
const scheduleStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewScheduleMobile.css"), "utf8");
const attendanceStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewAttendanceMobile.css"), "utf8");
const leave = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewLeaveMobile.jsx"), "utf8");
const leaveStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewLeaveMobile.css"), "utf8");
const reward = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewRewardMobile.jsx"), "utf8");
const rewardStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewRewardMobile.css"), "utf8");
const growthStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewGrowthMobile.css"), "utf8");
const operationsStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewOperationsMobile.css"), "utf8");
const meStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewMeMobile.css"), "utf8");
const schedule = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewScheduleMobile.jsx"), "utf8");
const growth = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewGrowthMobile.jsx"), "utf8");
const learning = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewLearningMobile.jsx"), "utf8");

describe("Crew Mobile design system contract", () => {
  it("owns the FeedX palette and shared foundation primitives centrally", () => {
    expect(system).toContain("--crew-color-deep-teal: #164b50");
    expect(system).toContain("--crew-color-cyan: #00b7c7");
    expect(system).toContain("--crew-color-mist-mint: #b1d5c9");
    expect(system).toContain("--crew-color-mineral: #f5f7f6");
    expect(system).toContain("tokens and primitives only");
    expect(system).toContain(".crew-ui-functional-surface");
    expect(system).toContain(".crew-mobile-detail-header");
    expect(system).toContain(".crew-v2-nav button.active::before { display: none;");
    expect(system).toContain(".crew-v2-nav { position: fixed;");
    expect(system).toContain(".crew-v2-nav button { display: grid;");
  });

  it("loads canonical and feature presentation in an explicit cascade order", () => {
    const imports = [
      "./CrewMobileSystem.css", "./CrewAuthMobile.css", "./CrewMobileTypography.css", "./CrewMobileApp.css", "./CrewHome.css",
      "./components/CrewAttendanceMobile.css", "./components/CrewScheduleMobile.css", "./components/CrewLearningMobile.css", "./components/CrewLeaveMobile.css",
      "./components/CrewRewardMobile.css", "./components/CrewGrowthMobile.css", "./components/CrewPerformanceComponentModal.css", "./components/CrewOperationsMobile.css", "./components/CrewMeMobile.css", "./components/CrewCashCheckoutMobile.css",
    ];
    imports.reduce((previous, current) => {
      const position = mobileApp.indexOf(`import \"${current}\"`);
      expect(position).toBeGreaterThan(previous);
      return position;
    }, -1);
  });

  it("keeps primary actions, generic fields, and linear progress canonical", () => {
    [".crew-v2-primary", ".crew-v2-mobile-field", ".crew-v2-progress"].forEach((selector) => expect(appStyles).not.toContain(selector));
    [".crew-mobile-primary", ".crew-ui-field", ".crew-ui-linear-progress"].forEach((selector) => expect(system).toContain(selector));
    expect(sharedStyles).not.toMatch(/^\.crew-mobile-primary\s*\{/m);
  });

  it("keeps shared and Auth presentation out of the route shell stylesheet", () => {
    expect(authStyles).toContain("Auth-owned Crew mobile composition");
    [":root", ".crew-ui-", ".crew-v2-section-title", ".crew-v2-search", ".crew-v2-chips", ".crew-v2-status", ".crew-v2-login", ".crew-auth-", ".crew-v2-keypad"].forEach((selector) => expect(appStyles).not.toContain(selector));
  });

  it("keeps the complete Home hero contract in its feature owner without override chains", () => {
    expect(sharedStyles).not.toContain(".crew-home-attendance {");
    expect(home).toContain(".crew-v2-home .crew-home-attendance { display: block; width: 100%; min-width: 0; box-sizing: border-box;");
    [".crew-home-attendance-main", "grid-template-columns: minmax(0, 56%) minmax(0, 44%)", ".crew-home-clock-action", ".crew-home-attendance-footer"].forEach((selector) => expect(home).toContain(selector));
    expect(home).not.toContain("!important");
  });

  it("keeps migrated Cash Checkout and Performance detail owners on semantic tokens", () => {
    [cashCheckout, performanceModal, learningStyles, scheduleStyles, attendanceStyles].forEach((source) => {
      ["#07865f", "#079566", "#0b9069", "!important", "linear-gradient", "radial-gradient", "conic-gradient"].forEach((token) => {
        expect(source).not.toContain(token);
      });
    });
  });

  it("does not retain the migrated Learning ownership in the app shell stylesheet", () => {
    expect(appStyles).not.toContain(".crew-v2-app .crew-learning-home");
    expect(appStyles).not.toContain(".crew-v2-app .crew-mobile-sop-library");
    expect(appStyles).not.toContain(".crew-v3-knowledge-search");
    expect(appStyles).not.toContain(".crew-v3-onboarding-card");
    expect(appStyles).not.toContain(".crew-schedule-final{");
    expect(appStyles).not.toContain(".crew-attendance-history-page");
  });

  it("gives Leave one feature presentation owner and no legacy selector fallback", () => {
    expect(mobileApp).toContain('import "./components/CrewLeaveMobile.css"');
    expect(leaveStyles).toContain("Leave-specific flow composition");
    expect(leaveStyles).toContain("--crew-color-deep-teal");
    expect(leaveStyles).toContain("--crew-color-cyan");
    [".crew-v3-leave", ".crew-v3-choice-list", ".crew-v3-field-grid", ".crew-v3-leave-form", ".crew-v3-segment", ".crew-v3-leave-total", ".crew-v3-balance-grid", ".crew-v3-leave-balance-preview", ".crew-v3-review-list", ".crew-v3-header-action", ".crew-v3-rejection", ".crew-v3-mobile-loading", ".crew-v3-document-note", ".crew-v3-next-action"].forEach((selector) => {
      expect(appStyles).not.toContain(selector);
      expect(leaveStyles).not.toContain(selector);
    });
    ["!important", "#07865f", "#079566", "#0b9069", "linear-gradient", "radial-gradient", "conic-gradient"].forEach((token) => expect(leaveStyles).not.toContain(token));
  });

  it("gives Reward one token-based feature presentation owner", () => {
    expect(mobileApp).toContain('import "./components/CrewRewardMobile.css"');
    expect(rewardStyles).toContain("Reward-specific data visualization");
    [".crew-reward-", ".crew-v2-reward-"].forEach((selector) => expect(appStyles).not.toContain(selector));
    [".crew-reward-motivation", ".crew-reward-score-summary", ".crew-reward-projection-track", ".crew-reward-modal-history"].forEach((selector) => expect(rewardStyles).toContain(selector));
    expect(rewardStyles).not.toContain("!important");
  });

  it("keeps the complete Growth and My Performance presentation out of the app shell", () => {
    expect(mobileApp).toContain('import "./components/CrewGrowthMobile.css"');
    [".crew-growth-final", ".crew-performance-final", ".crew-v2-skill-hero", ".crew-v2-requirements", ".crew-v2-path-hero", ".crew-v2-performance-"].forEach((selector) => expect(appStyles).not.toContain(selector));
    ["!important", "#07865f", "#079566", "#0b9069", "linear-gradient", "radial-gradient"].forEach((token) => expect(growthStyles).not.toContain(token));
    expect(growthStyles).toContain("Growth-specific layout and data visualization");
  });

  it("keeps Operations, Me/account, and shared navigation ownership out of the app shell", () => {
    [".crew-ops-", ".crew-v2-me", ".crew-v2-profile", ".crew-v2-menu", ".crew-v2-logout", ".crew-v2-passcode", ".crew-v2-nav", ".crew-v2-page-header", ".crew-mobile-detail-header"].forEach((selector) => expect(appStyles).not.toContain(selector));
    [operationsStyles, meStyles].forEach((source) => ["!important", "#07865f", "#079566", "#0b9069", "linear-gradient", "radial-gradient"].forEach((token) => expect(source).not.toContain(token)));
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
