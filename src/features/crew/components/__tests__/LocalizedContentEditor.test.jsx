import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), edit: vi.fn(), save: vi.fn(), translate: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { localizedContentAdmin: mocks.read, editLocalizedTranslation: mocks.edit, saveLocalizedContentUnits: mocks.save, translateLocalizedContent: mocks.translate } }));
import LocalizedContentEditor from "../LocalizedContentEditor.jsx";
afterEach(cleanup);
describe("Task language comparison", () => {
  it("keeps English visible while switching targets and excludes stale stored units", async () => {
    mocks.read.mockResolvedValue({ units: {
      "task.name": { id: "unit", source_language: "en", source_value: "Opening Duties", translations: { "zh-CN": { value: "开店工作", status: "reviewed" }, ms: { value: "Tugas pembukaan", status: "ai_translated" } } },
      stale: { id: "stale", source_language: "en", source_value: "Deleted block" },
    } });
    render(<LocalizedContentEditor domain="task" versionId="draft" sourceLanguage="en" sourceUnits={[{ unit_key: "task.name", label: "Task name", source_value: "Opening Duties" }]} />);
    await waitFor(() => expect(screen.getByDisplayValue("开店工作")).toBeTruthy());
    expect(screen.getByText("Opening Duties")).toBeTruthy();
    expect(screen.queryByText("Deleted block")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.click(screen.getByLabelText("Translate to"));
    fireEvent.click(await screen.findByRole("button", { name: "Bahasa Melayu" }));
    expect(screen.getByDisplayValue("Tugas pembukaan")).toBeTruthy();
    expect(screen.getByText("Opening Duties")).toBeTruthy();
  });
});

describe("SOP language comparison", () => {
  const sourceUnits = [
    { unit_key: "sop.title", label: "SOP title", source_value: "Opening SOP", field_kind: "plain_text" },
    { unit_key: "sections.section-a.title", label: "Section 1 title", source_value: "Prepare the counter", field_kind: "plain_text" },
    { unit_key: "sections.section-a.content", label: "Section 1 content", source_value: "<p>Check the <strong>cash float</strong>.</p>", field_kind: "rich_text" },
    { unit_key: "sections.section-b.title", label: "Section 2 title", source_value: "Open the shop", field_kind: "plain_text" },
  ];

  it("groups source and translation pairs, renders rich text, and changes only the target", async () => {
    mocks.read.mockResolvedValue({ units: {
      "sop.title": { id: "title", source_language: "en", source_value: "Opening SOP", translations: { "zh-CN": { value: "开店", status: "reviewed" }, ms: { value: "Buka kedai", status: "ai_translated" } } },
      "sections.section-a.title": { id: "a-title", source_language: "en", source_value: "Prepare the counter", translations: {} },
      "sections.section-a.content": { id: "a-content", source_language: "en", source_value: "<p>Check the <strong>cash float</strong>.</p>", translations: { "zh-CN": { value: "检查现金", status: "outdated" } } },
      "sections.section-b.title": { id: "b-title", source_language: "en", source_value: "Open the shop", translations: {} },
    } });
    render(<LocalizedContentEditor domain="sop" versionId="draft" sourceLanguage="en" sourceUnits={sourceUnits} />);
    await waitFor(() => expect(screen.getByDisplayValue("开店")).toBeTruthy());
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("Original")).toBeNull();
    expect(screen.getByText("SOP")).toBeTruthy();
    expect(screen.getByText("Section 01 · Prepare the counter")).toBeTruthy();
    expect(screen.getByText("Section 02 · Open the shop")).toBeTruthy();
    expect(screen.getByText("cash float").tagName).toBe("STRONG");
    expect(screen.getAllByText("Missing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Outdated").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Translate to"));
    fireEvent.click(await screen.findByRole("button", { name: "Bahasa Melayu" }));
    expect(screen.getByDisplayValue("Buka kedai")).toBeTruthy();
    expect(screen.getByText("cash float").tagName).toBe("STRONG");
    expect(screen.getByText("Section 01 · Prepare the counter")).toBeTruthy();
  });

  it("translates only missing units in the selected target and preserves existing translations", async () => {
    const units = Object.fromEntries(sourceUnits.map((source, index) => [source.unit_key, {
      id: `unit-${index}`,
      source_language: "en",
      source_value: source.source_value,
      translations: index === 0 ? { "zh-CN": { value: "Manual", status: "reviewed", manually_edited_at: "2026-09-28T00:00:00Z" } } : {},
    }]));
    mocks.read.mockResolvedValue({ units });
    mocks.save.mockResolvedValue({ units });
    mocks.translate.mockResolvedValue({ units });
    render(<LocalizedContentEditor domain="sop" versionId="draft" sourceLanguage="en" sourceUnits={sourceUnits} />);
    await waitFor(() => expect(screen.getByDisplayValue("Manual")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Translate Missing" }));
    await waitFor(() => expect(mocks.translate).toHaveBeenCalledWith("sop", "draft", ["unit-1", "unit-2", "unit-3"], ["zh-CN"]));
    expect(mocks.translate.mock.calls[0][2]).not.toContain("unit-0");
  });
});
