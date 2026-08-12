import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), saveSop: vi.fn(), saveCategory: vi.fn(), newVersion: vi.fn(), saveDraft: vi.fn(),
  deleteDraft: vi.fn(), swap: vi.fn(), publish: vi.fn(), usage: vi.fn(), clone: vi.fn(),
}));
vi.mock("../../../../services/crewService.js", () => ({ crewService: {
  listOutletSopsAdmin: mocks.list,
  saveSop: mocks.saveSop,
  saveSopCategory: mocks.saveCategory,
  newSopVersion: mocks.newVersion,
  saveDraftRecord: mocks.saveDraft,
  deleteDraftRecord: mocks.deleteDraft,
  swapDraftOrder: mocks.swap,
  publishSopVersion: mocks.publish,
  sopUsageAdmin: mocks.usage,
  cloneSelectedSops: mocks.clone,
} }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) } }));

import CrewSopLibraryPage from "../CrewSopLibraryPage.jsx";

const outlets = [
  { id: "outlet-1", name: "Hola Hola Kopitiam Ipoh", is_active: true },
  { id: "outlet-2", name: "Friends Corner", is_active: true },
];
const categories = [
  { id: "cat-service", name: "Service", sort_order: 10 },
  { id: "cat-safety", name: "Safety", sort_order: 20 },
];
const published = { id: "v1", version: 1, status: "published", require_acknowledgement: true, published_at: "2026-08-11T00:00:00Z", sections: [
  { id: "section-1", title: "Welcome", body: "Welcome within five seconds.", key_point: false, sort_order: 1 },
  { id: "section-2", title: "Warm presence", body: "Smile and make eye contact.", key_point: true, sort_order: 2 },
] };
const draft = { id: "v2", version: 2, status: "draft", require_acknowledgement: true, updated_at: "2026-08-12T00:00:00Z", sections: [
  { id: "draft-section-1", title: "Welcome", body: "Welcome within five seconds.", key_point: false, sort_order: 1 },
  { id: "draft-section-2", title: "Warm presence", body: "Smile and make eye contact.", key_point: true, sort_order: 2 },
] };
const sops = [
  { id: "sop-1", title: "Welcome & Goodbye Standard", summary: "Guest greeting procedure", category: "Service", category_id: "cat-service", status: "published", current_version: 1, updated_at: "2026-08-12T00:00:00Z", versions: [published, draft] },
  { id: "sop-2", title: "Kitchen Safety", summary: "Safe kitchen work", category: "Safety", category_id: "cat-safety", status: "published", current_version: 1, updated_at: "2026-08-11T00:00:00Z", versions: [{ ...published, id: "safety-v1", require_acknowledgement: false }] },
];
const auth = { hasPermission: () => true };
const ui = { notify: vi.fn(), confirm: vi.fn() };
const renderPage = () => render(<CrewSopLibraryPage auth={auth} ui={ui} store={{ outlets }} />);
const selectOption = (label, option) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("button", { name: option }));
};

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue({ categories, sops });
  mocks.saveSop.mockReset().mockResolvedValue({ id: "new-sop" });
  mocks.saveCategory.mockReset();
  mocks.newVersion.mockReset().mockResolvedValue("new-version");
  mocks.saveDraft.mockReset().mockImplementation(async (_table, values) => ({ id: values.id || "new-section", ...values }));
  mocks.deleteDraft.mockReset().mockResolvedValue();
  mocks.swap.mockReset().mockResolvedValue();
  mocks.publish.mockReset().mockResolvedValue();
  mocks.usage.mockReset().mockResolvedValue({ current: [], historical: [] });
  mocks.clone.mockReset().mockResolvedValue({ sops_cloned: 1, categories_created: 1 });
  ui.notify.mockReset();
  ui.confirm.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);

describe("Crew SOP Library Admin", () => {
  it("uses outlet-scoped table filters and shows draft state", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "SOP Library" });
    expect(screen.getByText("Draft v2")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Search SOP"), { target: { value: "Kitchen" } });
    expect(screen.queryByText("Welcome & Goodbye Standard")).toBeNull();
    expect(screen.getByText("Kitchen Safety")).not.toBeNull();
    selectOption("Category", "Service");
    expect(screen.getByText("No SOPs match these filters")).not.toBeNull();
    selectOption("Outlet", "Friends Corner");
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith("outlet-2"));
  });

  it("shows a compact empty state with create and clone actions", async () => {
    mocks.list.mockResolvedValue({ categories: [], sops: [] });
    renderPage();
    await screen.findByText("No SOPs yet");
    expect(screen.getAllByRole("button", { name: /Create SOP|New SOP/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Clone From Outlet" }).length).toBeGreaterThan(0);
  });

  it("keeps row actions lifecycle-specific and never edits published content directly", async () => {
    renderPage();
    await screen.findByText("Welcome & Goodbye Standard");
    expect(screen.getAllByRole("button", { name: "Edit Draft" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Welcome & Goodbye Standard" }));
    expect(screen.getByRole("menuitem", { name: "Delete Draft" })).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Create New Version" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Draft" }));
    await waitFor(() => expect(mocks.deleteDraft).toHaveBeenCalledWith("crew_sop_versions", "v2"));

    expect(screen.getByRole("button", { name: "New Version" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Published" })).toBeNull();
  });

  it("offers edit and safe deletion for a draft-only SOP", async () => {
    const draftOnly = { id: "draft-only", title: "Opening Checklist", summary: "Draft procedure", category: "Service", category_id: "cat-service", status: "draft", current_version: null, updated_at: "2026-08-12T00:00:00Z", versions: [{ ...draft, id: "draft-v1", version: 1 }] };
    mocks.list.mockResolvedValue({ categories, sops: [draftOnly] });
    renderPage();
    await screen.findByText("Opening Checklist");
    const edit = screen.getByRole("button", { name: "Edit" });
    expect(screen.getByRole("button", { name: "Delete" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "New Version" })).toBeNull();
    fireEvent.click(edit);
    expect(screen.getByRole("heading", { name: "Opening Checklist" })).not.toBeNull();
    expect(screen.getAllByText(/Draft v1/).length).toBeGreaterThan(0);
  });

  it("validates the create modal, creates acknowledgement metadata and enters draft editor", async () => {
    const created = { id: "new-sop", title: "Cash Handling", summary: "Cash control", category: "Service", category_id: "cat-service", status: "draft", versions: [{ id: "new-version", version: 1, status: "draft", require_acknowledgement: true, sections: [] }] };
    mocks.list.mockResolvedValueOnce({ categories, sops }).mockResolvedValue({ categories, sops: [...sops, created] });
    renderPage();
    await screen.findByRole("heading", { name: "SOP Library" });
    fireEvent.click(screen.getByRole("button", { name: "New SOP" }));
    const modal = screen.getByRole("heading", { name: "Create SOP" }).closest("div.fixed");
    const createButton = within(modal).getByRole("button", { name: "Create Draft" });
    expect(createButton.disabled).toBe(true);
    fireEvent.change(within(modal).getByLabelText("Title *"), { target: { value: "Cash Handling" } });
    fireEvent.change(within(modal).getByLabelText("Summary"), { target: { value: "Cash control" } });
    fireEvent.click(within(modal).getByLabelText("Acknowledgement Required"));
    fireEvent.click(createButton);
    await screen.findByText("Draft v1");
    expect(mocks.newVersion).toHaveBeenCalledWith("new-sop");
    expect(mocks.saveDraft).toHaveBeenCalledWith("crew_sop_versions", { id: "new-version", require_acknowledgement: true });
    expect(screen.getByRole("heading", { name: "Cash Handling" })).not.toBeNull();
  });

  it("provides one-section-at-a-time editing, key point, save, reorder and delete", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await screen.findByText("Welcome & Goodbye Standard");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Draft" })[0]);
    const title = screen.getByLabelText("Section Title *");
    fireEvent.change(title, { target: { value: "Welcome promptly" } });
    fireEvent.click(screen.getByLabelText("Key Point"));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledWith("crew_sop_sections", expect.objectContaining({ id: "draft-section-1", title: "Welcome promptly", key_point: true })));
    fireEvent.click(screen.getByRole("button", { name: "Move section down" }));
    await waitFor(() => expect(mocks.swap).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Delete section" }));
    await waitFor(() => expect(mocks.deleteDraft).toHaveBeenCalledWith("crew_sop_sections", "draft-section-1"));
    fireEvent.click(screen.getByRole("button", { name: "Add Section" }));
    fireEvent.change(screen.getByLabelText("Section Title *"), { target: { value: "Thank the guest" } });
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Thank every guest before leaving." } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledWith("crew_sop_sections", expect.objectContaining({ sop_version_id: "v2", title: "Thank the guest", sort_order: 3 })));
  });

  it("previews the current draft without turning the document into an editable form", async () => {
    renderPage();
    await screen.findByText("Welcome & Goodbye Standard");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Draft" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "Preview · v2" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "← Back to Editor" })).not.toBeNull();
    expect(screen.getByText("Smile and make eye contact.")).not.toBeNull();
    expect(screen.queryByLabelText("Document version")).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("uses one read-only document popup and switches version history plus usage in the same modal", async () => {
    renderPage();
    await screen.findByText("Welcome & Goodbye Standard");
    fireEvent.click(screen.getByText("Welcome & Goodbye Standard"));
    expect(screen.getByText("Welcome within five seconds.")).not.toBeNull();
    expect(screen.queryByLabelText("Section Title *")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "SOP detail tabs" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Version History" }));
    expect(screen.getByRole("heading", { name: "Version History" })).not.toBeNull();
    expect(screen.getByText("Current Live")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Continue Editing" })).not.toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "← Back to SOP" }));
    mocks.usage.mockResolvedValue({ current: [{ journey_id: "j1", journey_name: "New Crew Onboarding", journey_version: 2, module_title: "Greeting", lesson_title: "Welcome guests" }], historical: [{ journey_name: "New Crew Onboarding", journey_version: 1, assignment_count: 3 }] });
    fireEvent.click(screen.getByRole("button", { name: "View Usage" }));
    await screen.findByText("Used in Onboarding");
    expect(screen.getByText("Welcome guests")).not.toBeNull();
    expect(screen.getByText("New Crew Onboarding · Greeting")).not.toBeNull();
    expect(screen.getByText("Historical snapshot · unchanged by future SOP versions")).not.toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("publishes only after confirmation and refreshes into immutable detail", async () => {
    mocks.list.mockResolvedValueOnce({ categories, sops }).mockResolvedValue({ categories, sops: [{ ...sops[0], current_version: 2, versions: [{ ...draft, status: "published", published_at: "2026-08-12T00:00:00Z" }, published] }] });
    renderPage();
    await screen.findByText("Welcome & Goodbye Standard");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Draft" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(ui.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Publish SOP v2?" })));
    expect(mocks.publish).toHaveBeenCalledWith("v2");
  });

  it("clones only selected published SOPs from an accessible outlet", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "SOP Library" });
    fireEvent.click(screen.getByRole("button", { name: "Clone From Outlet" }));
    await screen.findByRole("heading", { name: "Clone SOP Library" });
    expect(screen.getByLabelText("Source Outlet").textContent).toContain("Friends Corner");
    await waitFor(() => expect(screen.getByLabelText("Kitchen Safety")).not.toBeNull());
    fireEvent.click(screen.getByLabelText("Kitchen Safety"));
    fireEvent.click(screen.getByRole("button", { name: "Clone SOPs" }));
    await waitFor(() => expect(mocks.clone).toHaveBeenCalledWith(expect.objectContaining({ sourceOutletId: "outlet-2", targetOutletId: "outlet-1", sopIds: ["sop-1"] })));
  });
});
