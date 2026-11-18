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
      .getByText("Print bridge")
      .closest("label")
      .querySelector("button"),
  );
  fireEvent.click(await screen.findByText("Windows QA · D520"));
  fireEvent.click(screen.getByRole("checkbox"));
}
describe("Factory label workflow", () => {
  const uncertain = {
    ...context,
    history: [{
      id: "unknown-job", state: "Unknown", quantity: 3,
      detail: "D520 write completed, but no print acknowledgment was observed.",
      events: [{ id: 1, state: "Unknown", created_at: "2026-11-17T13:00:00Z", detail: "ACK missing" }],
    }],
  };
  it("confirms the full physical count inline without typing or sending another job", async () => {
    factoryLabelService.context.mockResolvedValue(uncertain);
    factoryLabelService.resolve.mockResolvedValue({ state: "Confirmed" });
    render(<LabelPrintModal {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm Printed" }));
    expect(screen.queryByRole("button", { name: "Reprint" })).toBeNull();
    expect(factoryLabelService.resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm 3 usable labels" }));
    await screen.findByText(/The bridge can continue queued work/);
    expect(factoryLabelService.resolve).toHaveBeenCalledExactlyOnceWith(
      "unknown-job", "Confirmed", expect.stringMatching(/inspected the full count/), 3,
    );
    expect(factoryLabelService.enqueue).not.toHaveBeenCalled();
  });

  it("records a partial issue only after counting usable labels and clearing held output", async () => {
    factoryLabelService.context.mockResolvedValue(uncertain);
    factoryLabelService.resolve.mockImplementation(async () => {
      const original = uncertain.history[0];
      factoryLabelService.context.mockResolvedValue({
        ...uncertain,
        history: [{
          ...original, state: "Failed",
          events: [...original.events, { id: 2, state: "Failed", usable_quantity: 1, detail: "Two missing" }],
        }],
      });
      return { state: "Failed" };
    });
    render(<LabelPrintModal {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Report Issue" }));
    const record = screen.getByRole("button", { name: "Record Outcome" });
    fireEvent.change(screen.getByRole("textbox", { name: "Inspection / recovery reason" }), {
      target: { value: "Two missing" },
    });
    const count = screen.getByRole("spinbutton", { name: "Usable labels" });
    fireEvent.change(count, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /cleared any held output/ }));
    expect(record.disabled).toBe(true);
    fireEvent.change(count, { target: { value: "1" } });
    fireEvent.click(record);
    await screen.findByText("Usable labels 1 of 3.");
    expect(screen.getByText("Submission uncertain.")).toBeTruthy();
    expect(factoryLabelService.resolve).toHaveBeenCalledExactlyOnceWith(
      "unknown-job", "Failed", "Two missing", 1,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reprint" }));
    expect(screen.getByRole("spinbutton", { name: "Label quantity" }).value).toBe("2");
    expect(factoryLabelService.enqueue).not.toHaveBeenCalled();
  });

  it("identifies the Job Order holding the selected bridge", async () => {
    factoryLabelService.context.mockResolvedValue({
      ...context,
      devices: [{ ...context.devices[0], hold: { job_order_no: "JO0", batch_no: "B0" } }],
    });
    render(<LabelPrintModal {...props} />);
    await confirmPrint();
    expect(screen.getByText(/Review the print in Job Order JO0 · batch B0/)).toBeTruthy();
  });

  it("keeps uncertain print history visible to users without recovery permission", async () => {
    factoryLabelService.context.mockResolvedValue(uncertain);
    render(<LabelPrintModal {...props} can={(key) => key !== "factory_production.verify"} />);
    await screen.findByText(/Check the physical output before printing again/);
    expect(screen.queryByRole("button", { name: "Confirm Printed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Report Issue" })).toBeNull();
  });

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

it("previews an alternate active configuration in progress without exposing queue controls", async () => {
  const labels = [{ label_key: "product", name: "Product Label" }, { label_key: "carton", name: "Carton Label" }];
  factoryLabelService.context.mockImplementation(async (_job, batch, selection) => ({
    ...context,
    labels,
    preview_only: true,
    batches: [],
    candidate: {
      ...candidate,
      product_name: selection?.label_key === "carton" ? "Carton layout" : "Product layout",
      production_id: null,
      batch_no: null,
      packaged_units: null,
      manufacturing_date: null,
      expiry_date: null,
      missing: ["batch_no", "manufacturing_date", "expiry_date", "packaged_units"],
    },
  }));
  render(<LabelPrintModal {...props} job={{ ...props.job, status: "in_progress" }} />);
  expect(await screen.findByAltText(/Product layout/)).toBeTruthy();
  expect(screen.getByText(/Printing is locked until Production is completed/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Label configuration" }));
  fireEvent.click(await screen.findByRole("option", { name: "Carton Label" }));
  expect(await screen.findByAltText(/Carton layout/)).toBeTruthy();
  expect(factoryLabelService.context).toHaveBeenCalledWith("job", null, { label_key: "carton" }, 1);
  expect(screen.queryByRole("button", { name: "Print Labels", exact: true })).toBeNull();
  expect(screen.queryByLabelText("Label quantity")).toBeNull();
  expect(factoryLabelService.enqueue).not.toHaveBeenCalled();
});
