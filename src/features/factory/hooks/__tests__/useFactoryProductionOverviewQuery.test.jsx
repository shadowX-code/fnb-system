import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import useFactoryProductionOverviewQuery from "../useFactoryProductionOverviewQuery.js";
import { factoryService } from "../../../../services/factoryService.js";
const error = vi.fn(), denied = vi.fn();
function Harness({ route = "production-overview", can = () => true }) {
  const query = useFactoryProductionOverviewQuery({ route, can, onError: error, onPermissionDenied: denied });
  return <><span>{query.loading ? "Pending" : query.error || query.jobs[0]?.id || "Ready"}</span><button onClick={query.retry}>Retry query</button></>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it("aborts on route-away and ignores its late response", async () => {
  let finish;
  const request = vi.spyOn(factoryService, "listOperationalJobOrders").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<Harness />);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  view.rerender(<Harness route="job-orders" />);
  expect(request.mock.calls[0][0].signal.aborted).toBe(true);
  await act(async () => { finish({ jobs: [{ id: "obsolete" }] }); });
  expect(screen.queryByText("obsolete")).toBeNull();
});
it("does not duplicate requests on equivalent permission callback changes", async () => {
  const request = vi.spyOn(factoryService, "listOperationalJobOrders").mockResolvedValue({ jobs: [] });
  const view = render(<Harness can={() => true} />);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  view.rerender(<Harness can={() => true} />);
  expect(request).toHaveBeenCalledTimes(1);
});
it("bounds a stalled pipeline and recovers on fresh Retry", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const request = vi.spyOn(factoryService, "listOperationalJobOrders").mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue({ jobs: [{ id: "recovered" }] });
  render(<Harness />);
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(screen.getByText(/Waiting for Operational Job Orders/)).toBeTruthy();
  expect(request.mock.calls[0][0].signal.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Retry query" }));
  await act(async () => {});
  expect(screen.getByText("recovered")).toBeTruthy();
});
