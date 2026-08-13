import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), saveSop: vi.fn(), saveCategory: vi.fn(), newVersion: vi.fn(), saveDraft: vi.fn(),
  saveSections: vi.fn(), deleteDraft: vi.fn(), swap: vi.fn(), publish: vi.fn(), usage: vi.fn(), clone: vi.fn(),
  uploadMedia: vi.fn(), deleteMedia: vi.fn(), mediaUrl: vi.fn(),
}));
vi.mock("../../../../services/crewService.js", () => ({ crewService: {
  listOutletSopsAdmin: mocks.list,
  saveSop: mocks.saveSop,
  saveSopCategory: mocks.saveCategory,
  newSopVersion: mocks.newVersion,
  saveDraftRecord: mocks.saveDraft,
  saveSopDraftSections: mocks.saveSections,
  deleteDraftRecord: mocks.deleteDraft,
  swapDraftOrder: mocks.swap,
  publishSopVersion: mocks.publish,
  sopUsageAdmin: mocks.usage,
  cloneSelectedSops: mocks.clone,
  uploadSopMedia: mocks.uploadMedia,
  deleteSopMedia: mocks.deleteMedia,
  sopMediaAdminUrl: mocks.mediaUrl,
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
  mocks.saveSections.mockReset().mockImplementation(async (_versionId, sections) => sections.map((section, index) => ({ ...section, id: String(section.id).startsWith("temp:") ? `saved-${index}` : section.id, sort_order: index + 1 })));
  mocks.deleteDraft.mockReset().mockResolvedValue();
  mocks.swap.mockReset().mockResolvedValue();
  mocks.publish.mockReset().mockResolvedValue();
  mocks.usage.mockReset().mockResolvedValue({ current: [], historical: [] });
  mocks.clone.mockReset().mockResolvedValue({ sops_cloned: 1, categories_created: 1 });
  mocks.uploadMedia.mockReset().mockResolvedValue({ media: { id: "media-1", mime_type: "image/webp", width: 900, height: 600 }, previewUrl: "blob:sop-signed" });
  mocks.deleteMedia.mockReset().mockResolvedValue({ deleted: true });
  mocks.mediaUrl.mockReset().mockResolvedValue("https://signed.test/sop-image");
  ui.notify.mockReset();
  ui.confirm.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Crew SOP Library Admin", () => {
  it("uses outlet-scoped table filters and shows draft state", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "SOP Library" });
    expect(document.querySelector("table").className).toContain("min-w-[980px]");
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

  it("retains multi-section edits, add, delete and reorder until one whole-draft save", async () => {
    renderPage();
    await screen.findByText("Welcome & Goodbye Standard");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Draft" })[0]);
    const title = screen.getByLabelText("Section Title *");
    fireEvent.change(title, { target: { value: "Welcome promptly" } });
    fireEvent.click(screen.getByRole("button", { name: /02.*Warm presence/ }));
    fireEvent.change(screen.getByLabelText("Section Title *"), { target: { value: "Warm and attentive" } });
    fireEvent.click(screen.getByRole("button", { name: /01.*Welcome promptly/ }));
    expect(screen.getByLabelText("Section Title *").value).toBe("Welcome promptly");
    fireEvent.click(screen.getByRole("button", { name: "Move section down" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Section" }));
    fireEvent.change(screen.getByLabelText("Section Title *"), { target: { value: "Thank the guest" } });
    const editor = screen.getByRole("textbox", { name: "Content" });
    editor.innerHTML = "<p>Thank every guest before leaving.</p>";
    fireEvent.input(editor);
    fireEvent.click(screen.getByLabelText("Key Point"));
    fireEvent.change(screen.getByLabelText("Key Point Content"), { target: { value: "Always end warmly." } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(mocks.saveSections).toHaveBeenCalledTimes(1));
    const [, saved] = mocks.saveSections.mock.calls[0];
    expect(saved.map((section) => section.title)).toEqual(["Warm and attentive", "Welcome promptly", "Thank the guest"]);
    expect(saved[2].body).toContain("data-feedx-key-point");
    expect(screen.getByText("Saved")).not.toBeNull();
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

  it("warns before closing with retained unsaved changes", async () => {
    ui.confirm.mockResolvedValueOnce(false);
    renderPage();
    await screen.findByText("Welcome & Goodbye Standard");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Draft" })[0]);
    fireEvent.change(screen.getByLabelText("Section Title *"), { target: { value: "Unsaved title" } });
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    await waitFor(() => expect(ui.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "You have unsaved changes.", confirmLabel: "Discard", cancelLabel: "Continue Editing" })));
    expect(screen.getByRole("heading", { name: "Welcome & Goodbye Standard" })).not.toBeNull();
  });

  it("uploads a validated image and persists only durable media metadata", async () => {
    document.execCommand = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:sop-preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    renderPage();
    await screen.findByText("Welcome & Goodbye Standard");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Draft" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    fireEvent.click(screen.getByRole("button", { name: "Bullet List" }));
    expect(document.execCommand).toHaveBeenCalledWith("bold", false, null);
    expect(document.execCommand).toHaveBeenCalledWith("insertUnorderedList", false, null);
    const file = new File(["safe"], "guide.png", { type: "image/png" });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await screen.findByText(/Stored privately for this Outlet/);
    expect(mocks.uploadMedia).toHaveBeenCalledWith(file, "v2");
    fireEvent.change(screen.getByLabelText("Image caption"), { target: { value: "Greeting posture" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(mocks.saveSections).toHaveBeenCalledTimes(1));
    const [, saved] = mocks.saveSections.mock.calls[0];
    expect(saved[0].media).toMatchObject({ id: "media-1", caption: "Greeting posture" });
    expect(JSON.stringify(saved)).not.toContain("blob:sop-signed");
    expect(JSON.stringify(saved)).not.toContain("data:image");
  });

  it("switches historical versions from the header popover and keeps usage auxiliary", async () => {
    renderPage();
    await screen.findByText("Welcome & Goodbye Standard");
    fireEvent.click(screen.getByText("Welcome & Goodbye Standard"));
    expect(screen.getByText("Welcome within five seconds.")).not.toBeNull();
    expect(screen.queryByLabelText("Section Title *")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "SOP detail tabs" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "SOP version" }));
    const portalMenu = screen.getByRole("menu", { name: "Version History" });
    expect(portalMenu).not.toBeNull();
    expect(portalMenu.closest('[role="dialog"]')).toBeNull();
    expect(portalMenu.closest(".z-popover-layer")?.dataset.placement).toMatch(/top|bottom/);
    expect(screen.getByText(/Current Live/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Continue Editing" })).not.toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const versionHistory = screen.getByRole("menu", { name: "Version History" });
    fireEvent.click(within(versionHistory).getAllByRole("button", { name: "View" })[0]);
    expect(screen.getByRole("button", { name: "SOP version" }).textContent).toContain("Published v1");
    mocks.usage.mockResolvedValue({ current: [{ journey_id: "j1", journey_name: "New Crew Onboarding", journey_version: 2, module_title: "Greeting", lesson_title: "Welcome guests" }], historical: [{ journey_name: "New Crew Onboarding", journey_version: 1, assignment_count: 3 }] });
    fireEvent.click(screen.getByRole("button", { name: "View Usage" }));
    await screen.findByText("Used in Onboarding");
    expect(screen.getByText("Welcome guests")).not.toBeNull();
    expect(screen.getByText("New Crew Onboarding · Greeting")).not.toBeNull();
    expect(screen.getByText("Historical snapshot · unchanged by future SOP versions")).not.toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it.each([3, 10, 20])("keeps a %i-section published document inside the modal scroll region", async (sectionCount) => {
    const longSections = Array.from({ length: sectionCount }, (_, index) => ({
      id: `long-section-${index + 1}`,
      title: `Long Section ${index + 1}`,
      body: `<p>${"Operational guidance ".repeat(20)}</p>`,
      key_point: false,
      sort_order: index + 1,
    }));
    mocks.list.mockResolvedValue({ categories, sops: [{ ...sops[1], versions: [{ ...sops[1].versions[0], sections: longSections }] }] });
    renderPage();
    await screen.findByText("Kitchen Safety");
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByRole("heading", { name: `Long Section ${sectionCount}` })).not.toBeNull();
    const scrollRegion = document.querySelector(".crew-sop-document-scroll");
    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion.closest(".crew-sop-popout-body")).not.toBeNull();
    expect(scrollRegion.closest(".crew-sop-view-popout")).not.toBeNull();
  });

  it("repositions the version portal inside the viewport near an edge", async () => {
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 720);
    renderPage();
    await screen.findByText("Welcome & Goodbye Standard");
    fireEvent.click(screen.getByText("Welcome & Goodbye Standard"));
    const versionButton = screen.getByRole("button", { name: "SOP version" });
    versionButton.getBoundingClientRect = () => ({ top: 650, bottom: 680, left: 1200, right: 1260, width: 60, height: 30, x: 1200, y: 650, toJSON: () => ({}) });
    fireEvent.click(versionButton);
    await waitFor(() => {
      const layer = screen.getByRole("menu", { name: "Version History" }).closest(".z-popover-layer");
      expect(layer.dataset.placement).toBe("top");
      expect(Number.parseFloat(layer.style.left)).toBeLessThanOrEqual(878);
      expect(Number.parseFloat(layer.style.top)).toBeGreaterThanOrEqual(12);
    });
  });

  it("publishes only after confirmation and refreshes into immutable detail", async () => {
    mocks.list.mockResolvedValueOnce({ categories, sops }).mockResolvedValue({ categories, sops: [{ ...sops[0], current_version: 2, versions: [{ ...draft, status: "published", published_at: "2026-08-12T00:00:00Z" }, published] }] });
    renderPage();
    await screen.findByText("Welcome & Goodbye Standard");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit Draft" })[0]);
    fireEvent.change(screen.getByLabelText("Section Title *"), { target: { value: "Saved before publish" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(mocks.saveSections).toHaveBeenCalledTimes(1));
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
