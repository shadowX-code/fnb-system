import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  listOnboarding: vi.fn(),
  progress: vi.fn(),
  listSops: vi.fn(),
  learningHome: vi.fn(),
  learningAssignment: vi.fn(),
  sopLibrary: vi.fn(),
  sopVersion: vi.fn(),
  saveOnboardingDraft: vi.fn(),
  newJourneyVersion: vi.fn(),
  createDefaultOnboarding: vi.fn(),
  publishJourney: vi.fn(),
  cloneLearningSetup: vi.fn(),
}));

vi.mock("../../../../services/crewService.js", () => ({
  crewService: {
    listOnboardingAdmin: mocks.listOnboarding,
    onboardingProgress: mocks.progress,
    listOutletSopsAdmin: mocks.listSops,
    learningHome: mocks.learningHome,
    learningAssignment: mocks.learningAssignment,
    sopLibrary: mocks.sopLibrary,
    sopVersion: mocks.sopVersion,
    saveOnboardingDraft: mocks.saveOnboardingDraft,
    newJourneyVersion: mocks.newJourneyVersion,
    createDefaultOnboarding: mocks.createDefaultOnboarding,
    publishJourney: mocks.publishJourney,
    cloneLearningSetup: mocks.cloneLearningSetup,
  },
}));
vi.mock("../../../../services/outletService.js", () => ({
  outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../../../services/employeeService.js", () => ({
  employeeService: { listEmployees: vi.fn().mockResolvedValue([]) },
}));

import CrewLearningAdminResetPage from "../CrewLearningAdminResetPage.jsx";
import CrewLearningMobile from "../../components/CrewLearningMobile.jsx";

const outlets = [
  { id: "outlet-1", name: "Hola Hola Kopitiam Ipoh", is_active: true },
  { id: "outlet-2", name: "JYMT Kopitiam", is_active: true },
];
const modules = [
  "Welcome & Workplace",
  "Customer Arrival & Greeting",
  "Taking Orders",
  "Serving & Table Service",
  "Cleaning & Hygiene",
  "Take Away & Packaging",
  "Opening & Closing",
  "Final & Role Readiness",
].map((title, index) => ({
  id: `module-${index + 1}`,
  title,
  description: `${title} standards`,
  sort_order: index + 1,
  required: true,
  lessons: [{
    id: `lesson-${index + 1}`,
    title: `${title} essentials`,
    sort_order: 1,
    required: true,
    estimated_minutes: 5,
    blocks: index === 0 ? [{ id: "block-1", block_type: "text", sort_order: 1, payload: { body: "Welcome to the team", body_html: "<p>Welcome to the team</p>" } }] : [],
    quizzes: index === 1 ? [{ id: "quiz-1", title: "Greeting Check", passing_score: 80, required: true, questions: [{ id: "question-1", prompt: "When should you greet a guest?", question_type: "single_choice", sort_order: 1, options: [{ id: "option-1", label: "Within 5 seconds", is_correct: true, sort_order: 1 }, { id: "option-2", label: "After ordering", is_correct: false, sort_order: 2 }] }] }] : [],
  }],
}));
const journey = {
  id: "journey-2",
  name: "New Crew Onboarding",
  description: "Essential onboarding",
  version: 2,
  status: "published",
  updated_at: "2026-08-12T00:00:00Z",
  modules,
};
const draftJourney = { ...structuredClone(journey), id: "journey-draft", version: 3, status: "draft" };
const categories = [{ id: "cat-service", name: "Service", sort_order: 10 }];
const sops = [
  {
    id: "sop-1",
    title: "Welcome & Goodbye Standard",
    summary: "Guest welcome standard",
    category: "Service",
    category_id: "cat-service",
    status: "published",
    current_version: 1,
    versions: [{ id: "version-1", version: 1, status: "published", require_acknowledgement: true }],
  },
];
const auth = {
  isProtectedRole: true,
  profile: { role_id: "owner" },
  hasPermission: () => true,
};
const ui = { notify: vi.fn(), confirm: vi.fn() };

beforeEach(() => {
  mocks.listOnboarding.mockReset().mockResolvedValue([journey, draftJourney]);
  mocks.progress.mockReset().mockResolvedValue([
    {
      employee: { id: "employee-1", full_name: "Alex Tan", position: "Crew" },
      status: "in_progress",
      progress_percentage: 62,
      completed_modules: 4,
      total_modules: 8,
      knowledge_checks_passed: 3,
      knowledge_checks_total: 4,
      current_module: "Cleaning & Hygiene",
      started_at: "2026-08-10T00:00:00Z",
    },
  ]);
  mocks.listSops.mockReset().mockResolvedValue({ categories, sops });
  mocks.saveOnboardingDraft.mockReset().mockImplementation(async (_original, next) => structuredClone(next));
  mocks.newJourneyVersion.mockReset().mockResolvedValue("journey-draft");
  mocks.createDefaultOnboarding.mockReset().mockResolvedValue("journey-draft");
  mocks.publishJourney.mockReset().mockResolvedValue("journey-draft");
  mocks.cloneLearningSetup.mockReset().mockResolvedValue("journey-draft");
  ui.notify.mockReset();
  ui.confirm.mockReset().mockResolvedValue(true);
});

afterEach(cleanup);

describe("Crew Learning architecture reset UI", () => {
  it("shows one outlet-scoped management page with summary, eight modules and Crew Progress", async () => {
    render(<CrewLearningAdminResetPage auth={auth} ui={ui} store={{ outlets }} />);

    await screen.findByRole("heading", { name: "New Crew Onboarding", level: 1 });
    expect(screen.getAllByText("New Crew Onboarding")).toHaveLength(1);
    expect(screen.getByLabelText("Outlet").textContent).toContain("Hola Hola Kopitiam Ipoh");
    expect(screen.getAllByText("8", { selector: ".crew-onboarding-summary strong" })).toHaveLength(2);
    expect(screen.queryByText("Overview")).toBeNull();
    expect(screen.queryByText("Journey Settings")).toBeNull();
    for (const module of modules) expect(screen.getByText(module.title)).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Crew Progress" }));
    expect(await screen.findByText("Alex Tan")).not.toBeNull();
    expect(screen.getAllByText("62%")).toHaveLength(2);
  });

  it("opens module information without navigating to another page", async () => {
    render(<CrewLearningAdminResetPage auth={auth} ui={ui} store={{ outlets }} />);
    fireEvent.click(await screen.findByRole("button", { name: /01.*Welcome & Workplace/i }));
    expect(screen.getByRole("dialog", { name: "Welcome & Workplace" })).not.toBeNull();
    expect(screen.getByText("Welcome & Workplace essentials")).not.toBeNull();
  });

  it("creates the next editable draft through the controlled lifecycle when only a published version exists", async () => {
    mocks.listOnboarding.mockReset().mockResolvedValueOnce([journey]).mockResolvedValueOnce([journey, draftJourney]);
    render(<CrewLearningAdminResetPage auth={auth} ui={ui} store={{ outlets }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Onboarding" }));
    await waitFor(() => expect(mocks.newJourneyVersion).toHaveBeenCalledWith("journey-2"));
    expect(await screen.findByRole("dialog", { name: "Edit New Crew Onboarding" })).not.toBeNull();
  });

  it("retains edits while switching modules and sends one whole-draft save", async () => {
    render(<CrewLearningAdminResetPage auth={auth} ui={ui} store={{ outlets }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue Editing Draft" }));
    expect(await screen.findByRole("dialog", { name: "Edit New Crew Onboarding" })).not.toBeNull();
    expect(screen.queryByText("Journey Settings")).toBeNull();

    const title = screen.getByLabelText("Module Title");
    fireEvent.change(title, { target: { value: "Welcome Foundation" } });
    fireEvent.click(screen.getByText("Customer Arrival & Greeting", { selector: ".crew-onboarding-module-outline strong" }).closest("button"));
    fireEvent.change(screen.getByLabelText("Module Title"), { target: { value: "Guest Connection" } });
    fireEvent.click(screen.getByText("Welcome Foundation", { selector: ".crew-onboarding-module-outline strong" }).closest("button"));
    expect(screen.getByLabelText("Module Title").value).toBe("Welcome Foundation");

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(mocks.saveOnboardingDraft).toHaveBeenCalledTimes(1));
    const saved = mocks.saveOnboardingDraft.mock.calls[0][1];
    expect(saved.modules[0].title).toBe("Welcome Foundation");
    expect(saved.modules[1].title).toBe("Guest Connection");
  });

  it("edits lessons and content in the same editor and preserves unsaved state", async () => {
    render(<CrewLearningAdminResetPage auth={auth} ui={ui} store={{ outlets }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue Editing Draft" }));
    await screen.findByRole("dialog", { name: "Edit New Crew Onboarding" });
    fireEvent.click(screen.getByText("Welcome & Workplace essentials", { selector: ".crew-onboarding-lesson-entry strong" }).closest("button"));
    fireEvent.change(screen.getByLabelText("Lesson Title"), { target: { value: "Welcome to Friends Corner" } });
    fireEvent.click(screen.getByRole("button", { name: "Welcome & Workplace" }));
    fireEvent.click(screen.getByText("Welcome to Friends Corner", { selector: ".crew-onboarding-lesson-entry strong" }).closest("button"));
    expect(screen.getByLabelText("Lesson Title").value).toBe("Welcome to Friends Corner");
    expect(screen.getByText("Unsaved Changes")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add Content" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Key Point" }));
    expect(screen.getAllByText("Key Point").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "Onboarding Preview" })).not.toBeNull();
  });

  it("warns before discarding unsaved changes and saves before publish", async () => {
    render(<CrewLearningAdminResetPage auth={auth} ui={ui} store={{ outlets }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue Editing Draft" }));
    await screen.findByRole("dialog", { name: "Edit New Crew Onboarding" });
    fireEvent.change(screen.getByLabelText("Module Title"), { target: { value: "Changed Module" } });
    ui.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    await waitFor(() => expect(ui.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "You have unsaved changes." })));

    ui.confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(mocks.saveOnboardingDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.publishJourney).toHaveBeenCalledWith("journey-draft"));
  });

  it("switches outlet context and scopes every Admin query to the selected outlet", async () => {
    mocks.listOnboarding.mockResolvedValue([]);
    mocks.progress.mockResolvedValue([]);
    mocks.listSops.mockResolvedValue({ categories: [], sops: [] });
    render(<CrewLearningAdminResetPage auth={auth} ui={ui} store={{ outlets }} />);
    await screen.findByText(/No onboarding setup for/);
    fireEvent.click(screen.getByLabelText("Outlet"));
    fireEvent.click(screen.getByRole("button", { name: "JYMT Kopitiam" }));
    await waitFor(() => expect(mocks.listOnboarding).toHaveBeenCalledWith("outlet-2"));
    expect(mocks.progress).toHaveBeenCalledWith("outlet-2");
    expect(mocks.listSops).toHaveBeenCalledWith("outlet-2");
  });

  it("keeps outlet-scoped Onboarding available when an optional SOP query times out", async () => {
    mocks.listSops.mockRejectedValueOnce(new Error("statement timeout"));
    render(<CrewLearningAdminResetPage auth={auth} ui={ui} store={{ outlets }} />);
    expect(await screen.findByText("Welcome & Workplace")).not.toBeNull();
    expect(screen.getAllByText("Hola Hola Kopitiam Ipoh").length).toBeGreaterThan(0);
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "SOP references are temporarily unavailable" }));
  });

  it("uses the App-scoped outlet store without requiring duplicate role outlet metadata", async () => {
    const scopedAuth = {
      ...auth,
      isProtectedRole: false,
      profile: {
        role_id: "crew-admin-qa",
        role_outlet_access_type: "selected",
      },
    };
    render(
      <CrewLearningAdminResetPage
        auth={scopedAuth}
        ui={ui}
        store={{ outlets: [outlets[0]] }}
      />,
    );
    await screen.findByRole("heading", { name: "New Crew Onboarding", level: 1 });
    expect(screen.getByLabelText("Outlet").textContent).toContain("Hola Hola Kopitiam Ipoh");
  });

  it("clones only the Onboarding setup into the selected target outlet", async () => {
    render(<CrewLearningAdminResetPage auth={auth} ui={ui} store={{ outlets }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Clone From Outlet" }));
    expect(screen.getByText("Onboarding Structure")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clone Onboarding" }));
    await waitFor(() => expect(mocks.cloneLearningSetup).toHaveBeenCalledWith({ sourceOutletId: "outlet-2", targetOutletId: "outlet-1", copyOnboarding: true, copyCategories: false, copySops: false }));
  });
});

describe("Crew mobile Learn reset", () => {
  beforeEach(() => {
    mocks.learningHome.mockReset().mockResolvedValue({
      assignment: {
        id: "assignment-1",
        status: "completed",
        progress_percentage: 100,
        lessons_completed: 9,
        lessons_total: 9,
      },
    });
    mocks.learningAssignment.mockReset().mockResolvedValue({
      id: "assignment-1",
      status: "completed",
      journey: { name: "New Crew Onboarding", description: "Essential onboarding" },
      modules: modules.map((module) => ({
        module,
        completed: true,
        locked: false,
        progress_percentage: 100,
        lessons: [],
      })),
    });
    mocks.sopLibrary.mockReset().mockResolvedValue({
      categories,
      sops: [
        {
          id: "sop-1",
          title: "Welcome & Goodbye Standard",
          category: "Service",
          category_id: "cat-service",
          version_id: "version-1",
          version: 1,
          acknowledgement_required: true,
          acknowledged: false,
        },
      ],
    });
  });

  it("keeps completed onboarding visible for review and exposes the outlet SOP knowledge base", async () => {
    render(<CrewLearningMobile token="crew-token" />);
    await screen.findByText("Build confidence for every shift.");
    expect(screen.getByRole("button", { name: "Review onboarding" })).not.toBeNull();
    expect(screen.getByText("Required acknowledgements")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Browse SOP Library/ }));
    expect(screen.getByPlaceholderText("Search SOP")).not.toBeNull();
    expect(screen.getByText("Welcome & Goodbye Standard")).not.toBeNull();
    expect(JSON.stringify(mocks.learningAssignment.mock.results)).not.toContain("is_correct");
  });
});
