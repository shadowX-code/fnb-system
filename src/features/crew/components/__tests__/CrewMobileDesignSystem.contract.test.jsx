import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const system = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileSystem.css"), "utf8");
const typography = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileTypography.css"), "utf8");
const appStyles = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileApp.css"), "utf8");
const mobileApp = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileApp.jsx"), "utf8");
const authStyles = readFileSync(resolve(process.cwd(), "src/features/crew/CrewAuthMobile.css"), "utf8");
const sharedStyles = readFileSync(resolve(process.cwd(), "src/styles/index.css"), "utf8");
const home = readFileSync(resolve(process.cwd(), "src/features/crew/CrewHome.css"), "utf8");
const cashCheckout = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewCashCheckoutMobile.css"), "utf8");
const taskBlockStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewTaskBlockRenderer.css"), "utf8");
const performanceModal = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewPerformanceComponentModal.css"), "utf8");
const learningStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewLearningMobile.css"), "utf8");
const sopDocumentStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewSopDocument.css"), "utf8");
const scheduleStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewScheduleMobile.css"), "utf8");
const attendanceStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewAttendanceMobile.css"), "utf8");
const leave = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewLeaveMobile.jsx"), "utf8");
const leaveStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewLeaveMobile.css"), "utf8");
const reward = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewRewardMobile.jsx"), "utf8");
const learnHome = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewLearnHome.jsx"), "utf8");
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
    expect(system).toContain("--crew-color-success: #007d8a");
    expect(system).toContain("--crew-color-success-surface: #e5f6f5");
    expect(system).toContain("--crew-color-info: #2563a6");
    expect(system).toContain("--crew-color-info-surface: #eaf3fb");
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
    [".crew-mobile-primary", ".crew-mobile-secondary", ".crew-mobile-destructive", ".crew-mobile-ghost"].forEach((selector) => expect(system).toContain(selector));
    expect(system).not.toContain(".crew-mobile-primary.is-cyan");
    expect(sharedStyles).not.toMatch(/^\.crew-mobile-primary\s*\{/m);
    [".crew-cash-primary", ".crew-home-secondary-action", ".crew-task-sheet-submit", ".crew-task-sheet-cancel"].forEach((selector) => {
      expect(cashCheckout + home + taskBlockStyles).not.toContain(selector);
    });
  });

  it("owns ordinary icon-container color roles centrally", () => {
    [
      "--crew-color-icon-default-bg: #e0f6f8",
      "--crew-color-icon-selected-bg: color-mix(in srgb, var(--crew-color-mist-mint) 58%, white)",
      "--crew-color-icon-neutral-bg: #e6ebec",
      "--crew-color-icon-neutral-fg: #728086",
      ".crew-ui-icon-container.is-active, .crew-ui-icon-container.is-live",
    ].forEach((contract) => expect(system).toContain(contract));
    expect(mobileApp).toContain('className="crew-ui-icon-container"');
    expect(learnHome).toContain("crew-ui-icon-container ${active ? \"is-selected is-active\" : \"\"}");
    expect(meStyles).not.toContain(".crew-me-list.is-neutral .crew-me-row-icon");
    expect(meStyles).not.toContain(".crew-me-settings .crew-ui-row-icon{background");
    expect(growthStyles).not.toContain(".crew-v2-row-icon, .crew-v2-icon-token");
    expect(mobileApp).not.toContain("crew-me-row-icon crew-ui-icon-container is-neutral");
  });

  it("keeps shared and Auth presentation out of the route shell stylesheet", () => {
    expect(authStyles).toContain("Auth-owned Crew mobile composition");
    [":root", ".crew-ui-", ".crew-v2-section-title", ".crew-v2-search", ".crew-v2-chips", ".crew-v2-status", ".crew-v2-login", ".crew-auth-", ".crew-v2-keypad"].forEach((selector) => expect(appStyles).not.toContain(selector));
  });

  it("keeps Crew mobile feature presentation out of the global stylesheet", () => {
    [".crew-learn-final", ".crew-v2-page-header", ".crew-mobile-detail-header", ".crew-sop-reader-"].forEach((selector) => expect(sharedStyles).not.toContain(selector));
    expect(mobileApp).toContain('import "./components/CrewLearningMobile.css"');
    expect(learningStyles).toContain("Learn home is feature-owned");
  });

  it("keeps SOP reader presentation in its shared component owner and consumes Crew primitives", () => {
    expect(sopDocumentStyles).toContain("Shared SOP document composition");
    ["var(--crew-color-deep-teal", "var(--crew-color-divider", "var(--crew-color-text-secondary"].forEach((token) => expect(sopDocumentStyles).toContain(token));
    expect(sopDocumentStyles).not.toContain("!important");
    expect(learning).toContain('import { CrewStatusBadge } from "./CrewMobileUI.jsx"');
    expect(learning).toContain('className="crew-ui-note crew-sop-acknowledged"');
    expect(learning).toContain('className="crew-sop-acknowledgement-action"');
  });

  it("keeps root, detail, and workflow header geometry canonical", () => {
    expect(system).toContain(".crew-mobile-page-header,.crew-v2-page-header");
    expect(system).toContain(".crew-mobile-detail-header.is-workflow");
    expect(reward).toContain("<CrewMobilePageHeader");
    expect(growth).toContain("<CrewMobilePageHeader title={title} action={action} />");
    expect(mobileApp).toContain("<CrewMobilePageHeader title={t(\"me.title\")} />");
    [rewardStyles, growthStyles, meStyles].forEach((source) => expect(source).not.toContain("crew-v2-page-header"));
    [rewardStyles, meStyles].forEach((source) => expect(source).not.toMatch(/crew-(reward|me)-header\s*\{/));
  });

  it("keeps Learn categories neutral except for the canonical active state", () => {
    ["CATEGORY_TONES", "is-rose", "is-lilac", "is-peach", "is-sage"].forEach((legacy) => {
      expect(learnHome).not.toContain(legacy);
      expect(learningStyles).not.toContain(legacy);
    });
    expect(learningStyles).toContain(".crew-learn-final-category.is-active");
    expect(learningStyles).toContain("var(--crew-color-cyan)");
    expect(learningStyles).toContain(".crew-learn-final-onboarding{display:grid");
    expect(learningStyles).toContain("background:var(--crew-color-surface)");
    expect(learningStyles).not.toContain(".crew-learn-final-onboarding{display:grid;width:100%;grid-template-columns:56px minmax(0,1fr) 36px;align-items:center;gap:12px;border:1px solid var(--crew-color-border);border-radius:var(--crew-radius-functional);background:var(--crew-color-mist-mint)");
    expect(learnHome).toContain("CrewStatusBadge");
    expect(learnHome).not.toContain('<strong>{t("learn.acknowledge")}</strong>');
    expect(learningStyles).toContain("grid-template-columns:40px minmax(0,1fr) minmax(72px,96px) 18px");
    expect(learningStyles).toContain(".crew-learn-final-sop-copy>strong{overflow:hidden;color:var(--crew-color-text);text-overflow:ellipsis;white-space:nowrap");
    expect(learningStyles).not.toContain(".crew-learn-final-sop-copy>strong{overflow:hidden;color:var(--crew-color-text);font-size:");
    expect(learningStyles).toContain(".crew-learn-final-ack>.crew-ui-status{justify-self:end;max-width:100%;white-space:normal");
  });

  it("keeps completed and acknowledged states on the shared success treatment", () => {
    expect(system).toContain(".crew-ui-status.is-success { background: var(--crew-color-success-surface); color: var(--crew-color-success);");
    expect(system).toContain(".crew-ui-status.is-info { background: var(--crew-color-info-surface); color: var(--crew-color-info);");
    expect(mobileApp).toContain('task.status === "completed" ? "success"');
    expect(learnHome).toContain('tone="success"');
  });

  it("keeps the complete Home hero contract in its feature owner without override chains", () => {
    expect(sharedStyles).not.toContain(".crew-home-attendance {");
    expect(home).toContain(".crew-v2-home .crew-home-attendance { display: block; width: 100%; min-width: 0; box-sizing: border-box;");
    [".crew-home-attendance-main", "grid-template-columns: minmax(0, 56%) minmax(0, 44%)", ".crew-home-clock-action", ".crew-home-attendance-footer"].forEach((selector) => expect(home).toContain(selector));
    expect(home).not.toContain("!important");
  });

  it("keeps canonical rows shared while Skills, Settings, and Profile retain only feature composition", () => {
    expect(system).toContain(".crew-ui-action-row");
    expect(system).toContain("font-size:var(--crew-type-list-primary)");
    expect(system).toContain(".crew-ui-count");
    expect(system).toContain("--crew-space-section: 24px");
    expect(typography).toContain(".crew-list-dense-primary");
    expect(growthStyles).toContain(".crew-skill-row");
    expect(growthStyles).not.toContain(".crew-v2-menu");
    expect(meStyles).toContain(".crew-me-settings");
    expect(meStyles).toContain(".crew-me-profile-summary");
    expect(growth).toContain('className="crew-growth-skill-row"');
    expect(growth).toContain('className="crew-list-dense-primary"');
    expect(learnHome).toContain('className="crew-list-dense-primary"');
    expect(growth).toContain('className="crew-list-secondary"');
    expect(growth).toContain('className="crew-ui-count"');
    expect(growth).toContain('className="crew-ui-row-icon"');
    expect(growth).toContain("<CrewStatusBadge tone={statusTone(skill.status)}>");
  });

  it("keeps Phase 2 signature presentation scoped to Home, Reward, and Growth owners", () => {
    expect(home).toContain("Home signature clock");
    expect(rewardStyles).toContain("Reward-specific financial hierarchy and data visualization");
    expect(growthStyles).toContain("Growth and performance use focused operational surfaces");
    expect(appStyles).not.toContain("Phase 2");
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
    expect(rewardStyles).toContain("Reward-specific financial hierarchy and data visualization");
    [".crew-reward-", ".crew-v2-reward-"].forEach((selector) => expect(appStyles).not.toContain(selector));
    [".crew-reward-hero-metrics", ".crew-reward-performance-relationship", ".crew-reward-potential", ".crew-reward-modal-history"].forEach((selector) => expect(rewardStyles).toContain(selector));
    expect(system).toContain(".crew-ui-modal");
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
    expect(growth).toContain("<CrewMobilePageHeader title={title} action={action} />");
  });
});
