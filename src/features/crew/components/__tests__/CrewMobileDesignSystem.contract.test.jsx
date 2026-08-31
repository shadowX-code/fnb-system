import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const system = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileSystem.css"), "utf8");
const typography = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileTypography.css"), "utf8");
const appStyles = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileApp.css"), "utf8");
const mobileApp = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileApp.jsx"), "utf8");
const homeComponent = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewHomeMobile.jsx"), "utf8");
const meComponent = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewMeMobile.jsx"), "utf8");
const attendanceComponent = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewAttendanceMobile.jsx"), "utf8");
const authStyles = readFileSync(resolve(process.cwd(), "src/features/crew/CrewAuthMobile.css"), "utf8");
const sharedStyles = readFileSync(resolve(process.cwd(), "src/styles/index.css"), "utf8");
const home = readFileSync(resolve(process.cwd(), "src/features/crew/CrewHome.css"), "utf8");
const homeClockMotion = readFileSync(resolve(process.cwd(), "src/features/crew/CrewHomeClockMotion.jsx"), "utf8");
const cashCheckout = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewCashCheckoutMobile.css"), "utf8");
const taskBlockStyles = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewTaskBlockRenderer.css"), "utf8");
const taskBlock = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewTaskBlockRenderer.jsx"), "utf8");
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
const sopDocument = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewSopDocument.jsx"), "utf8");
const operations = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewOperationsMobile.jsx"), "utf8");
const help = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewHelp.jsx"), "utf8");
const bottomSheet = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewBottomSheet.jsx"), "utf8");

describe("Crew Mobile design system contract", () => {
  it("loads scoped feature CSS only with its lazy owner, keeping Performance with Growth", () => {
    const globalImports = readFileSync(resolve(process.cwd(), "src/styles/workspaceStyles.js"), "utf8");
    for (const [owner, styles] of [
      ["CrewCashCheckoutMobile", ["CrewCashCheckoutMobile"]],
      ["CrewGrowthMobile", ["CrewGrowthMobile", "CrewPerformanceComponentModal"]],
      ["CrewRewardMobile", ["CrewRewardMobile"]],
      ["CrewLeaveMobile", ["CrewLeaveMobile"]],
    ]) {
      const component = readFileSync(resolve(process.cwd(), `src/features/crew/components/${owner}.jsx`), "utf8");
      let previous = -1;
      for (const style of styles) {
        expect(mobileApp + globalImports).not.toContain(`${style}.css`);
        const position = component.indexOf(`import "./${style}.css"`);
        expect(position).toBeGreaterThan(previous);
        previous = position;
      }
    }
    for (const shared of ["CrewMobileSystem", "CrewMobileTypography", "CrewTaskBlockRenderer", "CrewSopDocument", "CrewLearningMobile"]) {
      expect(globalImports).toContain(`${shared}.css`);
    }
  });

  it("defers secondary implementations without moving Home, session or navigation into a lazy boundary", () => {
    for (const name of ["CrewGrowthMobile", "CrewRewardMobile", "CrewLearningMobile", "CrewCashCheckoutMobile", "CrewLeaveMobile"]) {
      expect(mobileApp).toContain(`const ${name} = lazy(() => import("./components/${name}.jsx"))`);
      expect(mobileApp).not.toContain(`import ${name} from`);
    }
    expect(mobileApp).toContain('import CrewHomeMobile from');
    expect(mobileApp).toContain('import useCrewSession from');
    expect(mobileApp).toContain('<Suspense fallback={<CrewRouteLoading />}');
    expect(mobileApp.indexOf('</Suspense>')).toBeLessThan(mobileApp.indexOf('<CrewBottomNav'));
  });

  it("keeps only the current schedule grid and approved Growth composition, not retired shells", () => {
    expect(home).toContain('.crew-v2-home .crew-home-schedule-row{grid-template-columns:34px minmax(0,1fr) 16px');
    expect(home).not.toMatch(/\.crew-home-schedule-row\s*>\s*em/);
    for (const retired of ['.crew-v2-attendance-card', '.crew-v3-shift-hero', '.crew-v3-growth-strip']) expect(home).not.toContain(retired);
    for (const retired of ['.crew-growth-final-hero', '.crew-v3-milestone-hero', '.crew-v2-growth-tabs']) expect(growthStyles).not.toContain(retired);
    for (const current of ['.crew-growth-performance-hero', '.crew-performance-final-hero', '.crew-v2-skill-hero', '.crew-v2-path-hero']) expect(growthStyles).toContain(current);
  });

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
      "./components/CrewAttendanceMobile.css", "./components/CrewScheduleMobile.css", "./components/CrewLearningMobile.css",
      "./components/CrewOperationsMobile.css", "./components/CrewMeMobile.css",
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
      "--crew-color-icon-default-bg: var(--crew-color-success-surface)",
      "--crew-color-icon-default-fg: var(--crew-color-deep-teal)",
      "--crew-color-icon-selected-bg: color-mix(in srgb, var(--crew-color-mist-mint) 58%, white)",
      "--crew-color-icon-neutral-bg: #e6ebec",
      "--crew-color-icon-neutral-fg: #728086",
      ".crew-ui-icon-container.is-active, .crew-ui-icon-container.is-live",
    ].forEach((contract) => expect(system).toContain(contract));
    expect(system).toContain(".crew-ui-status.is-success { background: var(--crew-color-success-surface);");
    expect(homeComponent).toContain('crew-ui-icon-container crew-ui-icon-container--compact');
    expect(learnHome).toContain('CrewSectionHeader density="operational" title={t("learn.category")}');
    expect(learnHome).toContain('className="crew-ui-count">{count}</span>');
    expect(learningStyles).toContain(".crew-learn-final-category-icon");
    expect(learningStyles).not.toContain(".crew-learn-final-category>.crew-ui-icon-container");
    expect(meStyles).not.toContain(".crew-me-list.is-neutral .crew-me-row-icon");
    expect(meStyles).not.toContain(".crew-me-settings .crew-ui-row-icon{background");
    expect(growthStyles).not.toContain(".crew-v2-row-icon, .crew-v2-icon-token");
    expect(meComponent).not.toContain("crew-me-row-icon crew-ui-icon-container is-neutral");
  });

  it("keeps Home task reminders data-driven, motion-safe, and free of a separate activity icon", () => {
    expect(homeComponent).toContain('crew-home-task-count is-${homeTaskBadgeState}');
    expect(homeComponent).toContain('homeTasks.every((task) => task.status === "completed") ? "complete" : "alert"');
    expect(homeComponent).toContain('className="crew-home-shift-status-icon"');
    expect(homeComponent).not.toContain("CrewHomeTaskActivityMotion");
    expect(home).toContain(".crew-home-task-count.is-alert::after");
    expect(home).toContain("animation: crew-home-task-reminder 2s ease-in-out infinite");
    expect(home).toContain(".crew-home-task-count.is-alert::after { animation: none;");
    expect(home).not.toContain("crew-home-task-activity");
    expect(homeComponent).toContain('t("tasks.dueLabel")');
    expect(homeComponent).toContain('className="crew-list-secondary crew-home-task-meta"');
    expect(homeComponent).toContain('className={`crew-home-task-due${task.deadline.overdue ? " is-overdue" : ""}`}');
    expect(home).toContain(".crew-home-task .crew-home-task-meta { display: flex;");
    expect(home).toContain(".crew-home-task .crew-home-task-due.is-overdue");
  });

  it("keeps Today’s Tasks as an open operational list while Schedule retains its functional surface", () => {
    expect(home).toContain(".crew-home-tasks .crew-home-list { overflow: visible; border: 0; border-radius: 0; background: transparent; box-shadow: none; }");
    expect(home).toContain(".crew-home-task { min-height: var(--crew-mobile-row-min);");
    expect(home).toContain("background: transparent; padding: 8px 4px; box-shadow: none;");
    expect(home).toContain(".crew-home-task:last-child, .crew-home-schedule-row:last-child { border-bottom: 0; }");
    expect(home).toContain(".crew-home-list { overflow: hidden; border: 1px solid var(--crew-color-border);");
  });

  it("owns app gutters, Bottom Nav clearance, and sticky-action geometry in the Fundamental", () => {
    ["--crew-mobile-page-inline: 16px", "--crew-mobile-page-bottom: calc(var(--crew-mobile-nav-height) + 28px + env(safe-area-inset-bottom))", ".crew-v2-app { width: min(100%, var(--crew-mobile-content-max))", ".crew-ui-sticky-actions", ".crew-ui-sticky-actions--with-nav", ".crew-ui-sticky-actions--sheet"].forEach((contract) => expect(system).toContain(contract));
    expect(appStyles).not.toContain(".crew-v2-app");
    expect(home).not.toContain(".crew-v2-app:has(");
    [cashCheckout, leaveStyles].forEach((source) => {
      expect(source).not.toMatch(/padding:[^;}]*var\(--crew-mobile-page-inline/);
      expect(source).not.toMatch(/bottom:\s*(?:65|66|78)px/);
    });
    expect(operationsStyles).not.toMatch(/\.crew-ops-mobile\s*\{[^}]*padding:[^}]*var\(--crew-mobile-page-inline/);
    expect(cashCheckout).not.toMatch(/\.crew-cash-actions\s*\{[^}]*position:/);
    expect(leaveStyles).not.toMatch(/\.crew-leave-footer\s*\{[^}]*position:/);
    expect(operationsStyles).not.toMatch(/\.crew-ops-sticky\s*\{[^}]*position:/);
    expect(mobileApp).toContain("!cashCheckoutFlow && <CrewBottomNav");
    expect(leave).toContain("crew-ui-sticky-actions--with-nav crew-leave-footer");
    expect(taskBlock).toContain("<CrewBottomSheet");
    expect(bottomSheet).toContain("crew-ui-bottom-sheet-footer");
  });

  it("keeps migrated operational icons on canonical foreground and surface owners", () => {
    expect(system).toContain(".crew-ui-icon-container--large");
    expect(system).toContain(".crew-ui-icon-container--round");
    expect(system).toContain(".crew-ui-icon-container.is-danger");
    expect(cashCheckout).not.toContain(".crew-cash-summary-icon");
    [".crew-cash-activity-icon.is-in", ".crew-cash-activity-icon.is-out", "article > svg,.crew-cash-card > header svg { color: var(--crew-color-cyan)"] .forEach((legacy) => expect(cashCheckout).not.toContain(legacy));
    const cashCheckoutComponent = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewCashCheckoutMobile.jsx"), "utf8");
    expect(cashCheckoutComponent).toContain('className="crew-ui-icon-container crew-ui-icon-container--large"><CalendarCheck');
    expect(cashCheckoutComponent).toContain('className="crew-ui-icon-container crew-ui-icon-container--large"><HandCoins');
    expect(cashCheckoutComponent).toContain('crew-ui-icon-container--round crew-cash-activity-icon${isOut ? " is-danger" : ""}');
    expect(cashCheckoutComponent).not.toContain("crew-ui-icon-container--large is-selected");
    [cashCheckout, leaveStyles, operationsStyles, taskBlockStyles].forEach((source) => {
      expect(source).not.toMatch(/\.crew-ui-icon-container[^\{]*\{[^}]*(?:background|color|border-radius|width|height)/s);
    });
  });

  it("keeps Cash Checkout counting surfaces on canonical Mint owners", () => {
    expect(cashCheckout).toMatch(/\.crew-cash-steps i\s*\{[^}]*background:\s*var\(--crew-color-icon-default-bg\)/s);
    expect(cashCheckout).toMatch(/\.crew-cash-steps \.is-current i,\.crew-cash-steps \.is-completed i\s*\{[^}]*background:\s*var\(--crew-color-primary-bg\)/s);
    expect(cashCheckout).toMatch(/\.crew-cash-stepper\s*\{[^}]*background:\s*var\(--crew-color-icon-default-bg\)/s);
    expect(cashCheckout).toMatch(/\.crew-cash-counted-result\s*\{[^}]*background:\s*var\(--crew-color-icon-default-bg\)/s);
    expect(cashCheckout).not.toMatch(/\.crew-cash-(?:steps|stepper|counted-result)[^{]*\{[^}]*cyan/s);
  });

  it("keeps Cash Checkout Allocate and Confirm in the canonical Primary and Mint families", () => {
    expect(system).toContain("--crew-color-primary-bg: var(--crew-color-cyan)");
    expect(system).toContain("--crew-color-primary-fg: #fff");
    expect(system).toContain(".crew-mobile-primary { border: 1px solid var(--crew-color-primary-bg); background: var(--crew-color-primary-bg); color: var(--crew-color-primary-fg); }");
    expect(cashCheckout).toMatch(/\.crew-cash-steps > span\s*\{[^}]*background:\s*var\(--crew-color-primary-bg\)[^}]*transform:\s*scaleX\(var\(--crew-cash-step-progress/s);
    expect(cashCheckout).toMatch(/\.crew-cash-steps \.is-current i,\.crew-cash-steps \.is-completed i\s*\{[^}]*background:\s*var\(--crew-color-primary-bg\)/s);
    expect(cashCheckout).toMatch(/\.crew-cash-breakdown \.is-total\s*\{[^}]*background:\s*var\(--crew-color-icon-default-bg\)/s);
    expect(cashCheckout).not.toContain("crew-cash-action-total");
  });

  it("blocks new shared-owner bypasses in the migrated feature shells", () => {
    const migratedStyles = [cashCheckout, leaveStyles, operationsStyles, taskBlockStyles];
    migratedStyles.forEach((source) => {
      ["#00b7c7", "#e0f6f8", "#164b50", "#b1d5c9", "!important", "linear-gradient", "radial-gradient", "conic-gradient"].forEach((token) => expect(source).not.toContain(token));
      [".crew-mobile-primary", ".crew-mobile-secondary", ".crew-mobile-destructive", ".crew-mobile-ghost"].forEach((selector) => expect(source).not.toMatch(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{[^}]*(?:min-height|border-radius|background|color)`, "s")));
    });
  });

  it("keeps Operations and Task Renderer on shared tabs, badges, icons, fields, and documented sheets", () => {
    [operationsStyles, taskBlockStyles].forEach((source) => ["#", "!important", "linear-gradient", "radial-gradient", "conic-gradient"].forEach((token) => expect(source).not.toContain(token)));
    expect(operations).toContain("crew-ui-tabs crew-ops-top-tabs");
    expect(operations).toContain("CrewStatusBadge");
    expect(operations).toContain("crew-ui-icon-container--compact");
    expect(operationsStyles).not.toContain(".crew-ops-top-tabs button");
    expect(operationsStyles).not.toContain(".crew-ops-task>span:first-child");
    expect(taskBlock).toContain("crew-ui-status crew-task-block-result");
    expect(taskBlock).toContain("crew-ui-icon-container--compact crew-task-block-number");
    expect(taskBlock).toContain("crew-ui-choice-list crew-task-choice-list");
    expect(taskBlock).toContain("CircleMinus");
    expect(taskBlockStyles).toContain(".crew-task-direct-toggle.is-done");
    expect(taskBlockStyles).toContain(".crew-task-choice-grid.is-health button.is-needs-attention.is-selected");
    expect(taskBlockStyles).toContain(".crew-task-report-link");
    expect(taskBlockStyles).not.toContain(".crew-task-block-number.is-");
    expect(taskBlock).toContain('import CrewBottomSheet from "./CrewBottomSheet.jsx"');
    expect(operationsStyles).toContain("Legacy task action content consumes the canonical CrewBottomSheet shell");
  });

  it("keeps task availability expression and compact controls on canonical shared owners", () => {
    expect(system).toContain(".crew-ui-note--warning { background: color-mix(in srgb, var(--crew-color-warning) 10%, white);");
    expect(operations).toContain("isCrewTaskUnavailable(detail, availabilityNow)");
    expect(operations).toContain("crew-ui-note crew-ui-note--warning crew-ops-availability-notice");
    expect(operations).toContain("unavailable={unavailable}");
    expect(taskBlock).toContain("unavailable = false");
    expect(taskBlock).toContain("mode === \"readonly\" || saving || responded || unavailable");
    expect(taskBlock).not.toContain("<small>{taskTypeLabel(block.block_type, t)}</small>");
    expect(taskBlock).toContain("crew-ui-choice-list crew-task-choice-grid is-two");
    expect(taskBlockStyles).toContain(".crew-task-choice-grid.is-two button { display: inline-flex;");
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
    expect(learning).toContain('CrewProgressBar, CrewSectionHeader, CrewStatusBadge');
    expect(learning).toContain('className="crew-ui-note crew-sop-acknowledged"');
    expect(learning).toContain('className="crew-sop-acknowledgement-action"');
    expect(learning).toContain('crew-learning-journey-hero crew-ui-functional-surface');
    expect(learning).toContain('import onboardingJourneyHero from "../../../assets/crew/onboarding-journey-hero-approved.webp"');
    expect(learning).toContain('className="crew-learning-journey-art"');
    expect(learning).toContain("function onboardingJourneyDescription(description)");
    expect(learning).toContain("FeedX Crew Onboarding Full Demo");
    expect(learning).toContain("{journeyDescription && <p>{journeyDescription}</p>}");
    expect(learning).toContain('t("learn.journeyProgressOf", { total: home?.assignment?.lessons_total || 0 })');
    expect(learning).toContain('t("learn.journeyProgressCompleted")');
    expect(learning).toContain('crew-ui-count crew-learning-modules-count');
    expect(learning).toContain('function onboardingModuleState(module)');
    expect(learning).toContain('crew-lesson-row${item.locked ? " is-locked" : ""}${item.lesson?.id === currentLessonId ? " is-current" : ""}');
    expect(learning).toContain('className="crew-learning-context"');
    expect(learning).toContain('className="crew-learning-section-label"');
    expect(learning).toContain('crew-learning-content-block crew-ui-note crew-ui-note--mint is-key-point');
    expect(learning).toContain('crew-learning-sop-reference crew-ui-functional-surface');
    expect(learningStyles).toContain('.crew-learning-context { color:var(--crew-color-deep-teal); font-size:var(--crew-type-secondary);');
    expect(learningStyles).toContain('.crew-learning-section-label { color:var(--crew-color-deep-teal); font-size:var(--crew-type-label);');
    expect(learningStyles).toContain('.crew-learning-home .crew-module-head h3 { margin:0; color:var(--crew-color-deep-teal); font-size:var(--crew-type-detail-title);');
    expect(learningStyles).toContain('.crew-learning-journey-art { position:absolute; z-index:-2; inset:0; width:100%; height:100%; object-fit:cover; object-position:72% 50%; pointer-events:none; transform:scale(1.08); }');
    expect(learningStyles).toContain('.crew-learning-home > .crew-ui-section-head h2 { display:flex; align-items:center; gap:8px; }');
    expect(learningStyles).toContain('.crew-learning-modules-count { flex:0 0 auto; }');
    expect(learningStyles).toContain('.crew-learning-module.is-in-progress .crew-module-head p { color:var(--crew-color-deep-teal); font-weight:700; }');
    expect(learningStyles).toContain('.crew-learning-home .crew-module-head p { display:flex; align-items:center; gap:4px; margin:3px 0 0; color:var(--crew-color-text-secondary); font-size:var(--crew-type-helper);');
    expect(learningStyles).toContain('.crew-module-head.is-completed { grid-template-columns:30px minmax(0,1fr); }');
    expect(learningStyles).toContain('.crew-module-head.is-completed .crew-module-progress { color:var(--crew-color-success); }');
    expect(learningStyles).toContain('.crew-lesson-row strong { color:var(--crew-color-text); font-size:var(--crew-type-section-title);');
    expect(learningStyles).toContain('.crew-lesson-row small { color:var(--crew-color-text-secondary); font-size:var(--crew-type-helper);');
    expect(learningStyles).toContain('.crew-lesson-row.is-current { background:color-mix(in srgb,var(--crew-color-mist-mint) 30%,white); }');
    expect(learningStyles).toContain('.crew-learning-home .crew-module-order { display:grid; width:30px; height:30px;');
    expect(learningStyles).toContain('.crew-learning-reader .crew-learning-lesson-header h2 { margin:0; color:var(--crew-color-deep-teal);');
    expect(learningStyles).toContain('.crew-learning-reader .crew-learning-summary { margin:0; color:var(--crew-color-text-secondary); font-size:var(--crew-type-secondary);');
    expect(learningStyles).toContain('.crew-learning-reader .crew-quiz h3 { margin:0; color:var(--crew-color-deep-teal);');
    expect(learningStyles).not.toContain('.crew-learning-kicker');
    expect(learningStyles).toContain("Journey and lesson routes consume the same Mobile Fundamental");
  });

  it("keeps root, detail, and workflow header geometry canonical", () => {
    expect(system).toContain(".crew-mobile-page-header,.crew-v2-page-header");
    expect(system).toContain(".crew-mobile-detail-header.is-workflow");
    expect(reward).toContain("<CrewMobilePageHeader");
    expect(growth).toContain("<CrewMobilePageHeader title={title} action={action} />");
    expect(meComponent).toContain("<CrewMobilePageHeader title={t(\"me.title\")} />");
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
    expect(homeComponent).toContain('task.status === "completed" ? "success"');
    expect(learnHome).toContain('tone="success"');
  });

  it("keeps Growth, Performance, and Home generic primitives on canonical owners", () => {
    [".crew-ui-icon-container--micro", ".crew-ui-icon-container--small", ".crew-ui-icon-container--emphasis", ".crew-ui-icon-container.is-info"].forEach((contract) => expect(system).toContain(contract));
    ["crew-ui-icon-container--micro", "crew-ui-icon-container--emphasis", "crew-ui-icon-container--small", "crew-ui-icon-container--compact"].forEach((modifier) => expect(growth).toContain(modifier));
    expect(growthStyles).not.toContain(".crew-growth-overview-metrics .crew-ui-icon-container{");
    expect(growthStyles).not.toContain(".crew-performance-final-evidence>.crew-ui-icon-container{");
    expect(performanceModal).not.toContain(".crew-performance-component-summary > .crew-ui-icon-container {");
    expect(performanceModal).not.toContain(".crew-performance-component-evidence .is-success i");
    expect(homeComponent).toContain("crew-home-task is-${task.status}");
    expect(homeComponent).toContain("crew-ui-icon-container crew-ui-icon-container--compact");
    expect(home).not.toContain(".crew-home-task > .crew-ui-icon-container");
    expect(home).not.toContain(".crew-v2-home .crew-home-task>.crew-ui-icon-container");
    ["#164b50", "#00b7c7", "#b1d5c9"].forEach((legacy) => expect(home).not.toContain(legacy));
    expect(home).toContain("Home signature clock: the supplied Mint artwork is the only decorative background.");
    expect(home).not.toContain("crew-home-radar-orbit");
    expect(home).not.toContain("crew-home-clock-atmosphere.png");
  });

  it("keeps Phase 4 generic owners scoped while preserving Reward and Attendance domain composition", () => {
    expect(schedule).toContain('import { CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx"');
    expect(schedule).toContain("return <CrewStatusBadge tone={tone");
    expect(scheduleStyles).not.toContain(".crew-schedule-final-badge");
    expect(attendanceStyles).not.toContain("background: #f0f3f5");
    expect(attendanceStyles).not.toContain("color: #708096");
    expect(attendanceStyles).toContain("background: var(--crew-color-surface)");
    expect(rewardStyles).not.toContain(".crew-reward-history-empty .crew-ui-icon-container");
    expect(meStyles).not.toContain(".crew-me-status-icon, .crew-me-row-icon");
    expect(meStyles).not.toContain("background: #fff1d7");
    expect(cashCheckout).toContain("padding-inline: var(--crew-mobile-page-inline)");
    expect(cashCheckout).not.toMatch(/\.crew-cash-actions\s*\{[^}]*\b(?:position|bottom|padding-inline)/s);
    expect(rewardStyles).toContain("Reward hero remains a domain-specific premium surface.");
    expect(attendanceStyles).toContain("Attendance keeps a route-owned composition while consuming Crew Fundamental tokens.");
  });

  it("keeps Schedule selection and empty-day hierarchy on canonical Mint and status owners", () => {
    expect(schedule).toContain('import { CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx"');
    expect(schedule).toContain('className="crew-ui-segmented crew-ui-segmented--mint crew-schedule-final-week"');
    expect(schedule).toContain('className="crew-schedule-final-date-block"');
    expect(schedule).toContain("CalendarDays");
    expect(schedule).toContain("crew-schedule-final-calendar is-expanded");
    expect(schedule).toContain("weekStartFor(selectedDate)");
    expect(schedule).not.toContain("jumpToday");
    expect(scheduleStyles).toContain("background: var(--crew-color-icon-default-bg)");
    expect(scheduleStyles).toContain("grid-auto-flow: row");
    expect(scheduleStyles).toContain("grid-template-columns: repeat(7, minmax(0, 1fr))");
    expect(scheduleStyles).toContain("button.is-selected i { background: var(--crew-color-deep-teal); }");
    expect(scheduleStyles).toContain(".crew-schedule-month-cell.is-selected { background: var(--crew-color-icon-default-bg)");
    expect(scheduleStyles).not.toContain("button.is-selected { background: var(--crew-color-deep-teal)");
    expect(schedule).toContain('density="operational" title={t("schedule.upcoming")} trailing={<CrewStatusBadge tone="neutral">{t("schedule.nextDays")}</CrewStatusBadge>}');
    expect(schedule).toContain('entry ? "crew-type-detail-title" : "crew-type-card-title"');
    expect(schedule).toContain('className="crew-type-helper"');
    expect(schedule).toContain('className="crew-schedule-final-day-meta"');
    expect(schedule).toContain('className="crew-schedule-final-row-meta"');
    expect(schedule).toContain('className="crew-schedule-final-duration crew-type-helper"');
    expect(schedule).not.toContain("entryRole");
    expect(scheduleStyles).toContain(".crew-schedule-final-day.is-empty .crew-schedule-final-day-copy { gap: 4px; }");
    expect(scheduleStyles).toContain(".crew-schedule-final-row-meta { display: flex; min-width: 0; align-items: center; gap: 8px; }");
    expect(scheduleStyles).toContain(".crew-schedule-final-duration { flex: 0 0 auto;");
    expect(scheduleStyles).not.toContain(".crew-schedule-final-upcoming > header");
  });

  it("keeps Attendance on shared page, segmented, icon, status, and divider owners", () => {
    expect(attendanceComponent).toContain('subtitle={t("attendance.subtitle")} variant="page"');
    expect(attendanceComponent).toContain("crew-ui-segmented crew-ui-segmented--mint crew-attendance-month-select");
    expect(attendanceComponent).toContain("crew-ui-icon-container crew-ui-icon-container--compact");
    expect(attendanceComponent).toContain('<CrewStatusBadge tone="warning">{t("attendance.requiresReview")}</CrewStatusBadge>');
    expect(attendanceComponent).toContain('<CrewStatusBadge tone="success">{t("status.completed")}</CrewStatusBadge>');
    expect(system).toContain(".crew-ui-segmented--mint");
    expect(system).toContain(".crew-mobile-detail-header.is-page");
    ["#", "!important", "background:rgb", "background:rgba"].forEach((forbidden) => expect(attendanceStyles).not.toContain(forbidden));
    expect(attendanceStyles).toContain("var(--crew-color-icon-default-bg)");
    expect(attendanceStyles).toContain("var(--crew-color-divider)");
    expect(attendanceComponent).toContain('month: "short", year: "numeric"');
    expect(attendanceStyles).toContain("@media (max-width: 420px)");
    [
      "grid-template-columns: 56px minmax(0, 1fr) max-content",
      "grid-template-columns: 48px minmax(0, 1fr) max-content",
      ".crew-attendance-history-time > span { display: flex; min-width: 0; align-items: center; gap: 6px; white-space: nowrap; }",
    ].forEach((contract) => expect(attendanceStyles).toContain(contract));
    expect(attendanceStyles).not.toContain("grid-column: 2; grid-row: 2");
    expect(attendanceStyles).not.toContain("text-overflow");
    expect(attendanceStyles).not.toContain("ellipsis");
    expect(attendanceStyles).toContain("justify-items: center");
    expect(attendanceStyles).toContain("crew-attendance-location-status");
    expect(attendanceComponent).toContain('hour: "numeric", minute: "2-digit"');
    expect(attendanceComponent).not.toContain("<ChevronRight size={20} aria-hidden=\"true\" /></article>");
  });

  it("keeps the complete Home hero contract in its feature owner without override chains", () => {
    expect(sharedStyles).not.toContain(".crew-home-attendance {");
    expect(home).toContain(".crew-v2-home .crew-home-attendance { display: block; width: 100%; min-width: 0;");
    [".crew-home-attendance-main", ".crew-home-attendance-art", ".crew-home-clock-halo", ".crew-home-clock-semantic-ring", ".crew-home-clock-orbit-highlight", ".crew-home-clock-action", ".crew-home-attendance-footer"].forEach((selector) => expect(home).toContain(selector));
    expect(homeComponent).toContain('import crewHomeAttendanceMintBackground from "../assets/crew-home-attendance-mint-background.webp"');
    expect(homeComponent).toContain('<CrewHomeClockMotion attendanceMode={attendanceMode} transition={clockTransition} loading={loading} hasException={locationEvidence.tone === "is-exception"}>');
    expect(home).toContain("grid-template-rows: 100px 15px");
    expect(home).toContain("transform-origin: 50% 50%");
    expect(home).toContain("stroke-dasharray: 56 315");
    expect(home).toContain('grid-template-areas: "icon label action" "icon time time"');
    expect(homeClockMotion).toContain('<svg className="crew-home-clock-orbit-highlight"');
    expect(homeClockMotion).toContain("crew-home-clock-energy-trail");
    expect(homeClockMotion).not.toContain('clearProps: "transform,opacity"');
    expect(homeClockMotion).toContain("duration: 5.8");
    expect(home).not.toContain("!important");
  });

  it("keeps canonical rows shared while Skills, Settings, and Profile retain only feature composition", () => {
    expect(system).toContain(".crew-ui-action-row");
    expect(system).toContain("font-size:var(--crew-type-list-primary)");
    expect(system).toContain(".crew-ui-count");
    expect(system).toContain("--crew-space-section: 24px");
    expect(typography).toContain(".crew-list-dense-primary");
    expect(growthStyles).not.toContain(".crew-skill-row");
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
    expect(home).toContain("Home signature clock: the supplied Mint artwork is the only decorative background.");
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
    expect(leave).toContain('import "./CrewLeaveMobile.css"');
    expect(leaveStyles).toContain("Leave-specific flow composition");
    expect(leaveStyles).toContain("--crew-color-deep-teal");
    expect(leaveStyles).toContain("--crew-color-cyan");
    [".crew-v3-leave", ".crew-v3-choice-list", ".crew-v3-field-grid", ".crew-v3-leave-form", ".crew-v3-segment", ".crew-v3-leave-total", ".crew-v3-balance-grid", ".crew-v3-leave-balance-preview", ".crew-v3-review-list", ".crew-v3-header-action", ".crew-v3-rejection", ".crew-v3-mobile-loading", ".crew-v3-document-note", ".crew-v3-next-action"].forEach((selector) => {
      expect(appStyles).not.toContain(selector);
      expect(leaveStyles).not.toContain(selector);
    });
    ["!important", "#07865f", "#079566", "#0b9069", "linear-gradient", "radial-gradient", "conic-gradient"].forEach((token) => expect(leaveStyles).not.toContain(token));
  });

  it("keeps Apply Leave selected, balance, and supporting-document surfaces on canonical Mint owners", () => {
    expect(system).toContain(".crew-ui-choice-list--mint button.is-selected { border-color: var(--crew-color-mist-mint); background: var(--crew-color-icon-default-bg); }");
    expect(system).toContain(".crew-ui-note--mint { background: var(--crew-color-icon-default-bg); }");
    expect(leave).toContain('className="crew-ui-icon-container crew-ui-icon-container--small is-selected"');
    expect(leave).toContain('className="crew-ui-choice-list crew-ui-choice-list--mint"');
    expect(leave).toContain('className={`crew-ui-note crew-ui-note--mint crew-leave-balance-preview ${insufficient ? "is-insufficient" : ""}`}');
    expect(leave).toContain('<div className="crew-ui-note crew-ui-note--mint"><span className="crew-ui-icon-container crew-ui-icon-container--small"><FileText');
    expect(leaveStyles).not.toMatch(/\.crew-leave-balance-preview\s*\{[^}]*background:/s);
    expect(leaveStyles).not.toMatch(/\.crew-leave-balance-preview\.is-insufficient\s*\{[^}]*mist-mint/s);
    expect(leaveStyles).not.toMatch(/\.crew-leave-(?:balance-preview|document|choice)[^\{]*\{[^}]*(?:cyan|mist-mint|icon-default-bg)/s);
    expect(leaveStyles).not.toMatch(/\.crew-ui-icon-container[^\{]*\{[^}]*(?:background|color|border-radius|width|height)/s);
  });

  it("keeps SOP Key Points on the shared Mint note owner", () => {
    expect(sopDocument).toContain('className="crew-ui-note crew-ui-note--mint crew-sop-reader-key-point"');
    expect(sopDocument).toContain("<CircleAlert");
    expect(sopDocument).not.toContain("<Star");
    expect(sopDocumentStyles).not.toMatch(/\.crew-sop-reader-key-point\s*\{[^}]*background:/s);
    expect(sopDocumentStyles).not.toMatch(/\.crew-sop-reader-key-point\s*\{[^}]*border-radius:/s);
  });

  it("keeps the Me employment-type badge on the shared Mint status owner", () => {
    expect(system).toContain(".crew-ui-status.is-mint { background: var(--crew-color-icon-default-bg); color: var(--crew-color-icon-default-fg); }");
    expect(meComponent).toContain('<CrewStatusBadge tone="mint">{formatEmploymentType(employmentType)}</CrewStatusBadge>');
    expect(meComponent).toContain('const employmentType = profile?.employment_type || employee.employment_type || "";');
    expect(meComponent).not.toContain('aria-label={t("me.viewProfile")}');
    expect(meComponent).not.toContain('className="crew-me-quick-status"');
    expect(meStyles).not.toContain(".crew-me-profile-copy em");
    expect(meStyles).not.toContain(".crew-me-quick-status");
    expect(meStyles).not.toContain("#e8fbf4");
    expect(meStyles).toContain("@media (max-width: 380px) {");
    expect(meStyles).toContain(".crew-me-profile-hero {");
  });

  it("keeps the Cash Checkout manager-review notice in a canonical two-column warning layout", () => {
    expect(cashCheckout).toContain(".crew-cash-warning { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start;");
    expect(cashCheckout).toContain(".crew-cash-warning > div { display: grid; min-width: 0; gap: 4px;");
  });

  it("keeps all Cash Checkout workflow titles on one canonical detail-title owner", () => {
    expect(cashCheckout).toContain(".crew-cash-count-card > header,.crew-cash-allocation-card > header,.crew-cash-confirm-card > header { align-items: center; margin: 4px 0 16px;");
    expect(cashCheckout).toContain(".crew-cash-count-card > header h2,.crew-cash-allocation-card > header h2,.crew-cash-confirm-card > header h2 { color: var(--crew-color-deep-teal); font-size: var(--crew-type-detail-title);");
  });

  it("keeps Checkout History on the canonical ghost action, icon, divider, and 360px layout owners", () => {
    const cashCheckoutComponent = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewCashCheckoutMobile.jsx"), "utf8");
    expect(cashCheckoutComponent).toContain('className="crew-mobile-ghost" type="button" aria-label={t("cash.checkoutHistory")}');
    expect(cashCheckoutComponent).toContain('className="crew-ui-icon-container crew-ui-icon-container--compact"><CalendarCheck');
    expect(cashCheckout).toContain(".crew-cash-history-list { margin-top: 2px; border-top: 1px solid var(--crew-color-divider);");
    expect(cashCheckout).toContain("@media (max-width: 360px) { .crew-cash-history-row { grid-template-columns: 34px minmax(0, 1fr) auto;");
    const historyStyles = cashCheckout.slice(cashCheckout.indexOf(".crew-cash-history"));
    ["#", "var(--crew-color-cyan)", "linear-gradient", "!important"].forEach((token) => expect(historyStyles).not.toContain(token));
  });

  it("shares one mobile sheet shell between explanatory help and Clock In reason selection", () => {
    expect(bottomSheet).toContain("export default function CrewBottomSheet");
    expect(bottomSheet).toContain('role="dialog"');
    expect(bottomSheet).toContain("aria-modal=\"true\"");
    expect(help).toContain('import CrewBottomSheet from "./CrewBottomSheet.jsx"');
    expect(attendanceComponent).toContain('import CrewBottomSheet from "./CrewBottomSheet.jsx"');
    expect(attendanceComponent).toContain("function ClockReasonSheet");
    expect(attendanceComponent).toContain('className="crew-clock-reason-sheet"');
    expect(attendanceComponent).not.toContain("<SelectField");
    expect(home).toContain(".crew-clock-reason-options");
  });

  it("keeps Performance evidence detail content feature-owned while sharing the bottom-sheet shell", () => {
    expect(growth).toContain('import CrewBottomSheet from "./CrewBottomSheet.jsx"');
    expect(growth).toContain("function PerformanceDetailSheet");
    expect(growth).toContain('className="crew-performance-detail-sheet"');
    expect(growth).not.toContain("function PerformanceModal");
    expect(performanceModal).toContain(".crew-performance-detail-sheet");
    expect(performanceModal).not.toContain(".crew-performance-final-modal-backdrop");
    expect(performanceModal).not.toContain(".crew-performance-detail-modal");
  });

  it("gives Reward one token-based feature presentation owner", () => {
    expect(reward).toContain('import "./CrewRewardMobile.css"');
    expect(rewardStyles).toContain("Reward-specific financial hierarchy and data visualization");
    [".crew-reward-", ".crew-v2-reward-"].forEach((selector) => expect(appStyles).not.toContain(selector));
    [".crew-reward-hero-metrics", ".crew-reward-surface", ".crew-reward-performance-relationship", ".crew-reward-potential", ".crew-reward-modal-history"].forEach((selector) => expect(rewardStyles).toContain(selector));
    expect(system).toContain(".crew-ui-modal");
    expect(system).toContain(".crew-ui-help-sheet");
    expect(system).toContain(".crew-mobile-page-header-action>button:not(.crew-ui-help-trigger)");
    expect(system).not.toContain(".crew-mobile-page-header-action > .crew-ui-help-trigger.is-header");
    expect(help).toContain("export function CrewHelpTrigger");
    expect(help).toContain("export function CrewHelpSheet");
    expect(reward).not.toContain("HeroInfoButton");
    expect(rewardStyles).not.toContain("!important");
  });

  it("routes Growth and My Performance explanatory help through the canonical shared sheet", () => {
    expect(growth).toContain('import { CrewHelpSheet, CrewHelpTrigger } from "./CrewHelp.jsx"');
    expect(growth).toContain('variant="header" label={t("growth.help")}');
    expect(growth).toContain('variant="header" label={t("performance.help")}');
    ["GrowthHelpModal", "crew-growth-final-help", "crew-performance-final-help", "crew-growth-help-section"].forEach((legacy) => {
      expect(growth).not.toContain(legacy);
      expect(growthStyles).not.toContain(`.${legacy}`);
    });
  });

  it("keeps the complete Growth and My Performance presentation out of the app shell", () => {
    expect(growth).toContain('import "./CrewGrowthMobile.css"');
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
