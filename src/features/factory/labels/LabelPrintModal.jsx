import { useCallback, useEffect, useRef, useState } from "react";
import { Printer, RefreshCw } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import FactoryPagination from "../components/FactoryPagination.jsx";
import { formatFactoryDate } from "../utils/factoryDates.js";
import { factoryLabelService } from "../../../services/factoryLabelService.js";
import { renderLabel, previewFrozenRaster } from "./labelRenderer.js";

import {
  pendingRequestKey,
  readPendingRequest,
  writePendingRequest,
} from "./pendingLabelRequest.js";

const missingLabels = {
  manufacturing_date: "Manufacturing date",
  expiry_date: "Expiry date",
  batch_no: "Batch reference",
  packaged_units: "Confirmed packaged units",
  confirmed_cartons: "Verified actual cartons",
};
export default function LabelPrintModal({ job, can, actorId, onClose }) {
  const storageKey = pendingRequestKey(actorId, job.id);
  const [initialRequest] = useState(() => readPendingRequest(storageKey));
  const [data, setData] = useState(null),
    [batch, setBatch] = useState(initialRequest?.p_production || ""),
    [labelKey, setLabelKey] = useState(initialRequest ? initialRequest.p_overrides?.label_key || "product" : ""),
    [device, setDevice] = useState(initialRequest?.p_device || ""),
    [quantity, setQuantity] = useState(
      initialRequest ? String(initialRequest.p_quantity) : "",
    ),
    [page, setPage] = useState(1);
  const [overrides, setOverrides] = useState({}),
    [draft, setDraft] = useState({}),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [image, setImage] = useState(null),
    [renderError, setRenderError] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [reprint, setReprint] = useState(null),
    [reason, setReason] = useState(""),
    [resolve, setResolve] = useState(null);
  const flight = useRef(false),
    generation = useRef(0),
    request = useRef(initialRequest);
  const pendingRequest = Boolean(request.current);
  const historyRef = useRef(null);
  const selectedHold = data?.devices?.find((entry) => entry.id === device)?.hold;
  const issue = resolve?.state === "Failed" && resolve.job.state !== "Queued";
  const usableCount = resolve?.state === "Confirmed"
    ? resolve.job.quantity
    : issue && /^\d+$/.test(resolve.count)
      ? Number(resolve.count)
      : null;
  const canRecordOutcome = resolve?.state === "Confirmed" ||
    (resolve?.reason.trim().length >= 3 &&
      (!issue || (usableCount !== null && usableCount <= resolve.job.quantity && resolve.cleared)));
  const previewOnly = job.status === "in_progress" || data?.preview_only;
  const canPrint = !previewOnly && can("factory_production.complete"),
    canRecover = can("factory_production.verify");
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = await factoryLabelService.context(
        job.id,
        batch || null,
        labelKey && labelKey !== "product" ? { ...overrides, label_key: labelKey } : overrides,
        page,
      );
      if (current !== generation.current) return;
      setData(result);
      setError("");
      if (!request.current && result.labels?.length && !result.labels.some((label) => label.label_key === labelKey)) {
        setLabelKey(result.labels[0].label_key);
      }
      if (job.status !== "in_progress" && !batch && result.batches.length) {
        setBatch(result.batches[0].id);
        return;
      }
      const limit = result.candidate?.quantity_limit ?? (result.candidate?.quantity_basis ? null : result.candidate?.packaged_units);
      setQuantity((q) =>
        q === "" && limit && result.candidate?.missing?.length === 0
          ? String(
              Math.min(
                10000,
                Math.max(0, limit - result.allocated),
              ),
            )
          : q,
      );
    } catch (e) {
      if (current === generation.current)
        setError(e.message || "Unable to load batch labels.");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [job.id, job.status, batch, labelKey, overrides, page]);
  useEffect(() => {
    load();
    return () => {
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!flight.current) load();
    }, 10000);
    return () => clearInterval(timer);
  }, [load]);
  const candidate = data?.candidate,
    candidateKey = JSON.stringify([candidate, data?.saved_raster, previewOnly]);
  useEffect(() => {
    let active = true;
    setImage(null);
    setRenderError("");
    if (!request.current) setConfirmed(false);
    if (candidate?.definition && (previewOnly || candidate.missing?.length === 0))
      (data?.saved_raster
        ? Promise.resolve().then(() => previewFrozenRaster(data.saved_raster))
        : renderLabel(previewOnly ? {
          ...candidate,
          batch_no: candidate.batch_no ?? "BATCH",
          manufacturing_date: candidate.manufacturing_date ?? "DD/MM/YYYY",
          expiry_date: candidate.expiry_date ?? "DD/MM/YYYY",
          packaged_units: candidate.packaged_units ?? "PACKS",
        } : candidate)
      )
        .then((result) => {
          if (active) setImage(result);
        })
        .catch((e) => {
          if (active) setRenderError(e.message);
        });
    return () => {
      active = false;
    };
  }, [candidateKey]);
  const resetRequest = () => {
    request.current = null;
    writePendingRequest(storageKey, null);
    setConfirmed(false);
  };
  async function submit() {
    if (!canPrint || flight.current || (!request.current && (!confirmed || !image || !usable || quantityExceedsLimit))) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!request.current)
        request.current = {
          p_request_id: crypto.randomUUID(),
          p_production: batch,
          p_device: device,
          p_quantity: Number(quantity),
          p_expected_snapshot: candidate,
          p_raster: reprint ? null : image.raster,
          p_overrides: labelKey && labelKey !== "product" ? { ...overrides, label_key: labelKey } : overrides,
          p_reprint_of: reprint?.id || null,
          p_reason: reprint ? reason : null,
        };
      writePendingRequest(storageKey, request.current);
      await factoryLabelService.enqueue(request.current);
      writePendingRequest(storageKey, null);
      request.current = null;
      setConfirmed(false);
      setReprint(null);
      setReason("");
      setQuantity("");
      setNotice("Labels queued.");
      await load();
      historyRef.current?.scrollIntoView?.({ block: "start" });
    } catch (e) {
      if (e.code) {
        request.current = null;
        writePendingRequest(storageKey, null);
      }
      setError(
        e.message ||
          "Print submission uncertain. Retry this request to check its saved result.",
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function resolvePrint() {
    if (!canRecover || !resolve || !canRecordOutcome || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await factoryLabelService.resolve(
        resolve.job.id,
        resolve.state,
        resolve.state === "Confirmed"
          ? "Operator inspected the full count and confirmed usable output."
          : resolve.reason.trim(),
        usableCount,
      );
      setResolve(null);
      setNotice(resolve.job.state === "Unknown"
        ? "Print outcome recorded. The bridge can continue queued work."
        : "Print outcome recorded.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  const labelLimit = candidate?.quantity_limit ?? (candidate?.quantity_basis ? null : candidate?.packaged_units);
  const remainingQuantity = labelLimit == null ? null : Math.max(0, Number(labelLimit) - (data?.allocated || 0));
  const quantityExceedsLimit = !reprint && remainingQuantity != null && Number(quantity) > remainingQuantity;
  const usable = Boolean(
    !previewOnly && image &&
      !renderError &&
      !error &&
      !loading &&
      candidate?.missing?.length === 0,
  );
  return (
    <Modal
      title="Print Labels"
      description={`${job.job_order_no} · ${previewOnly ? "Preview only" : "Completed packaged output"}`}
      size="2xl"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn-secondary" disabled={busy} onClick={onClose}>
            Close
          </button>
          {!previewOnly && <button
            className="btn-primary"
            disabled={
              busy ||
              !canPrint ||
              (!pendingRequest &&
                (!usable ||
                  !confirmed ||
                  !device ||
                  Number(quantity) < 1 ||
                  Number(quantity) > 10000 ||
                  !Number.isInteger(Number(quantity)) || quantityExceedsLimit ||
                  (reprint && reason.trim().length < 3)))
            }
            onClick={submit}
          >
            <Printer size={15} />
            {busy
              ? "Submitting…"
              : pendingRequest
                ? "Retry Submitted Request"
                : reprint
                  ? "Queue Reprint"
                  : "Print Labels"}
          </button>}
        </>
      }
    >
      <div className="space-y-5">
        {error && (
          <p role="alert" className="text-sm text-text-primary">
            {error}{" "}
            <button className="btn-secondary" disabled={busy} onClick={load}>
              Refresh
            </button>
          </p>
        )}
        {pendingRequest && (
          <p role="status" className="text-sm text-text-primary">
            A submitted request is awaiting confirmation. Retry checks that same
            request; its printer, quantity and saved pixels remain fixed.
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-text-primary">
            {notice}
          </p>
        )}
        {previewOnly && (
          <p role="status" className="rounded-lg border border-border bg-surface-muted p-3 text-sm">
            Printing is locked until Production is completed and the batch reference, dates and actual packaging quantities are confirmed. Unconfirmed values appear as placeholders. Reopen Print Labels after completion.
          </p>
        )}
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <Field label="Label configuration">
              <SearchableSelect ariaLabel="Label configuration" value={labelKey}
                options={(data?.labels || []).map((label) => ({
                  value: label.label_key,
                  label: label.name,
                }))}
                disabled={busy || pendingRequest || !data?.labels?.length}
                onChange={(value) => {
                  setLabelKey(value);
                  setDraft({});
                  setOverrides({});
                  setQuantity("");
                  setReprint(null);
                  setReason("");
                  setResolve(null);
                  setPage(1);
                  resetRequest();
                }} />
            </Field>
            {data?.labels?.length === 0 && (
              <p>No active labels for this Packaging SKU. Activate a label in Factory Settings → Label Management.</p>
            )}
            {!previewOnly && <Field label="Production batch">
              <SearchableSelect
                value={batch}
                disabled={busy || pendingRequest}
                options={(data?.batches || []).map((b) => ({
                  value: b.id,
                  label: `${b.batch_no || "Batch reference missing"} · ${b.packaged_units ?? "Unconfirmed"} packs`,
                }))}
                onChange={(v) => {
                  setBatch(v);
                  setOverrides({});
                  setDraft({});
                  setQuantity("");
                  setReprint(null);
                  setPage(1);
                  resetRequest();
                }}
              />
            </Field>}
            {loading && !data && <p role="status">Loading batch evidence…</p>}
            {!previewOnly && data && !data.batches.length && (
              <p>
                No completed Production batch is available for this Job Order.
              </p>
            )}
            {candidate?.missing?.includes("label_configuration") && !data?.labels ? (
              <p role="alert">
                Configure this Packaging SKU’s approved label in Factory Settings → Label Management before printing.
              </p>
            ) : null}
            {!previewOnly && !pendingRequest && candidate?.missing?.some(
              (key) => key !== "label_configuration",
            ) && (
              <div className="space-y-3 rounded-xl border border-border p-4">
                <h3 className="font-semibold text-text-primary">
                  Confirm missing batch evidence
                </h3>
                <p className="text-sm text-text-secondary">
                  These values are saved with the label only. Check the original
                  production and packaging evidence. For cartons, confirm the actual counted cartons from packaging evidence.
                </p>
                {candidate.missing
                  .filter((key) => missingLabels[key])
                  .map((key) => (
                    <Field key={key} label={missingLabels[key]}>
                      {key.endsWith("_date") ? (
                        <FeedXDatePicker
                          value={draft[key] || ""}
                          onChange={(v) =>
                            setDraft((d) => ({ ...d, [key]: v }))
                          }
                        />
                      ) : (
                        <input
                          aria-label={missingLabels[key]}
                          className={inputClass()}
                          type={key === "batch_no" ? "text" : "number"}
                          min="1"
                          step="1"
                          value={draft[key] || ""}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [key]: e.target.value }))
                          }
                        />
                      )}
                    </Field>
                  ))}
                <Field label="Evidence / confirmation reason">
                  <input
                    aria-label="Evidence / confirmation reason"
                    className={inputClass()}
                    value={draft.reason || ""}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, reason: e.target.value }))
                    }
                  />
                </Field>
                <button
                  className="btn-secondary"
                  disabled={
                    busy || !canPrint || (draft.reason || "").trim().length < 3
                  }
                  onClick={() => {
                    setOverrides({ ...draft, confirmed: true });
                    resetRequest();
                  }}
                >
                  Confirm Evidence and Preview
                </button>
              </div>
            )}
            {candidate?.definition && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-text-secondary">
                  Confirmed packaged units
                </dt>
                <dd className="font-semibold">
                  {candidate.packaged_units ?? "Missing"}
                </dd>
                <dt className="text-text-secondary">Manufacturing date</dt>
                <dd>{formatFactoryDate(candidate.manufacturing_date)}</dd>
                <dt className="text-text-secondary">Expiry date</dt>
                <dd>{formatFactoryDate(candidate.expiry_date)}</dd>
                <dt className="text-text-secondary">Label version</dt>
                <dd>
                  {candidate.config_version} · Template{" "}
                  {candidate.template_version}
                </dd>
                {!previewOnly && <>
                  <dt className="text-text-secondary">Label limit for this batch</dt>
                  <dd>{labelLimit ?? "Missing"}</dd>
                  <dt className="text-text-secondary">Initial labels allocated</dt>
                  <dd>{data.allocated}</dd>
                </>}
              </dl>
            )}
            {candidate?.sources &&
              Object.keys(candidate.sources).length > 0 && (
                <p className="text-sm text-text-secondary">
                  {candidate.sources.expiry_calculation
                    ? `Expiry calculated using the approved ${candidate.sources.approved_shelf_life_days}-day rule. `
                    : ""}
                  {candidate.sources.reason
                    ? `Missing evidence confirmed: ${candidate.sources.reason}`
                    : ""}
                </p>
              )}
            {!previewOnly && <>
            <Field label="Print bridge">
              <SearchableSelect
                value={device}
                disabled={busy || pendingRequest}
                options={(data?.devices || []).map((d) => ({
                  value: d.id,
                  label: `${d.name} · ${d.printer_name}`,
                  helper: `${d.hold ? "Held for print review" : Date.now() - Date.parse(d.last_seen) > 90000 ? "Offline" : d.status} · ${d.transport}`,
                }))}
                onChange={(v) => {
                  setDevice(v);
                  resetRequest();
                }}
              />
            </Field>
            {selectedHold && (
              <p role="status" className="text-sm text-text-secondary">
                This bridge is paused. Review the print in Job Order {selectedHold.job_order_no}
                {selectedHold.batch_no && ` · batch ${selectedHold.batch_no}`}.
                New work stays queued until that outcome is recorded.
              </p>
            )}
            {!data?.devices?.length && (
              <p className="text-sm text-text-secondary">
                Set up the Windows or macOS Print Bridge to register a printer.
              </p>
            )}
            <p className="text-sm">
              <a
                className="underline"
                href="/downloads/FeedX-Print-Bridge-Staging-Windows.exe"
                download
              >
                Download Windows Print Bridge
              </a>
              {" · "}
              <a className="underline" href="/downloads/FeedX-Print-Bridge-Staging-macOS-arm64.pkg" download>
                Download macOS Print Bridge
              </a>
            </p>
            <Field label="Label quantity">
              <input
                aria-label="Label quantity"
                className={inputClass()}
                type="number"
                min="1"
                max={reprint || remainingQuantity == null ? 10000 : Math.min(10000, remainingQuantity)}
                step="1"
                disabled={busy || pendingRequest || !canPrint}
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  resetRequest();
                }}
              />
            </Field>
            {quantityExceedsLimit && (
              <p role="alert" className="text-sm text-text-secondary">
                {remainingQuantity} labels remain available for this configuration and batch.
              </p>
            )}
            {reprint && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">
                  Reprinting saved batch label · {reprint.state}
                </p>
                <Field label="Reprint reason">
                  <input
                    aria-label="Reprint reason"
                    className={inputClass()}
                    disabled={busy || pendingRequest}
                    minLength={3}
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      resetRequest();
                    }}
                  />
                </Field>
                <button
                  className="btn-secondary"
                  disabled={busy || pendingRequest}
                  onClick={() => {
                    setReprint(null);
                    resetRequest();
                  }}
                >
                  Cancel Reprint
                </button>
              </div>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                disabled={!usable || busy || pendingRequest || !canPrint}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                I checked the preview, dates, batch, printer and{" "}
                {quantity || "selected"} label quantity.
                {reprint
                  ? " I inspected the original outcome and authorize these additional labels."
                  : ""}
              </span>
            </label>
            </>}
          </div>
          <div className="min-w-0 space-y-3">
            <h3 className="font-semibold text-text-primary">Label preview</h3>
            {renderError && (
              <p role="alert" className="text-sm text-text-primary">
                {renderError}
              </p>
            )}
            {image ? (
              <img
                src={image.preview}
                alt={`Label preview for ${candidate.product_name}, batch ${candidate.batch_no || "unconfirmed"}`}
                className="mx-auto h-auto w-full max-w-80 border border-border bg-white"
              />
            ) : (
              <p className="text-sm text-text-secondary">
                {previewOnly ? "Select an active label to preview its layout." : "Complete the batch evidence and label configuration to preview."}
              </p>
            )}
            {image && (
              <p className="text-center text-sm text-text-secondary">
                {candidate.width_mm} × {candidate.height_mm} mm ·{" "}
                {image.raster.width} × {image.raster.height} dots · 203 DPI
              </p>
            )}
            <p className="text-sm text-text-secondary">
              Offline printers retain queued work. Interrupted or uncertain
              prints require review before the bridge continues. Sent is command
              submission; Confirmed requires physical inspection.
            </p>
          </div>
        </div>
        {!previewOnly && <div ref={historyRef} className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-text-primary">Print history</h3>
            <button
              className="btn-secondary"
              disabled={busy || loading}
              onClick={load}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
          {!data?.history?.length && (
            <p className="text-sm text-text-secondary">
              No print requests for the selected label and batch.
            </p>
          )}
          {(data?.history || []).map((h) => {
            const events = h.events || [];
            const inspection = events.findLast((event) => event.usable_quantity != null);
            const submission = events.findLast((event) => ["Sent", "Unknown"].includes(event.state));
            return (
              <div
                key={h.id}
                className="space-y-2 border-b border-border pb-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <strong>
                      {h.state} · {h.quantity} requested
                    </strong>
                    <p className="text-text-secondary">
                      {h.operator_name || "Recorded operator"} ·{" "}
                      {formatFactoryDate(h.created_at)} · Template{" "}
                      {h.template_version}{h.label_name ? ` · ${h.label_name}` : ""}
                      {h.reprint_of ? " · Reprint" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canRecover &&
                      ["Confirmed", "Failed"].includes(
                        h.state,
                      ) && (
                        <button
                          className="btn-secondary"
                          disabled={busy || pendingRequest}
                          onClick={() => {
                            setReprint(h);
                            setReason("");
                            setQuantity(h.state === "Failed" && inspection
                              ? String(h.quantity - inspection.usable_quantity || "")
                              : String(h.quantity));
                            resetRequest();
                          }}
                        >
                          Reprint
                        </button>
                      )}
                    {canRecover && ["Sent", "Unknown"].includes(h.state) &&
                      [["Confirmed", "Confirm Printed"], ["Failed", "Report Issue"]].map(([state, label]) => (
                        <button
                          key={state}
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => setResolve({ job: h, state, reason: "", count: "", cleared: false })}
                        >
                          {label}
                        </button>
                      ))}
                    {canRecover && ["Queued", "Printing"].includes(h.state) && (
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() =>
                            setResolve({
                              job: h,
                              state: h.state === "Queued" ? "Failed" : "Unknown",
                              reason: "",
                            })
                          }
                        >
                          Review Outcome
                        </button>
                      )}
                  </div>
                </div>
                {h.state === "Unknown" && (
                  <p className="text-text-secondary">
                    Check the physical output before printing again. This bridge is paused until the outcome is recorded.
                  </p>
                )}
                {submission && (
                  <p><strong>Submission {submission.state === "Sent" ? "accepted" : "uncertain"}.</strong>{" "}{submission.detail}</p>
                )}
                {inspection ? (
                  <p><strong>Usable labels {inspection.usable_quantity} of {h.quantity}.</strong>{" "}
                    {inspection.state === "Confirmed" ? "Physically confirmed." : inspection.detail}
                  </p>
                ) : (
                  <>
                    {["Sent", "Unknown"].includes(h.state) && <p>Physical output awaiting inspection.</p>}
                    {h.detail && h.detail !== submission?.detail && <p>{h.detail}</p>}
                  </>
                )}
                {h.reprint_reason && <p>Reprint reason · {h.reprint_reason}</p>}
                {resolve?.job.id === h.id && canRecover && (
                  <div className="space-y-3 rounded-lg border border-border p-3">
                    <p className="text-text-secondary">
                      {resolve.state === "Confirmed"
                        ? `Have you checked that all ${h.quantity} labels printed and are usable?`
                        : issue
                          ? "Count the usable labels and clear any held output before recording the issue."
                          : h.state === "Queued"
                            ? "Cancel this queued print request."
                            : "Inspect the printer before continuing. An active submission cannot be cancelled."}
                    </p>
                    {issue && (
                      <Field label="Usable labels">
                        <input
                          aria-label="Usable labels"
                          className={inputClass()}
                          type="number"
                          min="0"
                          max={h.quantity}
                          step="1"
                          value={resolve.count}
                          disabled={busy}
                          onChange={(e) => setResolve((r) => ({ ...r, count: e.target.value }))}
                        />
                      </Field>
                    )}
                    {resolve.state !== "Confirmed" && (
                      <Field label="Inspection / recovery reason">
                        <input
                          aria-label="Inspection / recovery reason"
                          className={inputClass()}
                          maxLength={1000}
                          value={resolve.reason}
                          disabled={busy}
                          onChange={(e) => setResolve((r) => ({ ...r, reason: e.target.value }))}
                        />
                      </Field>
                    )}
                    {issue && (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={resolve.cleared}
                          disabled={busy}
                          onChange={(e) => setResolve((r) => ({ ...r, cleared: e.target.checked }))}
                        />
                        I inspected the printer and cleared any held output.
                      </label>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-secondary" disabled={busy} onClick={() => setResolve(null)}>
                        Back
                      </button>
                      <button className="btn-primary" disabled={busy || !canRecordOutcome} onClick={resolvePrint}>
                        {resolve.state === "Confirmed" ? `Confirm ${h.quantity} usable labels` : "Record Outcome"}
                      </button>
                    </div>
                  </div>
                )}
                <details>
                  <summary className="cursor-pointer text-text-secondary">
                    Audit history
                  </summary>
                  {events.map((e) => (
                    <p key={e.id} className="mt-1">
                      {e.state} · {new Date(e.created_at).toLocaleString()} ·{" "}
                      {e.detail || "Recorded by operator"}
                      {e.usable_quantity != null && ` · ${e.usable_quantity} usable`}
                    </p>
                  ))}
                </details>
              </div>
            );
          })}
          {data?.history_total > 20 && (
            <FactoryPagination
              page={page}
              pageSize={20}
              total={data.history_total}
              onPageChange={setPage}
              onPageSizeChange={() => {}}
            />
          )}
        </div>}
      </div>
    </Modal>
  );
}
