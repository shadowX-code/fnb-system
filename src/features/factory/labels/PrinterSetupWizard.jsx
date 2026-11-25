import { useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import FactorySegmentedControl from "../components/FactorySegmentedControl.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";

export const printerInstallers = {
  macos: "/downloads/FeedX-Print-Bridge-Staging-macOS-arm64.pkg",
  windows: "/downloads/FeedX-Print-Bridge-Staging-Windows.exe",
};

export function livePrinterReport(row, online) {
  if (!online) return null;
  const printer = row.printers?.find((entry) => entry.Name === row.printer_name);
  if (!printer) return null;
  if ("ConnectionCheckedAt" in printer) {
    const age = Date.now() - Date.parse(printer.ConnectionCheckedAt);
    if (!Number.isFinite(age) || age < -10000 || age > 90000) return null;
  }
  return printer;
}

export function printerSetupStatus(row) {
  const latest = Date.parse(row.last_seen);
  const online = row.enabled && Number.isFinite(latest) && Date.now() - latest <= 90000;
  const printer = row.printers?.find((entry) => entry.Name === row.printer_name);
  const report = livePrinterReport(row, online);
  const available = report && !report.WorkOffline && ![6, 7].includes(report.PrinterStatus);
  return {
    bridge: !row.enabled ? "Disabled" : online ? "Online" : "Offline",
    connection: !online ? "Not reported" : available ? "Available" : report || (!printer && row.status === "Offline") ? "Unavailable" : "Not reported",
    readiness: !online || !available ? "Unavailable"
      : row.unresolved_jobs > 0 ? "Held for review"
      : row.status === "Ready" ? "Ready" : "Not ready",
    calibration: row.calibration_status || printer?.Calibration || "Not reported",
    unresolved: row.unresolved_jobs,
  };
}

export const bridgeInstallerVersion = "1.3.0";
export const bridgeLaunchUrl = "feedx-printer-staging://setup";

export function bridgeRelease(row) {
  const printer = row?.printers?.find((entry) => entry.Name === row.printer_name);
  const platform = printer?.Platform === "Windows" || printer?.Connection === "Windows spooler"
    ? "windows" : printer?.Platform === "macOS" ? "macos" : null;
  const version = /^\d+\.\d+\.\d+$/.test(printer?.BridgeVersion) ? printer.BridgeVersion : null;
  const update = version && bridgeInstallerVersion.localeCompare(version, undefined, { numeric: true }) > 0;
  return { platform, version, update };
}

function recommendedPlatform() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  return /win/i.test(platform) ? "windows" : "macos";
}

const steps = ["Install", "Authorize", "Connect Printer", "Test Print", "Ready"];

export default function PrinterSetupWizard({ onClose, onRefresh, devices, selected }) {
  const [recommended] = useState(recommendedPlatform);
  const [platform, setPlatform] = useState(bridgeRelease(selected).platform || recommended);
  const [opening, setOpening] = useState(false);
  const [deviceId, setDeviceId] = useState(selected?.id || "");
  const [checking, setChecking] = useState(false);
  const matching = devices.filter((device) => bridgeRelease(device).platform === platform);
  const row = devices.find((device) => device.id === deviceId) || (matching.length === 1 ? matching[0] : null);
  const status = row && printerSetupStatus(row);
  const step = !row ? opening ? 1 : 0
    : status.connection !== "Available" ? 2 : status.calibration !== "Passed" ? 3 : 4;
  const ready = step === 4 && status.readiness === "Ready" && status.unresolved === 0;
  async function refresh() {
    setChecking(true);
    try { await onRefresh(); } finally { setChecking(false); }
  }
  return (
    <Modal title="Printer Setup" description={row?.name || "Set up the computer connected to your printer."}
      size="md" onClose={onClose}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>{ready ? "Close" : "Set up later"}</button>
        {ready
          ? <button className="btn-primary" onClick={onClose}>Done</button>
          : <a className="btn-primary" href={bridgeLaunchUrl} onClick={() => setOpening(true)}>
            {step < 2 ? "Open Bridge" : step === 2 ? "Open Bridge to connect" : step === 3 ? "Open Bridge to test" : "Open Bridge"}
          </a>}
      </>}>
      <div className="space-y-4 text-sm">
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Setup steps">
          {steps.map((label, i) => <li key={label} aria-current={step === i ? "step" : undefined}
            className={step === i ? "font-semibold text-text-primary" : "text-text-secondary"}>{label}</li>)}
        </ol>
        {!ready && <>
          <FactorySegmentedControl label="Bridge operating system" value={platform}
            onChange={(value) => { setPlatform(value); setDeviceId(""); setOpening(false); }}
            options={[
              { value: "macos", label: recommended === "macos" ? "macOS · Recommended" : "macOS" },
              { value: "windows", label: recommended === "windows" ? "Windows · Recommended" : "Windows" },
            ]} />
          <a className="btn-secondary inline-flex" href={printerInstallers[platform]} download>
            Download {platform === "macos" ? "macOS" : "Windows"} installer · v{bridgeInstallerVersion}
          </a>
        </>}
        {devices.length > 0 && <label className="block">
          <span className="mb-1 block font-medium">Registered computer</span>
          <select className="w-full rounded-lg border border-border bg-surface p-2" value={row?.id || ""}
            onChange={(event) => setDeviceId(event.target.value)}>
            <option value="">Select this computer</option>
            {devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.printer_name}</option>)}
          </select>
        </label>}
        {status && <dl className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-border p-3">
          <dt>Bridge</dt><dd><FactoryStatusBadge status={status.bridge} /></dd>
          <dt>Printer connection</dt><dd><FactoryStatusBadge status={status.connection} /></dd>
          <dt>Calibration</dt><dd><FactoryStatusBadge status={status.calibration} /></dd>
          <dt>Unresolved prints</dt><dd>{status.unresolved ?? "Not reported"}</dd>
        </dl>}
        {status?.unresolved > 0 ? <p role="status">Review pending output in <a className="underline" href="/factory/job-orders">Job Orders</a> before printing.</p>
          : ready ? <p role="status">Ready for Job Order labels.</p>
            : <p role="status">{[
              "Install on the computer connected to the printer.",
              "Authorize the computer in your browser when the Bridge opens.",
              "Choose a printer in the Bridge. A fresh connection result appears here automatically.",
              "Send a test only when approved, then confirm the physical output in the Bridge.",
              "Check the Bridge before printing.",
            ][step]}</p>}
        {!ready && <details>
          <summary className="cursor-pointer font-medium">Open Bridge manually</summary>
          <p className="mt-2 text-text-secondary">Open FeedX Print Bridge Staging from {platform === "macos" ? "Applications" : "the Start menu"}. Use Reconnect or Authorize again if prompted.</p>
        </details>}
        <button className="btn-secondary" disabled={checking} onClick={refresh}>{checking ? "Checking…" : "Refresh status"}</button>
      </div>
    </Modal>
  );
}
