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
  lessons: [{ id: `lesson-${index + 1}`, title: `${title} essentials`, sort_order: 1 }],
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
  mocks.listOnboarding.mockReset().mockResolvedValue([journey]);
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
  ui.notify.mockReset();
  ui.confirm.mockReset().mockResolvedValue(true);
});

afterEach(cleanup);

describe("Crew Learning architecture reset UI", () => {
  it("shows one outlet-scoped Onboarding workspace with eight modules and no generic Journey navigation", async () => {
    render(
      <CrewLearningAdminResetPage
        auth={auth}
        ui={ui}
        store={{ outlets }}
        initialTab="onboarding"
      />,
    );

    await screen.findByRole("heading", { name: "New Crew Onboarding", level: 1 });
    expect(screen.getByLabelText("Outlet").value).toBe("outlet-1");
    expect(
      screen.getByText(/Mandatory for all eligible Crew$/),
    ).not.toBeNull();
    expect(screen.queryByText("Journey Library")).toBeNull();
    expect(screen.queryByText("Assign Crew")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "modules" }));
    for (const module of modules) {
      expect(screen.getByText(module.title)).not.toBeNull();
    }

    fireEvent.click(screen.getByRole("button", { name: "crew progress" }));
    expect(screen.getByText("Alex Tan")).not.toBeNull();
    expect(screen.getByText("62%")).not.toBeNull();
  });

  it("switches outlet context and scopes every Admin query to the selected outlet", async () => {
    mocks.listOnboarding.mockResolvedValue([]);
    mocks.progress.mockResolvedValue([]);
    mocks.listSops.mockResolvedValue({ categories: [], sops: [] });
    render(<CrewLearningAdminResetPage auth={auth} ui={ui} store={{ outlets }} />);
    await screen.findByText(/No onboarding setup for/);
    fireEvent.change(screen.getByLabelText("Outlet"), { target: { value: "outlet-2" } });
    await waitFor(() => expect(mocks.listOnboarding).toHaveBeenCalledWith("outlet-2"));
    expect(mocks.progress).toHaveBeenCalledWith("outlet-2");
    expect(mocks.listSops).toHaveBeenCalledWith("outlet-2");
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
    expect(screen.getByLabelText("Outlet").value).toBe("outlet-1");
  });

  it("groups the SOP Library by category with one primary creation action", async () => {
    render(
      <CrewLearningAdminResetPage
        auth={auth}
        ui={ui}
        store={{ outlets }}
        initialTab="sops"
      />,
    );
    await screen.findByRole("heading", { name: "SOP Library", level: 1 });
    expect(screen.getByRole("button", { name: "New SOP" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Service" })).not.toBeNull();
    expect(screen.getByText("Welcome & Goodbye Standard")).not.toBeNull();
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
