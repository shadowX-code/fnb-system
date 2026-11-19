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

export default function PrinterSetupWizard({ onClose, onRefresh, devices, selected, initialStep = 0 }) {
  const [platform, setPlatform] = useState(() =>
    selected?.printers?.some((printer) => printer.Connection === "Windows spooler") ||
    navigator.platform.startsWith("Win") ? "windows" : "macos");
  const [step, setStep] = useState(initialStep);
  const [deviceId, setDeviceId] = useState(selected?.id || "");
  const [checking, setChecking] = useState(false);
  const row = devices.find((device) => device.id === deviceId);
  const status = row && printerSetupStatus(row);
  const ready = status?.readiness === "Ready" && status.calibration === "Passed" && status.unresolved === 0;
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
            {step === 2 ? (ready ? "Done" : "Close") : "Continue"}
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
            {platform === "windows" && <p>Install the printer driver and confirm the printer appears in <strong>Windows Printers &amp; scanners</strong>. For the first D520 test, use USB and the vendor driver. Bluetooth pairing or a printer visible only in Labelife does not provide a Windows print queue.</p>}
            <a className="btn-secondary inline-flex" href={printerInstallers[platform]} download>Download Bridge installer</a>
            <button className="btn-secondary" onClick={() => setStep(1)}>Bridge already installed</button>
          </>
        )}
        {step === 1 && (
          <>
            <a className="btn-secondary inline-flex" href="feedx-printer-staging://setup">Open Bridge Setup</a>
            <p>If it does not open, launch FeedX Print Bridge Staging from Applications or the Windows Start menu.</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>{selected
                ? <>Choose <strong>Reconnect</strong> to resume this computer’s bridge using its saved printer and calibration. Use <strong>Connect / Configure</strong> when changing the printer or stock.</>
                : <>Choose <strong>Connect / Configure</strong>. Sign in with your authorized FeedX Staging account, then select the local printer and enter its stock dimensions. A returning computer reuses its saved configuration.</>}</li>
              {platform === "windows" ? (
                <li>Choose the installed Windows label printer queue and <strong>Windows Driver</strong>. For the D520, set the driver’s gap stock to 80 × 90 mm in portrait and enter 80 × 90 mm in the Bridge. Run <strong>Connection Check</strong> to verify Windows reports the queue available.</li>
              ) : (
                <li>Run <strong>Connection Check</strong>. For D520 Bluetooth, power on and pair the D520 in macOS, then close Labelife so it releases the connection.</li>
              )}
              <li>When approved to print, open <strong>Test / Review Calibration</strong> and confirm {platform === "windows" ? "one TEST label" : "the copy count"}. Inspect the physical output before recording the result.{platform === "macos" && " macOS D520 Bluetooth requires a separate three-label test after the first label passes."}</li>
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
                <dt>Readiness</dt><dd><FactoryStatusBadge status={status.readiness} /></dd>
                <dt>Calibration</dt><dd><FactoryStatusBadge status={status.calibration} /></dd>
                <dt>Unresolved print jobs</dt><dd>{status.unresolved ?? "Not reported"}</dd>
              </dl>
            )}
            {status?.bridge === "Offline" && <p>Open Bridge Setup on the registered computer and choose <strong>Reconnect</strong>. If sign-in expired, choose <strong>Reauthorize</strong> with the original operator’s account.</p>}
            {status?.connection === "Unavailable" && <p>The bridge is online. Check printer power and {platform === "windows" ? "the Windows print queue" : "the local queue or Bluetooth pairing"}, then run <strong>Connection Check</strong>.</p>}
            {status?.calibration === "Needs review" && <p>Open <strong>Test / Review Calibration</strong> to inspect the previous attempt before another test.</p>}
            {status?.unresolved > 0 && <p role="alert">This computer is paused for print review. In the affected Job Order, open Print Labels → History and choose Confirm Printed or Report Issue after inspecting the output and clearing any held work. Reprints require a separate reviewed request. <a className="underline" href="/factory/job-orders">Open Job Orders</a></p>}
            <p role="status">{ready
              ? "Setup complete. This printer is ready for Job Order labels."
              : "Setup is verified when the bridge is online, the printer reports Ready, calibration has passed, and no job awaits review."}</p>
          </>
        )}
      </div>
    </Modal>
  );
}
