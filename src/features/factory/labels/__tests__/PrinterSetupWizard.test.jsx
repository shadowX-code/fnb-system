import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PrinterSetupWizard, { printerSetupStatus } from "../PrinterSetupWizard.jsx";

afterEach(cleanup);

const device = {
  id: "registered", name: "Staging Mac", enabled: true, last_seen: new Date().toISOString(),
  printer_name: "D520", printers: [{ Name: "D520", WorkOffline: false, Calibration: "Passed" }],
  unresolved_jobs: 1,
};

it("distinguishes a connected and calibrated printer from an unresolved queue", () => {
  expect(printerSetupStatus(device)).toEqual({
    bridge: "Online", connection: "Available", calibration: "Passed", unresolved: 1,
  });
  expect(printerSetupStatus({ ...device, last_seen: "bad" })).toMatchObject({
    bridge: "Offline", connection: "Not reported",
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
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("link", { name: "Open Bridge Setup" }).getAttribute("href")).toBe("feedx-printer-staging://setup");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Registered computer"), { target: { value: device.id } });
  expect(screen.queryByText("Setup complete.", { exact: false })).toBeNull();
  result.rerender(<PrinterSetupWizard {...props} devices={[{ ...device, unresolved_jobs: 0 }]} />);
  expect(screen.getByText("Setup complete. This printer is ready for Job Order labels.")).toBeTruthy();
});
