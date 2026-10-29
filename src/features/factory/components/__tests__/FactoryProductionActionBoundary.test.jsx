import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FactoryProductionActionBoundary from "../FactoryProductionActionBoundary.jsx";
import { factoryService, emptyFactoryData } from "../../../../services/factoryService.js";
const auth = { hasPermission: () => true };
const intent = { type: "production", job: { id: "job" } };
function boundary(value = intent) {
  return <FactoryProductionActionBoundary intent={value} scope="production-overview" auth={auth} permissionSignature="complete" onClose={() => {}}>{() => <button>Trusted completion form</button>}</FactoryProductionActionBoundary>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it("does not expose a mutation form until all required details are ready; retry has a fresh owner", async () => {
  const load = vi.spyOn(factoryService, "listFactoryData").mockRejectedValueOnce(new Error("network")).mockResolvedValue(emptyFactoryData());
  render(boundary());
  expect(screen.queryByText("Trusted completion form")).toBeNull();
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Trusted completion form")).toBeTruthy();
  expect(load.mock.calls.every(([args]) => args.action === "production")).toBe(true);
  expect(load.mock.calls[0][0].signal.aborted).toBe(true);
  expect(load.mock.calls[1][0].signal).not.toBe(load.mock.calls[0][0].signal);
});
it("retains required-data gating for permission or incomplete snapshots", async () => {
  vi.spyOn(factoryService, "listFactoryData").mockResolvedValue({ ...emptyFactoryData(), accessIssues: [{ key: "recipes", label: "Product Recipes", kind: "permission" }] });
  render(boundary());
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("Trusted completion form")).toBeNull();
});
it("cancels obsolete action requests and ignores late completion", async () => {
  let finish;
  const load = vi.spyOn(factoryService, "listFactoryData").mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(emptyFactoryData());
  const view = render(boundary());
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  view.rerender(boundary({ type: "job" }));
  expect(await screen.findByText("Trusted completion form")).toBeTruthy();
  expect(load.mock.calls[0][0].signal.aborted).toBe(true);
  await act(async () => { finish({ ...emptyFactoryData(), accessIssues: [{ label: "Obsolete failure" }] }); });
  expect(screen.queryByRole("alert")).toBeNull();
});
it("identifies the stalled dependency at the deadline without leaking request content", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(factoryService, "listFactoryData").mockImplementation(({ onDependency }) => {
    onDependency({ key: "recipes", label: "Product Recipes", status: "pending", elapsedMs: 0 });
    return new Promise(() => {});
  });
  render(boundary());
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.getByRole("alert").textContent).toContain("Product Recipes (30s)");
  expect(screen.queryByText("Trusted completion form")).toBeNull();
});
