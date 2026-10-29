import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import LabelPrintModal from "../LabelPrintModal.jsx";
import { factoryLabelService } from "../../../../services/factoryLabelService.js";
vi.mock("../../../../services/factoryLabelService.js", () => ({
  factoryLabelService: { context: vi.fn(), enqueue: vi.fn(), resolve: vi.fn() },
}));
vi.mock("../labelRenderer.js", () => ({
  renderLabel: vi
    .fn()
    .mockResolvedValue({
      preview: "data:image/png;base64,test",
      raster: { format: "mono1", width: 639, height: 719, data: "AA==" },
    }),
  previewFrozenRaster: vi.fn(),
}));
const candidate = {
  production_id: "batch",
  product_name: "Sambal",
  batch_no: "B1",
  packaged_units: 10,
  manufacturing_date: "2026-10-30",
  expiry_date: "2027-04-28",
  width_mm: 80,
  height_mm: 90,
  config_version: 1,
  template_version: 1,
  definition: { elements: [] },
  missing: [],
  sources: {},
};
const context = {
  candidate,
  batches: [{ id: "batch", batch_no: "B1", packaged_units: 10 }],
  devices: [
    {
      id: "device",
      name: "Windows QA",
      printer_name: "D520",
      last_seen: new Date().toISOString(),
      status: "Ready",
      transport: "spooler",
    },
  ],
  history: [],
  allocated: 0,
  history_total: 0,
};
const props = {
  job: { id: "job", job_order_no: "JO1" },
  actorId: "operator",
  can: () => true,
  onClose: vi.fn(),
};
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  factoryLabelService.context.mockResolvedValue(context);
  factoryLabelService.enqueue.mockResolvedValue("print-id");
});
afterEach(cleanup);
async function confirmPrint() {
  await screen.findByAltText(/Label preview/);
  fireEvent.click(
    screen
      .getByText("Windows print bridge")
      .closest("label")
      .querySelector("button"),
  );
  fireEvent.click(await screen.findByText("Windows QA · D520"));
  fireEvent.click(screen.getByRole("checkbox"));
}
describe("Factory label workflow", () => {
  it("queues the reviewed authoritative snapshot and prevents double submission", async () => {
    let finish;
    factoryLabelService.enqueue.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    render(<LabelPrintModal {...props} />);
    await confirmPrint();
    const print = screen.getByRole("button", {
      name: "Print Labels",
      exact: true,
    });
    fireEvent.click(print);
    fireEvent.click(print);
    await waitFor(() =>
      expect(factoryLabelService.enqueue).toHaveBeenCalledTimes(1),
    );
    expect(factoryLabelService.enqueue.mock.calls[0][0]).toMatchObject({
      p_production: "batch",
      p_device: "device",
      p_quantity: 10,
      p_expected_snapshot: candidate,
      p_reprint_of: null,
    });
    finish("print-id");
    await screen.findByText(/Labels queued/);
  });
  it("retries an uncertain request with the same identity after closing and reopening", async () => {
    factoryLabelService.enqueue.mockRejectedValueOnce(
      new TypeError("Connection interrupted"),
    );
    const view = render(<LabelPrintModal {...props} />);
    await confirmPrint();
    fireEvent.click(
      screen.getByRole("button", { name: "Print Labels", exact: true }),
    );
    await screen.findByRole("button", { name: "Retry Submitted Request" });
    const original = factoryLabelService.enqueue.mock.calls[0][0];
    view.unmount();
    render(<LabelPrintModal {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry Submitted Request" }),
    );
    await screen.findByText(/Labels queued/);
    expect(factoryLabelService.enqueue.mock.calls[1][0]).toEqual(original);
    expect(sessionStorage.length).toBe(0);
  });
  it("blocks printing when authoritative evidence is missing", async () => {
    factoryLabelService.context.mockResolvedValue({
      ...context,
      candidate: {
        ...candidate,
        missing: ["packaged_units"],
        packaged_units: null,
      },
    });
    render(<LabelPrintModal {...props} />);
    await screen.findByText("Confirm missing batch evidence");
    expect(
      screen.getByRole("button", { name: "Print Labels", exact: true })
        .disabled,
    ).toBe(true);
    expect(factoryLabelService.enqueue).not.toHaveBeenCalled();
  });
  it("requires printing permission while allowing evidence review", async () => {
    render(
      <LabelPrintModal
        {...props}
        can={(key) => key !== "factory_production.complete"}
      />,
    );
    await screen.findByAltText(/Label preview/);
    expect(
      screen.getByRole("button", { name: "Print Labels", exact: true })
        .disabled,
    ).toBe(true);
  });
});
