import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import LabelPrintModal from "../LabelPrintModal.jsx";
import { renderLabel } from "../labelRenderer.js";
import { factoryLabelService } from "../../../../services/factoryLabelService.js";
vi.mock("../../../../services/factoryLabelService.js", () => ({
  factoryLabelService: { context: vi.fn(), enqueue: vi.fn(), resolve: vi.fn(), printStatus: vi.fn() },
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
  factoryLabelService.printStatus.mockImplementation(async (_order, print) => ({
    submitted: print ? { id: print, state: "Queued", quantity: 10, printer_name: "D520" } : null,
    blocking: null,
  }));
});
afterEach(cleanup);
async function selectPrinter() {
  await screen.findByAltText(/Label preview/);
  fireEvent.click(
    screen
      .getByText("Printer")
      .closest("label")
      .querySelector("button"),
  );
  fireEvent.click(await screen.findByText("Windows QA · D520"));
  await waitFor(() => expect(factoryLabelService.printStatus).toHaveBeenCalledWith("job", null, "device"));
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
  async function expandHistory() {
    const item = await screen.findByText(/requested$/);
    fireEvent.click(item.closest("summary"));
  }

  it("confirms the full physical count inline without typing or sending another job", async () => {
    factoryLabelService.context.mockResolvedValue(uncertain);
    factoryLabelService.resolve.mockResolvedValue({ state: "Confirmed" });
    render(<LabelPrintModal {...props} />);
    await expandHistory();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm Printed" }));
    expect(screen.queryByRole("button", { name: "Reprint" })).toBeNull();
    expect(factoryLabelService.resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm 3 usable labels" }));
    await screen.findByText("Confirmed · 3 of 3 usable.");
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
    await expandHistory();
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
    const partialSummary = (await screen.findByText("1 of 3 usable")).closest("summary");
    expect(partialSummary.closest("details").open).toBe(false);
    fireEvent.click(partialSummary);
    expect(screen.getByText("Usable labels 1 of 3.")).toBeTruthy();
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
      ...uncertain,
      devices: [{ ...context.devices[0], hold: { job_order_no: "JO0", batch_no: "B0" } }],
    });
    render(<LabelPrintModal {...props} />);
    factoryLabelService.printStatus.mockResolvedValue({
      submitted: null,
      blocking: { ...uncertain.history[0], job_order_no: "JO0", batch_no: "B0", printer_name: "D520" },
    });
    expect(await screen.findByText(/Job Order JO0 · Batch No. B0 · Print unknown-/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review Previous Print" })).toBeTruthy();
    await expandHistory();
    expect(screen.getAllByRole("button", { name: "Confirm Printed" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Report Issue" })).toHaveLength(1);
    expect(screen.getByRole("list", { name: "Audit events" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Queue Labels" })).toBeNull();
  });

  it("keeps uncertain print history visible to users without recovery permission", async () => {
    factoryLabelService.context.mockResolvedValue(uncertain);
    render(<LabelPrintModal {...props} can={(key) => key !== "factory_production.verify"} />);
    await expandHistory();
    await screen.findByText("Submission uncertain.");
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
    await selectPrinter();
    const print = screen.getByRole("button", {
      name: "Queue Labels",
      exact: true,
    });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(print.disabled).toBe(false);
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
    await screen.findByText(/Waiting for the print bridge to claim this job/);
  });
  it("follows the exact queued job to Unknown even when history is empty", async () => {
    let state = "Queued";
    factoryLabelService.printStatus.mockImplementation(async (_order, print) => ({
      submitted: print ? {
        ...uncertain.history[0], id: print, state, printer_name: "D520",
        events: state === "Unknown" ? uncertain.history[0].events : [],
      } : null,
      blocking: null,
    }));
    render(<LabelPrintModal {...props} />);
    await selectPrinter();
    fireEvent.click(screen.getByRole("button", { name: "Queue Labels" }));
    await screen.findByText(/Waiting for the print bridge to claim this job/);
    state = "Unknown";
    await screen.findByRole("heading", { name: "Needs Review" }, { timeout: 4000 });
    await screen.findByText("Submission uncertain.");
    expect(screen.getByRole("button", { name: "Confirm Printed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Report Issue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Queue Labels" })).toBeNull();
    expect(factoryLabelService.printStatus).toHaveBeenCalledWith("job", "print-id", "device");
    expect(factoryLabelService.enqueue).toHaveBeenCalledTimes(1);
  });
  it("shows a concise confirmed count and keeps previous transport evidence in History", async () => {
    const original = {
      ...uncertain.history[0], id: "print-id", device_id: "device", printer_name: "D520",
    };
    const confirmed = {
      ...original, state: "Confirmed", detail: "Physical inspection recorded",
      events: [...original.events, {
        id: 2, state: "Confirmed", usable_quantity: 3, created_at: "2026-11-17T13:00:10Z",
      }],
    };
    let status = original;
    factoryLabelService.context.mockResolvedValue({ ...context });
    factoryLabelService.printStatus.mockImplementation(async (_order, print) => ({
      submitted: print ? status : null, blocking: null,
    }));
    factoryLabelService.resolve.mockImplementation(async () => {
      status = confirmed;
      factoryLabelService.context.mockResolvedValue({ ...context, history: [confirmed] });
      return { state: "Confirmed" };
    });
    render(<LabelPrintModal {...props} />);
    await selectPrinter();
    fireEvent.click(screen.getByRole("button", { name: "Queue Labels" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm Printed" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm 3 usable labels" }));
    const result = (await screen.findByRole("heading", { name: "Print Result" })).closest("section");
    expect(result.textContent).toContain("Confirmed");
    expect(result.textContent).toContain("3 of 3 usable");
    expect(result.textContent).not.toMatch(/uncertain|ACK missing/);
    const history = screen.getByRole("heading", { name: "Print History" }).closest("section");
    const summary = [...history.querySelectorAll("summary")].find((item) => item.textContent.includes("3 of 3 usable"));
    expect(summary.closest("details").open).toBe(false);
    fireEvent.click(summary);
    expect(screen.getByRole("list", { name: "Audit events" }).textContent).toContain("ACK missing");
    expect(factoryLabelService.enqueue).toHaveBeenCalledTimes(1);
  });

  it("uses Bluetooth recovery guidance for the job's printer", async () => {
    const bluetooth = { ...context.devices[0], printer_name: "D520 (Bluetooth)", transport: "tspl",
      printers: [{ Name: "D520 (Bluetooth)", Connection: "Bluetooth Classic SPP" }] };
    factoryLabelService.context.mockResolvedValue({
      ...uncertain, devices: [bluetooth],
      history: [{ ...uncertain.history[0], device_id: bluetooth.id }],
    });
    render(<LabelPrintModal {...props} />);
    await expandHistory();
    fireEvent.click(await screen.findByRole("button", { name: "Report Issue" }));
    expect(screen.getByText(/pending Bluetooth output/)).toBeTruthy();
    expect(screen.queryByText(/Windows print queue/)).toBeNull();
  });

  it("retries an uncertain request with the same identity after closing and reopening", async () => {
    factoryLabelService.enqueue.mockRejectedValueOnce(
      new TypeError("Connection interrupted"),
    );
    const view = render(<LabelPrintModal {...props} />);
    await selectPrinter();
    fireEvent.click(
      screen.getByRole("button", { name: "Queue Labels", exact: true }),
    );
    await screen.findByRole("button", { name: "Retry Submitted Request" });
    const original = factoryLabelService.enqueue.mock.calls[0][0];
    view.unmount();
    render(<LabelPrintModal {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry Submitted Request" }),
    );
    await screen.findByText(/Waiting for the print bridge to claim this job/);
    expect(factoryLabelService.enqueue.mock.calls[1][0]).toEqual(original);
    expect(sessionStorage.length).toBe(0);
  });
  it("blocks quantities outside the remaining allowance without a separate acknowledgement", async () => {
    factoryLabelService.context.mockResolvedValue({ ...context, allocated: 7 });
    render(<LabelPrintModal {...props} />);
    await selectPrinter();
    expect(screen.getByText("3 remaining")).toBeTruthy();
    const print = screen.getByRole("button", { name: "Queue Labels" });
    const quantity = screen.getByRole("spinbutton", { name: "Label quantity" });
    fireEvent.change(quantity, { target: { value: "4" } });
    expect(print.disabled).toBe(true);
    expect(screen.getByText("Enter no more than 3 labels.")).toBeTruthy();
    fireEvent.change(quantity, { target: { value: "2" } });
    expect(print.disabled).toBe(false);
    expect(factoryLabelService.enqueue).not.toHaveBeenCalled();
  });
  it("blocks queueing until the newly selected label preview has rendered", async () => {
    const labels = [{ label_key: "product", name: "Product Label" }, { label_key: "carton", name: "Carton Label" }];
    factoryLabelService.context.mockImplementation(async (_job, _batch, selection) => ({
      ...context, labels,
      candidate: { ...candidate, product_name: selection?.label_key === "carton" ? "Carton layout" : "Product layout" },
    }));
    render(<LabelPrintModal {...props} />);
    await selectPrinter();
    const print = screen.getByRole("button", { name: "Queue Labels" });
    await waitFor(() => expect(print.disabled).toBe(false));
    let finishPreview;
    renderLabel.mockImplementationOnce(() => new Promise((resolve) => { finishPreview = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Label configuration" }));
    fireEvent.click(await screen.findByRole("option", { name: "Carton Label" }));
    await screen.findByText("Waiting for the label preview.");
    expect(print.disabled).toBe(true);
    fireEvent.click(print);
    expect(factoryLabelService.enqueue).not.toHaveBeenCalled();
    finishPreview({ preview: "data:image/png;base64,test", raster: { width: 639, height: 719 } });
    await screen.findByAltText(/Carton layout/);
    expect(print.disabled).toBe(false);
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
      screen.getByRole("button", { name: "Queue Labels", exact: true })
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
      screen.getByRole("button", { name: "Queue Labels", exact: true })
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
  expect(screen.getByText(/Preview only. Printing is available after Production is complete/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Label configuration" }));
  fireEvent.click(await screen.findByRole("option", { name: "Carton Label" }));
  expect(await screen.findByAltText(/Carton layout/)).toBeTruthy();
  expect(factoryLabelService.context).toHaveBeenCalledWith("job", null, { label_key: "carton" }, 1);
  expect(screen.queryByRole("button", { name: "Queue Labels", exact: true })).toBeNull();
  expect(screen.queryByLabelText("Label quantity")).toBeNull();
  expect(factoryLabelService.enqueue).not.toHaveBeenCalled();
});

it("requires an explicit quantity for a confirmed reprint even after refresh", async () => {
  factoryLabelService.context.mockResolvedValue({
    ...context,
    history: [{ id: "confirmed-job", state: "Confirmed", quantity: 6, events: [] }],
  });
  render(<LabelPrintModal {...props} />);
  fireEvent.click((await screen.findByText("6 requested")).closest("summary"));
  fireEvent.click(await screen.findByRole("button", { name: "Reprint", exact: true }));
  const quantityField = screen.getByRole("spinbutton", { name: "Label quantity" });
  expect(quantityField.value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" }).disabled).toBe(false));
  expect(quantityField.value).toBe("");
  expect(screen.getByRole("button", { name: "Queue Reprint" }).disabled).toBe(true);
  expect(factoryLabelService.enqueue).not.toHaveBeenCalled();
  fireEvent.change(quantityField, { target: { value: "2" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Reprint reason" }), { target: { value: "Operator-approved replacement" } });
  await selectPrinter();
  fireEvent.click(screen.getByRole("button", { name: "Queue Reprint" }));
  await waitFor(() => expect(factoryLabelService.enqueue).toHaveBeenCalledWith(expect.objectContaining({
    p_quantity: 2, p_reprint_of: "confirmed-job", p_reason: "Operator-approved replacement",
  })));
});
