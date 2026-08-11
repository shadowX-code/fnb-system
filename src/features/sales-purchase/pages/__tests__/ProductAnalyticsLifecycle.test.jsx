import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  service: { listReports: vi.fn(), listItemsByReportIds: vi.fn(), findReport: vi.fn(), replaceReport: vi.fn(), deleteReport: vi.fn() },
}));

vi.mock("../../../../services/productAnalyticsService.js", () => ({ productAnalyticsService: mocks.service }));

import ProductAnalyticsPage from "../ProductAnalyticsPage.jsx";

const report = {
  id: "report-1", outlet_id: "outlet-1", report_month: 7, report_year: 2026, file_name: "july.csv", uploaded_by: "user-1",
  uploaded_at: "2026-08-10T00:00:00.000Z", status: "completed", total_net_sales: 155, total_quantity: 12, total_discount: 5, raw_metadata: { row_count: 2 },
};

function auth(permissions = []) {
  return { profile: { id: "employee-1", full_name: "Operator", role_outlet_access_type: "all" }, user: { id: "user-1" }, hasPermission: (code) => permissions.includes(code) };
}

function mount(permissions, reports = []) {
  const ui = { notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) };
  render(<ProductAnalyticsPage store={{ outlets: [{ id: "outlet-1", name: "KL Central", status: "active" }] }} ui={ui} auth={auth(permissions)} />);
  return ui;
}

beforeEach(() => {
  Object.values(mocks.service).forEach((mock) => mock.mockReset());
  mocks.service.listReports.mockResolvedValue([]);
  mocks.service.listItemsByReportIds.mockResolvedValue([]);
  mocks.service.findReport.mockResolvedValue(null);
  mocks.service.replaceReport.mockResolvedValue(report);
  mocks.service.deleteReport.mockResolvedValue(true);
});

afterEach(cleanup);

describe("Product Analytics mounted lifecycle guards", () => {
  it("keeps view-only analytics read-only and exposes no upload, replace, or delete mutation control", async () => {
    mount(["product_analytics.view"]);
    await screen.findByText("No product sales report uploaded yet.");

    expect(screen.queryByRole("button", { name: "Upload Report" })).toBeNull();
    expect(screen.getByText("Read-only access")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Upload History" }));
    await screen.findByRole("heading", { name: "Upload History" });
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(mocks.service.replaceReport).not.toHaveBeenCalled();
    expect(mocks.service.deleteReport).not.toHaveBeenCalled();
  });

  it("uses parent page confirmation, delete service, local report removal, and notification for an authorized explicit delete", async () => {
    mocks.service.listReports.mockResolvedValue([report]);
    const ui = mount(["product_analytics.view", "product_analytics.upload", "product_analytics.manage"]);
    await waitFor(() => expect(mocks.service.listReports).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Upload History" }));
    await screen.findByText("july.csv");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.service.deleteReport).toHaveBeenCalledWith(report));
    expect(ui.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Delete product report?", confirmLabel: "Delete", danger: true }));
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Product report deleted" }));
    expect(mocks.service.listReports).toHaveBeenCalledTimes(1);
  });

  it("refreshes the page-owned report list and notifies only after an authorized upload succeeds", async () => {
    mocks.service.listReports.mockResolvedValueOnce([]).mockResolvedValueOnce([report]);
    const ui = mount(["product_analytics.view", "product_analytics.upload"]);
    await screen.findByText("No product sales report uploaded yet.");
    fireEvent.click(screen.getByRole("button", { name: "Upload Report" }));
    const modal = screen.getByRole("heading", { name: "Upload Product Sales Report" }).closest(".fixed");
    const outletSelect = within(modal).getByRole("button", { name: "Select" });
    fireEvent.click(outletSelect);
    fireEvent.click(screen.getByRole("button", { name: "KL Central" }));

    const file = new File(["Product Name,Quantity,Nett Sales\nNasi Lemak,10,115"], "july.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "Product Name,Quantity,Nett Sales\nNasi Lemak,10,115" });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await screen.findByText("1 product rows ready to import.");
    fireEvent.click(within(modal).getByRole("button", { name: "Upload Report" }));

    await waitFor(() => expect(mocks.service.replaceReport).toHaveBeenCalledTimes(1));
    expect(mocks.service.findReport).toHaveBeenCalledTimes(1);
    expect(mocks.service.replaceReport).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-1", fileName: "july.csv", existingReportId: null, requestId: expect.any(String), items: [expect.objectContaining({ product_name: "Nasi Lemak", quantity: 10, nett_sales: 115 })] }));
    await waitFor(() => expect(mocks.service.listReports).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("heading", { name: "Upload Product Sales Report" })).toBeNull();
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Product report uploaded" }));
  });

  it("confirms and submits a replacement through the same trusted save bridge", async () => {
    mocks.service.listReports.mockResolvedValueOnce([report]).mockResolvedValueOnce([{ ...report, id: "report-2", file_name: "replacement.csv" }]);
    mocks.service.findReport.mockResolvedValue(report);
    mocks.service.replaceReport.mockResolvedValue({ ...report, id: "report-2", file_name: "replacement.csv" });
    const ui = mount(["product_analytics.view", "product_analytics.upload", "product_analytics.manage"]);
    await waitFor(() => expect(mocks.service.listReports).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Upload Report" }));
    const modal = screen.getByRole("heading", { name: "Upload Product Sales Report" }).closest(".fixed");
    fireEvent.click(within(modal).getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "KL Central" }));
    const file = new File(["Product Name,Quantity,Nett Sales\nNasi Lemak,10,115"], "replacement.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "Product Name,Quantity,Nett Sales\nNasi Lemak,10,115" });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await screen.findByText("1 product rows ready to import.");
    fireEvent.click(within(modal).getByRole("button", { name: "Upload Report" }));

    await waitFor(() => expect(mocks.service.replaceReport).toHaveBeenCalledWith(expect.objectContaining({ existingReportId: "report-1", requestId: expect.any(String) })));
    expect(ui.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Replace existing report?", confirmLabel: "Replace Report", danger: true }));
    expect(screen.queryByRole("heading", { name: "Upload Product Sales Report" })).toBeNull();
  });

  it("keeps an authorized replace modal open, reports failure, and permits retry without a false list refresh", async () => {
    mocks.service.listReports.mockResolvedValue([report]);
    mocks.service.findReport.mockResolvedValue(report);
    mocks.service.replaceReport.mockRejectedValueOnce(new Error("replacement header failed")).mockResolvedValueOnce(report);
    const ui = mount(["product_analytics.view", "product_analytics.upload", "product_analytics.manage"]);
    await waitFor(() => expect(mocks.service.listReports).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Upload Report" }));
    const modal = screen.getByRole("heading", { name: "Upload Product Sales Report" }).closest(".fixed");
    fireEvent.click(within(modal).getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "KL Central" }));
    const file = new File(["Product Name,Quantity,Nett Sales\nNasi Lemak,10,115"], "july.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "Product Name,Quantity,Nett Sales\nNasi Lemak,10,115" });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await screen.findByText("1 product rows ready to import.");
    fireEvent.click(within(modal).getByRole("button", { name: "Upload Report" }));

    await waitFor(() => expect(mocks.service.replaceReport).toHaveBeenCalledTimes(1));
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Unable to upload report", tone: "error" }));
    expect(screen.getByRole("heading", { name: "Upload Product Sales Report" })).toBeTruthy();
    expect(mocks.service.listReports).toHaveBeenCalledTimes(1);
    const requestId = mocks.service.replaceReport.mock.calls[0][0].requestId;

    fireEvent.click(within(modal).getByRole("button", { name: "Upload Report" }));
    await waitFor(() => expect(mocks.service.replaceReport).toHaveBeenCalledTimes(2));
    expect(mocks.service.replaceReport.mock.calls[1][0].requestId).toBe(requestId);
  });

  it("disables the upload confirmation while the trusted save is pending", async () => {
    let resolveSave;
    mocks.service.replaceReport.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    mount(["product_analytics.view", "product_analytics.upload"]);
    await screen.findByText("No product sales report uploaded yet.");
    fireEvent.click(screen.getByRole("button", { name: "Upload Report" }));
    const modal = screen.getByRole("heading", { name: "Upload Product Sales Report" }).closest(".fixed");
    fireEvent.click(within(modal).getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "KL Central" }));
    const file = new File(["Product Name,Quantity,Nett Sales\nNasi Lemak,10,115"], "july.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "Product Name,Quantity,Nett Sales\nNasi Lemak,10,115" });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await screen.findByText("1 product rows ready to import.");
    const submit = within(modal).getByRole("button", { name: "Upload Report" });
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.service.replaceReport).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Uploading..." }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Uploading..." }));
    expect(mocks.service.replaceReport).toHaveBeenCalledTimes(1);
    resolveSave(report);
  });

  it("keeps successful persistence truthful when the follow-up report refresh fails", async () => {
    mocks.service.listReports.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("list refresh failed"));
    const ui = mount(["product_analytics.view", "product_analytics.upload"]);
    await screen.findByText("No product sales report uploaded yet.");
    fireEvent.click(screen.getByRole("button", { name: "Upload Report" }));
    const modal = screen.getByRole("heading", { name: "Upload Product Sales Report" }).closest(".fixed");
    fireEvent.click(within(modal).getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "KL Central" }));
    const file = new File(["Product Name,Quantity,Nett Sales\nNasi Lemak,10,115"], "july.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "Product Name,Quantity,Nett Sales\nNasi Lemak,10,115" });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await screen.findByText("1 product rows ready to import.");
    fireEvent.click(within(modal).getByRole("button", { name: "Upload Report" }));

    await waitFor(() => expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Product report saved; refresh needed", tone: "warning" })));
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Product report uploaded" }));
    expect(ui.notify).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Unable to upload report" }));
    expect(screen.queryByRole("heading", { name: "Upload Product Sales Report" })).toBeNull();
  });
});
