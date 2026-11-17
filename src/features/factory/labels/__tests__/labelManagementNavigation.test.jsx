import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FactoryLabelManagementPage from "../../pages/FactoryLabelManagementPage.jsx";

vi.mock("../../hooks/useFactoryPermissions.js", () => ({ default: () => ({ can: () => true }) }));
vi.mock("../../../../services/factoryLabelService.js", () => ({
  factoryLabelsEnabled: true,
  factoryLabelService: { management: vi.fn().mockResolvedValue({ rows: [], total: 0 }) },
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
