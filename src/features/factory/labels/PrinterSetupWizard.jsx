import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Monitor, Replace } from "lucide-react";
import WorkflowStepper from "../../../components/feedback/WorkflowStepper.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import FactorySegmentedControl from "../components/FactorySegmentedControl.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";

export const printerInstallers = {
  macos: "/downloads/FeedX-Print-Bridge-Staging-macOS-arm64.pkg",
  windows: "/downloads/FeedX-Print-Bridge-Staging-Windows.exe",
};

export function livePrinterReport(row, online, now = Date.now()) {
  if (!online) return null;
  const printer = row.printers?.find((entry) => entry.Name === row.printer_name);
  if (!printer) return null;
  if ("ConnectionCheckedAt" in printer) {
    const age = now - Date.parse(printer.ConnectionCheckedAt);
    if (!Number.isFinite(age) || age < -10000 || age > 90000) return null;
  }
  return printer;
}

export function printerSetupStatus(row, now = Date.now()) {
  const latest = Date.parse(row.last_seen);
  const online = row.enabled && Number.isFinite(latest) && now - latest <= 90000;
  const printer = row.printers?.find((entry) => entry.Name === row.printer_name);
  const report = livePrinterReport(row, online, now);
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
  return /win/i.test(platform) ? "windows" : /mac/i.test(platform) ? "macos" : null;
}

const steps = ["Install", "Authorize", "Connect Printer", "Test Print", "Ready"];
const installerDetails = {
  macos: { name: "macOS", arch: "Apple silicon (arm64)", fallback: "Applications" },
  windows: { name: "Windows", arch: "Windows 10/11 · x86 installer", fallback: "the Start menu" },
};

export default function PrinterSetupWizard({ onClose, onRefresh, devices, selected, now, refreshError }) {
  const [recommended] = useState(recommendedPlatform);
  const [platform, setPlatform] = useState(bridgeRelease(selected).platform || recommended || "windows");
  const [opening, setOpening] = useState(false);
  const [selection, setSelection] = useState(selected ?? null);
  const [choosing, setChoosing] = useState(false);
  const [checking, setChecking] = useState(false);
  const knownDeviceIds = useRef(new Set(devices.map((device) => device.id)));
  const newDevices = opening ? devices.filter((device) =>
    !knownDeviceIds.current.has(device.id) && bridgeRelease(device).platform === platform) : [];
  const row = devices.find((device) => device.id === selection?.id) || selection
    || (newDevices.length === 1 ? newDevices[0] : null);

  useEffect(() => {
    if (row) setSelection(row);
  }, [row]);

  const status = row && printerSetupStatus(row, now);
  const step = !row ? opening ? 1 : 0
    : status.connection !== "Available" ? 2 : status.calibration !== "Passed" ? 3 : 4;
  const held = status?.unresolved > 0;
  const ready = step === 4 && status.readiness === "Ready" && status.unresolved === 0;
  const installing = step === 0;
  const installer = installerDetails[platform];
  const localApp = installerDetails[bridgeRelease(row).platform || platform];
  const choices = row && !devices.some((device) => device.id === row.id) ? [row, ...devices] : devices;
  const probe = row && livePrinterReport(row, status.bridge === "Online", now);
  const launch = (label, className = "btn-primary") => (
    <a href={bridgeLaunchUrl} className={className} onClick={() => setOpening(true)}>{label}</a>
  );
  let action;
  if (held) action = <a href="/factory/job-orders" className="btn-primary">Review Print History</a>;
  else if (installing) action = <a className="btn-primary" href={printerInstallers[platform]} download>
    <ArrowDownToLine size={15} aria-hidden="true" /> Download Installer
  </a>;
  else if (ready) action = <button type="button" className="btn-primary" onClick={onClose}>Done</button>;
  else action = launch(step === 2 && status.bridge === "Offline" ? "Reconnect in Bridge" : "Open Bridge");

  async function refresh() {
    setChecking(true);
    try { await onRefresh(); } finally { setChecking(false); }
  }

  return (
    <Modal title="Printer Setup" description={row ? <span className="break-words">{row.name}</span> : undefined}
      headerActions={row && (
        <button type="button" className="btn-secondary" aria-label="Change workstation"
          aria-expanded={choosing} aria-controls="printer-setup-workstation" onClick={() => setChoosing(!choosing)}>
          <Replace size={14} aria-hidden="true" />
          <span>Change<span className="hidden sm:inline"> workstation</span></span>
        </button>
      )}
      size="md" onClose={onClose} footerClassName="flex-wrap"
      footer={<>
        {!ready && <button type="button" className="btn-secondary" onClick={onClose}>Set Up Later</button>}
        {action}
      </>}>
      <div className="space-y-4 text-sm">
        <WorkflowStepper steps={steps} current={step} complete={ready} label="Printer setup steps" />
        {installing && (
          <>
            <div>
              <FactorySegmentedControl label="Bridge operating system" value={platform}
                onChange={setPlatform} options={Object.entries(installerDetails).map(([value, { name }]) => ({
                  value,
                  label: recommended === value ? `${name} · Recommended` : name,
                }))} />
            </div>
            <section aria-label="Installer" className="flex items-start gap-3 rounded-xl border border-border bg-[var(--theme-surface-nested)] p-3">
              <Monitor size={19} aria-hidden="true" className="mt-0.5 shrink-0 text-text-secondary" />
              <div className="min-w-0 space-y-1">
                <h3 className="font-semibold text-text-primary">FeedX Print Bridge for {installer.name}</h3>
                <p className="text-xs text-text-secondary">{installer.arch} · v{bridgeInstallerVersion}</p>
                <p className="text-text-secondary">Install on the workstation connected to the printer.</p>
              </div>
            </section>
          </>
        )}
        {!row && (installing || choices.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            {installing && launch("Already installed? Open Bridge", "btn-secondary")}
            {choices.length > 0 && (
              <button type="button" className="btn-secondary" aria-expanded={choosing} aria-controls="printer-setup-workstation"
                onClick={() => setChoosing(!choosing)}>Use a Registered Workstation</button>
            )}
          </div>
        )}
        <div id="printer-setup-workstation" hidden={!choosing}>
          {choosing && <SearchableSelect ariaLabel="Registered workstation" value={row?.id || ""}
            placeholder="Select a workstation" options={choices.map((device) => ({
              value: device.id,
              label: device.name,
              description: device.printer_name,
            }))}
            onChange={(id) => {
              setSelection(choices.find((device) => device.id === id));
              setChoosing(false);
            }} />}
        </div>

        {step === 1 && <p role="status" className="text-text-secondary">
          Follow the authorization prompt in your browser. FeedX will advance when the Bridge registers this workstation.
        </p>}
        {step === 2 && (
          <div className="space-y-2">
            <dl className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-xl border border-border p-3">
              <dt>Bridge</dt><dd><FactoryStatusBadge status={status.bridge} tone={status.bridge === "Online" ? "success" : undefined} /></dd>
              <dt>Printer connection</dt><dd><FactoryStatusBadge status={status.connection} /></dd>
            </dl>
            {!held && <p role="status" className="text-text-secondary">
              {probe?.ConnectionDetail || (status.bridge === "Offline"
                ? "Choose Reconnect in the Bridge. Authorize again if prompted."
                : "Select your printer in the Bridge and run Connection Check. The result appears here automatically.")}
            </p>}
          </div>
        )}
        {step === 3 && !held && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
              <span>{row.printer_name}</span><FactoryStatusBadge status={status.calibration} />
            </div>
            <p className="text-text-secondary">Approve one test in the Bridge, then inspect the label and confirm the physical result.</p>
          </div>
        )}
        {held ? (
          <div role="status" className="badge-warning rounded-xl border p-3">
            <p className="font-semibold">Print output needs review</p>
            <p>Review pending output in Job Orders before printing.</p>
          </div>
        ) : ready ? (
          <div role="status" className="badge-success rounded-xl border p-3">
            <p className="font-semibold">Ready for Job Order labels.</p>
            <p>{row.printer_name}</p>
          </div>
        ) : step === 4 && <p role="status" className="text-text-secondary">Check printer readiness in the Bridge.</p>}

        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer font-medium text-text-primary">Troubleshooting</summary>
          <div className="mt-2 space-y-2 text-text-secondary">
            <p>If the browser cannot open the Bridge, open FeedX Print Bridge Staging from {localApp.fallback} on the printer workstation.</p>
            <button type="button" className="btn-secondary" disabled={checking} onClick={refresh}>
              {checking ? "Checking…" : "Refresh Status"}
            </button>
            {refreshError && <p role="status">Could not refresh status. Try again when you’re connected to FeedX.</p>}
          </div>
        </details>
      </div>
    </Modal>
  );
}
