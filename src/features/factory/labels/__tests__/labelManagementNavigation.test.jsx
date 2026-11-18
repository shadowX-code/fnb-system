import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FactoryLabelManagementPage from "../../pages/FactoryLabelManagementPage.jsx";
import { factoryLabelService } from "../../../../services/factoryLabelService.js";

vi.mock("../useLabelPreview.js", () => ({
  default: () => ({ image: "data:image/png;base64,test", error: "", loading: false }),
}));
global.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

vi.mock("../../hooks/useFactoryPermissions.js", () => ({ default: () => ({ can: () => true }) }));
vi.mock("../../../../services/factoryLabelService.js", () => ({
  factoryLabelsEnabled: true,
  factoryLabelService: { management: vi.fn().mockResolvedValue({ rows: [], total: 0 }), editor: vi.fn() },
}));
vi.mock("../FactoryLabelEditorPage.jsx", () => ({
  default: ({ kind }) => <p>{kind} editor opened</p>,
}));
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});
function navigate(query) {
  act(() => {
    window.history.pushState({}, "", "/factory/settings/labels?" + query);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}
it("keeps hooks stable across list, product editor, template editor and back", async () => {
  window.history.replaceState({}, "", "/factory/settings/labels?section=products");
  render(<FactoryLabelManagementPage />);
  await screen.findByRole("heading", { name: "Label Management" });
  navigate("section=products&sku=existing-S9");
  expect(screen.getByText("product editor opened")).toBeTruthy();
  navigate("section=templates&template=s08-sambal");
  expect(screen.getByText("template editor opened")).toBeTruthy();
  navigate("section=printers");
  await screen.findByRole("button", { name: "Set Up Printer" });
});
it("uses one printer refresh timer and stops it while editing", async () => {
  const interval = vi.spyOn(globalThis, "setInterval");
  const clear = vi.spyOn(globalThis, "clearInterval");
  window.history.replaceState({}, "", "/factory/settings/labels?section=printers");
  render(<FactoryLabelManagementPage />);
  await screen.findByRole("button", { name: "Set Up Printer" });
  expect(interval.mock.calls.filter((args) => args[1] >= 10000)).toHaveLength(1);
  const timer = interval.mock.results.find((_, i) => interval.mock.calls[i][1] === 10000).value;
  navigate("section=products&sku=existing-S9");
  expect(screen.getByText("product editor opened")).toBeTruthy();
  expect(clear).toHaveBeenCalledWith(timer);
});

it("opens the active layout separately from edit and omits preview for draft-only templates", async () => {
  window.history.replaceState({}, "", "/factory/settings/labels?section=templates");
  factoryLabelService.management.mockResolvedValueOnce({ total: 2, rows: [
    { name: "Shared layout", template_key: "shared", version: 2, configuration_status: "Draft", assignments: 1 },
    { name: "Working only", template_key: "draft-only", configuration_status: "Draft", assignments: 0 },
  ] });
  factoryLabelService.editor.mockResolvedValueOnce({
    published: { name: "Shared layout", version: 2, definition: { width_mm: 80, height_mm: 90, elements: [] } },
    draft: { payload: { name: "Ignore working draft", width_mm: 50 } },
  });
  render(<FactoryLabelManagementPage />);
  const row = await screen.findByRole("row", { name: /Shared layout/ });
  expect(within(row).getByText("Active")).toBeTruthy();
  expect(within(row).getByRole("button", { name: "Edit Template" })).toBeTruthy();
  const draftRow = screen.getByRole("row", { name: /Working only/ });
  expect(within(draftRow).queryByRole("button", { name: /View active template/ })).toBeNull();
  fireEvent.click(within(row).getByRole("button", { name: /View active template/ }));
  const dialog = screen.getByRole("dialog", { name: "Active template preview" });
  expect(await within(dialog).findByText("80 × 90 mm · 203 DPI")).toBeTruthy();
  expect(within(dialog).getByText("Shared layout · v2")).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: "Save" })).toBeNull();
  expect(factoryLabelService.editor).toHaveBeenCalledWith("template", "shared");
});
