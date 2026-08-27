import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  listOnboarding: vi.fn(),
  getOnboarding: vi.fn(),
  progress: vi.fn(),
  listSops: vi.fn(),
  learningHome: vi.fn(),
  learningAssignment: vi.fn(),
  learningMediaUrl: vi.fn(),
  sopLibrary: vi.fn(),
  sopVersion: vi.fn(),
  acknowledgeSop: vi.fn(),
  saveOnboardingDraft: vi.fn(),
  newJourneyVersion: vi.fn(),
  createDefaultOnboarding: vi.fn(),
  uploadLearningMedia: vi.fn(),
  deleteLearningMedia: vi.fn(),
  learningMediaAdminUrl: vi.fn(),
  publishJourney: vi.fn(),
  cloneLearningSetup: vi.fn(),
  localization: vi.fn(), saveLocalization: vi.fn(), translate: vi.fn(), editTranslation: vi.fn(), reviewTranslation: vi.fn(), localizedForCrew: vi.fn(),
}));

vi.mock("../../../../services/crewService.js", () => ({
  crewService: {
    listOnboardingAdmin: mocks.listOnboarding,
    getOnboardingAdmin: mocks.getOnboarding,
    onboardingProgress: mocks.progress,
    listOutletSopsAdmin: mocks.listSops,
    learningHome: mocks.learningHome,
    learningAssignment: mocks.learningAssignment,
    learningMediaUrl: mocks.learningMediaUrl,
    sopLibrary: mocks.sopLibrary,
    sopVersion: mocks.sopVersion,
    acknowledgeSop: mocks.acknowledgeSop,
    saveOnboardingDraft: mocks.saveOnboardingDraft,
    newJourneyVersion: mocks.newJourneyVersion,
    createDefaultOnboarding: mocks.createDefaultOnboarding,
    uploadLearningMedia: mocks.uploadLearningMedia,
    deleteLearningMedia: mocks.deleteLearningMedia,
    learningMediaAdminUrl: mocks.learningMediaAdminUrl,
    publishJourney: mocks.publishJourney,
    cloneLearningSetup: mocks.cloneLearningSetup,
    localizedContentAdmin: mocks.localization,
    saveLocalizedContentUnits: mocks.saveLocalization,
    translateLocalizedContent: mocks.translate,
    editLocalizedTranslation: mocks.editTranslation,
    reviewLocalizedTranslation: mocks.reviewTranslation,
    localizedContentForCrew: mocks.localizedForCrew,
  },
}));
vi.mock("../../../../services/outletService.js", () => ({
  outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../../../services/employeeService.js", () => ({
  employeeService: { listEmployees: vi.fn().mockResolvedValue([]) },
}));

import CrewLearningAdminResetPage from "../CrewLearningAdminResetPage.jsx";
import CrewLearningMobile, { resetCrewLearnCacheForTests } from "../../components/CrewLearningMobile.jsx";

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
  mocks.getOnboarding.mockReset().mockImplementation(async (journeyId) => structuredClone(journeyId === draftJourney.id ? draftJourney : journey));
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
  mocks.uploadLearningMedia.mockReset().mockResolvedValue({
    media: { id: "00000000-0000-4000-8000-000000000001", mime_type: "image/webp", width: 1200, height: 800 },
    previewUrl: "https://signed.test/admin-preview.webp",
  });
  mocks.deleteLearningMedia.mockReset().mockResolvedValue({ deleted: true });
  mocks.learningMediaAdminUrl.mockReset().mockResolvedValue("https://signed.test/admin-preview.webp");
  mocks.publishJourney.mockReset().mockResolvedValue("journey-draft");
  mocks.cloneLearningSetup.mockReset().mockResolvedValue("journey-draft");
  mocks.localization.mockReset().mockResolvedValue({ units: {} });
  mocks.saveLocalization.mockReset().mockResolvedValue({ units: {} });
  mocks.localizedForCrew.mockReset().mockResolvedValue({});
  ui.notify.mockReset();
  ui.confirm.mockReset().mockResolvedValue(true);
});

afterEach(() => { cleanup(); resetCrewLearnCacheForTests(); vi.useRealTimers(); });

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

  it("uploads learning images into draft state and persists only durable media metadata", async () => {
    const { container } = render(<CrewLearningAdminResetPage auth={auth} ui={ui} store={{ outlets }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue Editing Draft" }));
    await screen.findByRole("dialog", { name: "Edit New Crew Onboarding" });
    fireEvent.click(screen.getByText("Welcome & Workplace essentials", { selector: ".crew-onboarding-lesson-entry strong" }).closest("button"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = container.querySelector('input[type="file"][accept="image/jpeg,image/png,image/webp"]');
    fireEvent.change(input, { target: { files: [new File(["image"], "welcome.png", { type: "image/png" })] } });
    expect(await screen.findByAltText("Learning content preview")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Image Caption"), { target: { value: "Welcome example" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(mocks.saveOnboardingDraft).toHaveBeenCalled());
    const saved = mocks.saveOnboardingDraft.mock.calls.at(-1)[1];
    const media = saved.modules[0].lessons[0].blocks[0].payload.media;
    expect(media.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(media.caption).toBe("Welcome example");
    expect(JSON.stringify(media)).not.toContain("signed.test");
    expect(JSON.stringify(media)).not.toContain("data:image");
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

  it("renders a retryable error instead of a false empty state when Onboarding times out", async () => {
    mocks.listOnboarding.mockRejectedValueOnce(new Error("canceling statement due to statement timeout"));
    render(<CrewLearningAdminResetPage auth={auth} ui={ui} store={{ outlets }} />);
    expect(await screen.findByText("Unable to load onboarding")).not.toBeNull();
    expect(screen.queryByText(/No onboarding setup for/)).toBeNull();
    mocks.listOnboarding.mockResolvedValueOnce([journey]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Welcome & Workplace")).not.toBeNull();
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
    mocks.learningMediaUrl.mockReset().mockResolvedValue({ signed_url: "https://signed.test/lesson.webp" });
    mocks.sopVersion.mockReset().mockResolvedValue({
      id: "version-1",
      title: "Welcome & Goodbye Standard",
      version: 1,
      category: "Service",
      acknowledgement_required: true,
      acknowledged: false,
      sections: [{ id: "section-1", title: "Greeting", body: "<p>Welcome every guest warmly.</p>" }],
    });
    mocks.acknowledgeSop.mockReset().mockResolvedValue({ acknowledged: true, acknowledged_at: "2026-08-27T10:42:00Z" });
  });

  it("keeps completed onboarding visible for review and exposes the outlet SOP knowledge base", async () => {
    render(<CrewLearningMobile token="crew-token" />);
    await screen.findByRole("heading", { name: "Learn" });
    expect(screen.getByRole("button", { name: /Onboarding Completed/ })).not.toBeNull();
    expect(screen.getByPlaceholderText("Search SOP, topic or keyword")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Category" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "SOPs 1" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /View all/ })).toBeNull();
    expect(screen.getByText("Welcome & Goodbye Standard")).not.toBeNull();
    expect(screen.getByText("Required")).not.toBeNull();
    expect(screen.queryByText("I acknowledge this SOP")).toBeNull();
    expect(JSON.stringify(mocks.learningAssignment.mock.results)).not.toContain("is_correct");
  });

  it("renders a white Learn shell immediately and delays its compact loading mark without skeleton placeholders", async () => {
    let resolveHome;
    let resolveLibrary;
    mocks.learningHome.mockImplementation(() => new Promise((resolve) => { resolveHome = resolve; }));
    mocks.sopLibrary.mockImplementation(() => new Promise((resolve) => { resolveLibrary = resolve; }));
    vi.useFakeTimers();

    render(<CrewLearningMobile token="crew-token" />);

    expect(screen.getByRole("heading", { name: "Learn" })).not.toBeNull();
    expect(screen.queryByRole("status", { name: /Loading Learn content/ })).toBeNull();
    expect(document.querySelector(".crew-learn-loading-search")).toBeNull();
    expect(document.querySelector(".crew-learn-loading-onboarding")).toBeNull();
    expect(document.querySelector(".crew-learn-loading-section")).toBeNull();
    expect(screen.queryByText("Loading Learn...")).toBeNull();
    expect(mocks.learningHome).toHaveBeenCalledTimes(1);
    expect(mocks.sopLibrary).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(299); });
    expect(screen.queryByRole("status", { name: /Loading Learn content/ })).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    const loadingMark = screen.getByRole("status", { name: /Loading Learn content/ });
    expect(loadingMark.querySelector("img").getAttribute("src")).toBe("/logo-icon.jpg");

    await act(async () => {
      resolveHome({ assignment: null, required_sops: [] });
      resolveLibrary({ categories: [], sops: [] });
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "SOPs 0" })).not.toBeNull();
    expect(screen.queryByRole("status", { name: /Loading Learn content/ })).toBeNull();
    expect(mocks.learningHome).toHaveBeenCalledTimes(1);
    expect(mocks.sopLibrary).toHaveBeenCalledTimes(1);
    expect(mocks.learningAssignment).not.toHaveBeenCalled();
  });

  it("keeps the last safe Learn snapshot visible while a repeat visit refreshes in the background", async () => {
    const first = render(<CrewLearningMobile token="crew-token" />);
    expect(await screen.findByText("Welcome & Goodbye Standard")).not.toBeNull();
    first.unmount();

    render(<CrewLearningMobile token="crew-token" />);

    expect(screen.getByText("Welcome & Goodbye Standard")).not.toBeNull();
    expect(screen.queryByRole("status", { name: /Loading Learn/ })).toBeNull();
    await waitFor(() => expect(mocks.learningHome).toHaveBeenCalledTimes(2));
    expect(mocks.sopLibrary).toHaveBeenCalledTimes(2);
  });

  it("synchronizes search, categories, counts and acknowledgement states", async () => {
    mocks.sopLibrary.mockResolvedValue({
      categories: [
        { id: "cat-service", name: "Service" },
        { id: "cat-cleaning", name: "Cleaning" },
      ],
      sops: [
        { id: "sop-1", version_id: "version-1", title: "Greeting Standard", category: "Service", category_id: "cat-service", version: 2, acknowledgement_required: true, acknowledged: false },
        { id: "sop-2", version_id: "version-2", title: "Table Service", category: "Service", category_id: "cat-service", version: 1, acknowledgement_required: false, acknowledged: false },
        { id: "sop-3", version_id: "version-3", title: "Kitchen Cleanliness", category: "Cleaning", category_id: "cat-cleaning", version: 1, acknowledgement_required: true, acknowledged: true, acknowledged_at: "2026-08-12T00:00:00Z" },
      ],
    });

    render(<CrewLearningMobile token="crew-token" />);
    expect(await screen.findByRole("heading", { name: "SOPs 3" })).not.toBeNull();
    expect(screen.getByText("Optional")).not.toBeNull();
    expect(screen.getByText("Acknowledged")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cleaning, 1" }));
    expect(screen.getByRole("heading", { name: "SOPs 1" })).not.toBeNull();
    expect(screen.queryByText("Greeting Standard")).toBeNull();
    expect(screen.getByText("Kitchen Cleanliness")).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search SOP, topic or keyword"), { target: { value: "missing" } });
    expect(screen.getByRole("heading", { name: "SOPs 0" })).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search SOP, topic or keyword"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "All, 3" }));
    expect(screen.getByRole("heading", { name: "SOPs 3" })).not.toBeNull();
  });

  it("opens an SOP from the compact library row and preserves the controlled acknowledgement flow", async () => {
    render(<CrewLearningMobile token="crew-token" />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Welcome & Goodbye Standard" }));
    expect(await screen.findByRole("heading", { name: "Welcome & Goodbye Standard", level: 1 })).not.toBeNull();
    expect(screen.getByText("Welcome every guest warmly.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I acknowledge this SOP" }));
    await waitFor(() => expect(mocks.acknowledgeSop).toHaveBeenCalledWith("crew-token", "version-1", "direct_library"));
    const acknowledged = await screen.findByRole("status", { name: "SOP acknowledged" });
    expect(acknowledged.textContent).toContain("Acknowledged 27 Aug 2026 · 6:42 pm");
    expect(screen.queryByText(/confirmed version/i)).toBeNull();
  });

  it("renders safe rich lesson content and token-bound published media on mobile", async () => {
    mocks.learningHome.mockResolvedValue({
      assignment: { id: "assignment-1", status: "in_progress", progress_percentage: 0, lessons_completed: 0, lessons_total: 1 },
    });
    mocks.learningAssignment.mockResolvedValue({
      id: "assignment-1",
      status: "in_progress",
      journey: { name: "New Crew Onboarding", description: "Essential onboarding" },
      modules: [{
        module: { id: "module-rich", title: "Welcome & Workplace" },
        completed: false,
        locked: false,
        progress_percentage: 0,
        lessons: [{
          lesson: { id: "lesson-rich", title: "Welcome rich lesson", estimated_minutes: 5 },
          completed: false,
          locked: false,
          blocks: [{
            id: "block-rich",
            block_type: "text",
            payload: {
              body_html: '<p><strong>Serve warmly</strong> and <em>listen</em>.</p><ul><li>Smile</li></ul><a href="https://feedx.test">Open guide</a><script>unsafe()</script>',
              media: { id: "00000000-0000-4000-8000-000000000001", caption: "Greeting example", width: 1200, height: 800 },
            },
          }],
        }],
      }],
    });

    render(<CrewLearningMobile token="crew-token" />);
    fireEvent.click(await screen.findByRole("button", { name: /New Crew Onboarding/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Welcome rich lesson/ }));

    expect(await screen.findByText("Serve warmly")).not.toBeNull();
    expect(screen.getByText("listen").tagName).toBe("EM");
    expect(screen.getByText("Smile").closest("ul")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open guide" }).getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByText("unsafe()", { exact: true })).toBeNull();
    expect(await screen.findByAltText("Greeting example")).not.toBeNull();
    expect(mocks.learningMediaUrl).toHaveBeenCalledWith("crew-token", "00000000-0000-4000-8000-000000000001");
  });

  it("uses the shared journey, lesson, quiz, SOP, and completion presentation owners", async () => {
    mocks.learningHome.mockResolvedValue({
      assignment: { id: "assignment-1", status: "in_progress", progress_percentage: 50, lessons_completed: 1, lessons_total: 2 },
    });
    mocks.learningAssignment.mockResolvedValue({
      id: "assignment-1",
      status: "in_progress",
      journey: { name: "New Crew Onboarding", description: "Essential onboarding" },
      modules: [{
        module: { id: "module-1", title: "Welcome" },
        completed: false,
        locked: false,
        progress_percentage: 50,
        lessons: [{
          lesson: { id: "lesson-ui", title: "Service basics", estimated_minutes: 5 },
          completed: false,
          locked: false,
          blocks: [
            { id: "key-point", block_type: "key_point", payload: { body: "Keep guests informed." } },
            { id: "sop-reference", block_type: "sop_reference", payload: { sop_version_id: "version-1", title: "Greeting Standard", version: 1, required_acknowledgement: true } },
          ],
          quiz: {
            id: "quiz-ui",
            title: "Service check",
            passing_score: 80,
            questions: [{ id: "question-ui", prompt: "Greet the guest?", question_type: "single_choice", options: [{ id: "yes", label: "Yes" }] }],
          },
        }],
      }],
    });

    render(<CrewLearningMobile token="crew-token" />);
    fireEvent.click(await screen.findByRole("button", { name: /New Crew Onboarding/ }));
    expect(document.querySelector(".crew-learning-journey-hero.crew-ui-functional-surface")).not.toBeNull();
    expect(document.querySelector(".crew-learning-module .crew-ui-progress")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Service basics/ }));

    expect(await screen.findByText("Keep guests informed.")).not.toBeNull();
    expect(document.querySelector(".crew-learning-content-block.crew-ui-note--mint.is-key-point")).not.toBeNull();
    expect(document.querySelector(".crew-learning-sop-reference.crew-ui-functional-surface")).not.toBeNull();
    expect(document.querySelector(".crew-quiz label")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Yes"));
    expect(document.querySelector(".crew-quiz label.is-selected")).not.toBeNull();
  });
});
