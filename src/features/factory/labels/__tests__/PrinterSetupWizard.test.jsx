import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PrinterSetupWizard, { printerSetupStatus } from "../PrinterSetupWizard.jsx";

afterEach(cleanup);

const device = {
  id: "registered", name: "Staging Mac", enabled: true, last_seen: new Date().toISOString(),
  printer_name: "D520", status: "Ready", printers: [{ Name: "D520", WorkOffline: false, Calibration: "Passed" }],
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

it("offers native installers and verifies readiness only after the selected device reports it", () => {
  const props = { devices: [device], onClose: vi.fn(), onRefresh: vi.fn() };
  const result = render(<PrinterSetupWizard {...props} />);
  fireEvent.click(screen.getByRole("tab", { name: /Windows/ }));
  expect(screen.getByRole("link", { name: /Download Bridge/ }).getAttribute("href")).toContain("Windows.exe");
  expect(screen.getByText(/For D520 Bluetooth, pair the printer/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("link", { name: "Open Bridge Setup" }).getAttribute("href")).toBe("feedx-printer-staging://setup");
  expect(screen.getByText(/select the paired printer/)).toBeTruthy();
  expect(screen.queryByText(/pair the D520 in macOS/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Registered computer"), { target: { value: device.id } });
  expect(screen.queryByText("Setup complete.", { exact: false })).toBeNull();
  result.rerender(<PrinterSetupWizard {...props} devices={[{ ...device, status: "Error", unresolved_jobs: 0 }]} />);
  expect(screen.queryByText("Setup complete.", { exact: false })).toBeNull();
  result.rerender(<PrinterSetupWizard {...props} devices={[{ ...device, unresolved_jobs: 0 }]} />);
  expect(screen.getByText("Setup complete. This printer is ready for Job Order labels.")).toBeTruthy();
});

it("lets returning computers skip installation and explains the exact unresolved hold", () => {
  const props = { devices: [device], selected: device, initialStep: 1, onClose: vi.fn(), onRefresh: vi.fn() };
  render(<PrinterSetupWizard {...props} />);
  expect(screen.getByText(/resume this computer’s bridge using its saved printer and calibration/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("alert").textContent).toContain("Confirm Printed or Report Issue");
  expect(screen.getByRole("button", { name: "Close", exact: true })).toBeTruthy();
  expect(screen.queryByText("Setup complete.", { exact: false })).toBeNull();
});

it("offers a direct path for already installed bridges", () => {
  render(<PrinterSetupWizard devices={[]} onClose={vi.fn()} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Bridge already installed" }));
  expect(screen.getByRole("link", { name: "Open Bridge Setup" })).toBeTruthy();
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
