import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), edit: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { localizedContentAdmin: mocks.read, editLocalizedTranslation: mocks.edit } }));
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
    fireEvent.click(screen.getByLabelText("Translate To"));
    fireEvent.click(await screen.findByRole("button", { name: "Bahasa Melayu" }));
    expect(screen.getByDisplayValue("Tugas pembukaan")).toBeTruthy();
    expect(screen.getByText("Opening Duties")).toBeTruthy();
  });
});
