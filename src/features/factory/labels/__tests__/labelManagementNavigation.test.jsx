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
  default: ({ kind, entityKey, labelKey }) => <p data-label-key={labelKey} data-entity-key={entityKey}>{kind} editor opened</p>,
}));
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  vi.useRealTimers();
  factoryLabelService.management.mockReset().mockResolvedValue({ rows: [], total: 0 });
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

it("keeps multiple label configurations under one SKU and opens the selected editor", async () => {
  window.history.replaceState({}, "", "/factory/settings/labels?section=products");
  factoryLabelService.management.mockResolvedValueOnce({ total: 1, rows: [{
    id: "sku-1", product_code: "S01", product_name: "Sambal", labels: [
      { label_key: "product", name: "Product Label", status: "Ready", active_version: 2, template_name: "Default", template_version: 1 },
      { label_key: "carton-1", name: "Carton Label", status: "Draft", draft_revision: 1 },
    ],
  }] });
  render(<FactoryLabelManagementPage />);
  const rows = await screen.findAllByRole("row", { name: /S01.*Product Label.*Carton Label/ });
  expect(rows).toHaveLength(1);
  fireEvent.click(within(rows[0]).getByRole("button", { name: "Edit Carton Label for S01" }));
  const editor = screen.getByText("product editor opened");
  expect(editor.dataset.entityKey).toBe("sku-1:carton-1");
  expect(editor.dataset.labelKey).toBe("carton-1");
});

function printerRows({ seen = Date.now(), checked = seen, name = "Receiving Bridge" } = {}) {
  return { total: 40, rows: [{
    id: "bridge-1", name, enabled: true, last_seen: new Date(seen).toISOString(), printer_name: "D520",
    status: "Ready", calibration_status: "Passed", unresolved_jobs: 0,
    printers: [{ Name: "D520", ConnectionCheckedAt: new Date(checked).toISOString() }],
  }] };
}

it("keeps pagination, scroll and an open dialog stable while a printer refresh stalls, fails and recovers", async () => {
  vi.useFakeTimers();
  const since = Date.now();
  const management = factoryLabelService.management.mockImplementation(async () => printerRows({ checked: since - 75000 }));
  window.history.replaceState({}, "", "/factory/settings/labels?section=printers");
  render(<FactoryLabelManagementPage />);
  await act(async () => {});
  const search = screen.getByRole("searchbox");
  await act(async () => fireEvent.change(search, { target: { value: "D520" } }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "2" })));
  const pageTwo = screen.getByRole("button", { name: "2" });
  expect(pageTwo.getAttribute("aria-current")).toBe("page");
  const row = screen.getByRole("row", { name: /Receiving Bridge/ });
  const scroll = row.closest(".admin-data-table-scroll");
  scroll.scrollLeft = 130;
  fireEvent.click(within(row).getByRole("button", { name: "Manage" }));
  const dialog = screen.getByRole("dialog", { name: "Printer Configuration" });
  const name = within(dialog).getByRole("textbox", { name: "Device name" });
  fireEvent.change(name, { target: { value: "Unsaved device name" } });

  let fail;
  management.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  management.mockClear();
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(management).toHaveBeenCalledTimes(1);
  expect(management).toHaveBeenCalledWith("printers", 2, "D520", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(pageTwo.disabled).toBe(false);
  expect(within(row).getByText("Not reported")).toBeTruthy();

  await act(async () => fail(new Error("Temporary network failure")));
  expect(screen.getByText(/Showing last reported data/)).toBeTruthy();
  expect(within(row).getByText("Passed")).toBeTruthy();
  management.mockResolvedValueOnce(printerRows({ seen: since + 30000, checked: since - 61000 }));
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(within(row).getByText("Online")).toBeTruthy();
  expect(within(row).getByText("Not reported")).toBeTruthy();
  expect(within(row).getByText("Passed")).toBeTruthy();
  expect(screen.queryByText(/Showing last reported data/)).toBeNull();

  management.mockImplementationOnce(async () => printerRows());
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(within(row).getByText("Available")).toBeTruthy();
  expect(screen.getByRole("row", { name: /Receiving Bridge/ })).toBe(row);
  expect(screen.getByRole("dialog", { name: "Printer Configuration" })).toBe(dialog);
  expect(screen.getByRole("button", { name: "2" })).toBe(pageTwo);
  expect(name.value).toBe("Unsaved device name");
  expect(search.value).toBe("D520");
  expect(scroll.scrollLeft).toBe(130);
});

it("cancels obsolete list reads and ignores results that arrive after changing search", async () => {
  let finishOld;
  const management = factoryLabelService.management
    .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValueOnce(printerRows({ name: "Matching Bridge" }));
  window.history.replaceState({}, "", "/factory/settings/labels?section=printers");
  render(<FactoryLabelManagementPage />);
  const { signal } = management.mock.lastCall[3];
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Matching" } });
  expect(await screen.findByText("Matching Bridge")).toBeTruthy();
  expect(signal.aborted).toBe(true);
  await act(async () => finishOld(printerRows()));
  expect(screen.queryByText("Receiving Bridge")).toBeNull();
  expect(screen.getByText("Matching Bridge")).toBeTruthy();
});
