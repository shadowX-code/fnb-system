import { useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import FactorySegmentedControl from "../components/FactorySegmentedControl.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";

export const printerInstallers = {
  macos: "/downloads/FeedX-Print-Bridge-Staging-macOS-arm64.pkg",
  windows: "/downloads/FeedX-Print-Bridge-Staging-Windows.exe",
};

export function printerSetupStatus(row) {
  const latest = Date.parse(row.last_seen);
  const online = row.enabled && Number.isFinite(latest) && Date.now() - latest <= 90000;
  const printer = row.printers?.find((entry) => entry.Name === row.printer_name);
  const available = printer && !printer.WorkOffline && ![6, 7].includes(printer.PrinterStatus);
  return {
    bridge: !row.enabled ? "Disabled" : online ? "Online" : "Offline",
    connection: !online || !printer ? "Not reported" : available ? "Available" : "Unavailable",
    calibration: printer?.Calibration || "Not reported",
    unresolved: row.unresolved_jobs,
  };
}

export default function PrinterSetupWizard({ onClose, onRefresh, devices, selected, initialStep = 0 }) {
  const [platform, setPlatform] = useState(() => navigator.platform.startsWith("Win") ? "windows" : "macos");
  const [step, setStep] = useState(initialStep);
  const [deviceId, setDeviceId] = useState(selected?.id || "");
  const [checking, setChecking] = useState(false);
  const row = devices.find((device) => device.id === deviceId);
  const status = row && printerSetupStatus(row);
  const ready = status?.bridge === "Online" && status.connection === "Available" &&
    status.calibration === "Passed" && status.unresolved === 0;
  async function refresh() {
    setChecking(true);
    try {
      await onRefresh();
    } finally {
      setChecking(false);
    }
  }
  return (
    <Modal
      title={selected ? "Printer Setup and Recovery" : "Printer Setup"}
      description={selected?.name || "Set up the bridge on the computer connected to your printer."}
      size="lg"
      onClose={onClose}
      footer={
        <>
          {step > 0 && <button className="btn-secondary" onClick={() => setStep(step - 1)}>Back</button>}
          <button className="btn-primary" onClick={step === 2 ? onClose : () => setStep(step + 1)}>
            {step === 2 ? "Done" : "Continue"}
          </button>
        </>
      }
    >
      <ol className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-text-secondary" aria-label="Setup steps">
        {["Install", "Connect and calibrate", "Verify"].map((title, i) => (
          <li aria-current={step === i ? "step" : undefined} className={step === i ? "font-semibold text-text-primary" : ""} key={title}>
            {i + 1}. {title}
          </li>
        ))}
      </ol>
      <div className="space-y-4 text-sm">
        {step === 0 && (
          <>
            <FactorySegmentedControl
              label="Bridge operating system"
              value={platform}
              onChange={setPlatform}
              options={[{ value: "macos", label: "macOS (Apple silicon)" }, { value: "windows", label: "Windows 10/11" }]}
            />
            <p>{platform === "macos"
              ? "Install the package on the Mac connected to the printer, then open FeedX Print Bridge Staging from Applications."
              : "Run the installer on the Windows printer computer, then open FeedX Print Bridge Staging from the Start menu."}</p>
            <a className="btn-secondary inline-flex" href={printerInstallers[platform]} download>Download Bridge installer</a>
          </>
        )}
        {step === 1 && (
          <>
            <a className="btn-secondary inline-flex" href="feedx-printer-staging://setup">Open Bridge Setup</a>
            <p>If it does not open, launch FeedX Print Bridge Staging from Applications or the Windows Start menu.</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Choose <strong>Connect / Configure</strong>. Sign in with your authorized FeedX Staging account, then select the local printer and enter its stock dimensions. Use the specified feed direction, and set the gap in the driver for spooler printing.</li>
              <li>Run <strong>Connection Check</strong>. For D520 Bluetooth, power on and pair the D520 in macOS, then close Labelife so it releases the connection.</li>
              <li>When approved to print, open <strong>Test / Review Calibration</strong> and explicitly approve the copy count. Check the output before recording the result. macOS D520 Bluetooth requires the one-label test followed by a separate three-label test.</li>
            </ol>
            <p>To restore a signed-out bridge, choose <strong>Reauthorize</strong> and sign in with its original FeedX operator. Report uncertain Job Order output in that order’s Print History.</p>
          </>
        )}
        {step === 2 && (
          <>
            <label className="block">
              <span className="mb-1 block font-medium">Registered computer</span>
              <select className="w-full rounded-lg border border-border bg-[var(--theme-surface-raised)] p-2" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">Select your computer</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.printer_name}</option>)}
              </select>
            </label>
            <button className="btn-secondary" disabled={checking} onClick={refresh}>{checking ? "Checking…" : "Refresh status"}</button>
            {status && (
              <dl className="grid grid-cols-[1fr_auto] gap-2">
                <dt>Bridge</dt><dd><FactoryStatusBadge status={status.bridge} /></dd>
                <dt>Printer connection</dt><dd><FactoryStatusBadge status={status.connection} /></dd>
                <dt>Calibration</dt><dd><FactoryStatusBadge status={status.calibration} /></dd>
                <dt>Unresolved print jobs</dt><dd>{status.unresolved ?? "Not reported"}</dd>
              </dl>
            )}
            <p role="status">{ready
              ? "Setup complete. This printer is ready for Job Order labels."
              : "Setup is verified when the bridge is online, the printer is available, calibration has passed, and no job awaits review."}</p>
          </>
        )}
      </div>
    </Modal>
  );
}
