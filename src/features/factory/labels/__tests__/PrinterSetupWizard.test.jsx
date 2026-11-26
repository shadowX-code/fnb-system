import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PrinterSetupWizard, { bridgeRelease, printerSetupStatus } from "../PrinterSetupWizard.jsx";

afterEach(cleanup);

const device = {
  id: "registered", name: "Registered Mac", enabled: true, last_seen: new Date().toISOString(),
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

it("shows platform, architecture and version only during install, and keeps refresh in Troubleshooting", async () => {
  const onRefresh = vi.fn();
  const props = { onClose: vi.fn(), onRefresh };
  const result = render(<PrinterSetupWizard devices={[]} {...props} />);
  fireEvent.click(screen.getByRole("tab", { name: /Windows/ }));
  const download = screen.getByRole("link", { name: "Download Installer" });
  expect(download.getAttribute("href")).toContain("Windows.exe");
  expect(within(screen.getByRole("region", { name: "Installer" })).getByText(/x86 installer · v1.3.0/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: /macOS/ }));
  expect(download.getAttribute("href")).toContain("macOS-arm64.pkg");
  expect(screen.getByText(/Apple silicon \(arm64\) · v1.3.0/)).toBeTruthy();
  const nativeLaunch = screen.getByRole("link", { name: "Already installed? Open Bridge" });
  expect(nativeLaunch.getAttribute("href")).toBe("feedx-printer-production://setup");
  nativeLaunch.addEventListener("click", (event) => event.preventDefault(), { once: true });
  fireEvent.click(nativeLaunch);
  expect(screen.getByText("Authorize").closest("li").getAttribute("aria-current")).toBe("step");
  expect(screen.queryByRole("tab", { name: /macOS/ })).toBeNull();
  expect(screen.queryByRole("link", { name: "Download Installer" })).toBeNull();
  const troubleshooting = screen.getByText("Troubleshooting");
  expect(troubleshooting.parentElement.open).toBe(false);
  fireEvent.click(troubleshooting);
  await act(async () => fireEvent.click(within(troubleshooting.parentElement).getByRole("button", { name: "Refresh Status" })));
  expect(onRefresh).toHaveBeenCalledTimes(1);
  result.rerender(<PrinterSetupWizard devices={[device]} {...props} />);
  expect(screen.getByText("Registered Mac")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Review Print History" })).toBeTruthy();
});

it("shows the registered workstation in the header and lets operators switch without restarting setup", () => {
  const alternate = { ...device, id: "windows", name: "Registered PC", last_seen: "invalid", unresolved_jobs: 0 };
  render(<PrinterSetupWizard devices={[device, alternate]} selected={device} onClose={vi.fn()} onRefresh={vi.fn()} />);
  expect(screen.getByText("Registered Mac")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Download Installer" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Change workstation" }));
  fireEvent.click(screen.getByRole("button", { name: "Registered workstation" }));
  fireEvent.click(screen.getByRole("option", { name: /Registered PC/ }));
  expect(screen.getByText("Registered PC")).toBeTruthy();
  expect(screen.getByText("Connect Printer").closest("li").getAttribute("aria-current")).toBe("step");
  expect(screen.getByRole("link", { name: "Reconnect in Bridge" })).toBeTruthy();
});

it("follows reported connection, calibration and holds without manual step advancement", () => {
  const props = { selected: device, onClose: vi.fn(), onRefresh: vi.fn() };
  const offline = { ...device, last_seen: "invalid" };
  const result = render(<PrinterSetupWizard {...props} devices={[offline]} />);
  expect(screen.getByText("Connect Printer").closest("li").getAttribute("aria-current")).toBe("step");
  const pending = { ...device, printers: [{ ...device.printers[0], Calibration: "Pending" }] };
  result.rerender(<PrinterSetupWizard {...props} devices={[pending]} />);
  expect(screen.getByText("Test Print").closest("li").getAttribute("aria-current")).toBe("step");
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
