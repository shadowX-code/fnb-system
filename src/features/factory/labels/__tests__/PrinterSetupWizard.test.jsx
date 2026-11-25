import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PrinterSetupWizard, { bridgeRelease, printerSetupStatus } from "../PrinterSetupWizard.jsx";

afterEach(cleanup);

const device = {
  id: "registered", name: "Staging Mac", enabled: true, last_seen: new Date().toISOString(),
  printer_name: "D520", status: "Ready", printers: [{ Name: "D520", WorkOffline: false, Calibration: "Passed", Platform: "macOS", BridgeVersion: "1.2.3" }],
  unresolved_jobs: 1,
};

it("distinguishes a connected and calibrated printer from an unresolved queue", () => {
  expect(printerSetupStatus(device)).toEqual({
    bridge: "Online", connection: "Available", readiness: "Held for review", calibration: "Passed", unresolved: 1,
  });
  expect(printerSetupStatus({ ...device, last_seen: "bad" })).toMatchObject({
    bridge: "Offline", connection: "Not reported", readiness: "Unavailable",
  });
  expect(printerSetupStatus({
    ...device, printers: [{ Name: "D520", WorkOffline: true, Calibration: "Pending" }],
  })).toMatchObject({ connection: "Unavailable", calibration: "Pending" });
});

it("shows the platform installer version and opens the native bridge", () => {
  render(<PrinterSetupWizard devices={[]} onClose={vi.fn()} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: /Windows/ }));
  const download = screen.getByRole("link", { name: /Download Windows installer · v1.3.0/ });
  expect(download.getAttribute("href")).toContain("Windows.exe");
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(screen.getByRole("link", { name: "Open Bridge" }).getAttribute("href")).toBe("feedx-printer-staging://setup");
  expect(screen.getByText("Open Bridge manually")).toBeTruthy();
});

it("follows reported connection, calibration and holds without manual step advancement", () => {
  const props = { selected: device, onClose: vi.fn(), onRefresh: vi.fn() };
  const offline = { ...device, last_seen: "invalid" };
  const result = render(<PrinterSetupWizard {...props} devices={[offline]} />);
  expect(screen.getByText("Connect Printer").getAttribute("aria-current")).toBe("step");
  const pending = { ...device, printers: [{ ...device.printers[0], Calibration: "Pending" }] };
  result.rerender(<PrinterSetupWizard {...props} devices={[pending]} />);
  expect(screen.getByText("Test Print").getAttribute("aria-current")).toBe("step");
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  result.rerender(<PrinterSetupWizard {...props} devices={[device]} />);
  expect(screen.getByText(/Review pending output/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  result.rerender(<PrinterSetupWizard {...props} devices={[{ ...device, unresolved_jobs: 0 }]} />);
  expect(screen.getByText("Ready for Job Order labels.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  expect(bridgeRelease(device)).toEqual({ platform: "macos", version: "1.2.3", update: true });
});

it("keeps the last reported calibration visible when the device stops discovering its printer", () => {
  expect(printerSetupStatus({ ...device, status: "Offline", printers: [], calibration_status: "Passed" }))
    .toMatchObject({ bridge: "Online", connection: "Unavailable", calibration: "Passed" });
});

it("expires Bluetooth evidence independently of a fresh heartbeat and preserved calibration", () => {
  const status = printerSetupStatus({ ...device, calibration_status: "Passed", printers: [
    { ...device.printers[0], ConnectionCheckedAt: new Date(Date.now() - 100000).toISOString() },
  ] });
  expect(status).toMatchObject({ bridge: "Online", connection: "Not reported", readiness: "Unavailable", calibration: "Passed" });
});
