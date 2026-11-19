import { useCallback, useEffect, useRef, useState } from "react";
import { Printer, RefreshCw } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import FactoryPagination from "../components/FactoryPagination.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import { formatFactoryDate } from "../utils/factoryDates.js";
import { formatFactoryBatchNo } from "../utils/factoryFormatters.js";
import { factoryLabelService } from "../../../services/factoryLabelService.js";
import { renderLabel, previewFrozenRaster } from "./labelRenderer.js";
import { PrintJobDetails, PrintJobActions, PrintOutcomeForm, inspectPrint } from "./PrintJobReview.jsx";

import {
  pendingRequestKey,
  readPendingRequest,
  writePendingRequest,
} from "./pendingLabelRequest.js";

function printerStatus(printer) {
  if (printer.hold) return "Held for print review";
  if (!printer.last_seen || Date.now() - Date.parse(printer.last_seen) > 90000) return "Offline";
  return printer.status;
}

const missingLabels = {
  manufacturing_date: "Manufacturing date",
  expiry_date: "Expiry date",
  batch_no: "Batch No.",
  packaged_units: "Confirmed packaged units",
  confirmed_cartons: "Verified actual cartons",
};
const lifecycleMessage = {
  Queued: "Waiting for the print bridge to claim this job.",
  Printing: "The bridge is processing this submission.",
  Sent: "Submission accepted. Check the physical output before confirming.",
  Confirmed: "Physical output was confirmed.",
  Failed: "Review the recorded outcome before requesting a reprint.",
  Unknown: "Printer paused for physical inspection.",
};
const statusTone = { Queued: "neutral", Printing: "info", Sent: "info", Confirmed: "success", Failed: "danger", Unknown: "warning" };
export default function LabelPrintModal({ job, can, actorId, onClose }) {
  const storageKey = pendingRequestKey(actorId, job.id);
  const [initialRequest] = useState(() => readPendingRequest(storageKey));
  const [data, setData] = useState(null),
    [batch, setBatch] = useState(initialRequest?.p_production || ""),
    [labelKey, setLabelKey] = useState(initialRequest ? initialRequest.p_overrides?.label_key || "product" : ""),
    [device, setDevice] = useState(initialRequest?.p_device || ""),
    [quantity, setQuantity] = useState(
      initialRequest ? String(initialRequest.p_quantity) : null,
    ),
    [page, setPage] = useState(1);
  const [overrides, setOverrides] = useState({}),
    [draft, setDraft] = useState({}),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [renderedPreview, setRenderedPreview] = useState(null),
    [renderError, setRenderError] = useState(""),
    [reprint, setReprint] = useState(null),
    [reason, setReason] = useState(""),
    [resolve, setResolve] = useState(null);
  const [submittedId, setSubmittedId] = useState(null),
    [statusRead, setStatusRead] = useState(null),
    [statusVersion, setStatusVersion] = useState(0);
  const flight = useRef(false),
    generation = useRef(0),
    request = useRef(initialRequest);
  const pendingRequest = Boolean(request.current);
  const reviewRef = useRef(null);
  const quantityRef = useRef(null);
  const selectedPrinter = data?.devices?.find((entry) => entry.id === device);
  const statusKey = JSON.stringify([submittedId, device]);
  const currentStatus = statusRead?.key === statusKey ? statusRead : null;
  const submitted = currentStatus?.data?.submitted;
  const blocking = currentStatus?.data?.blocking;
  const selectedHold = currentStatus?.data ? blocking : selectedPrinter?.hold;
  const reviewJob = blocking || submitted;
  const showStatus = Boolean(submittedId || selectedHold);
  const reviewUnknown = reviewJob?.state === "Unknown" || Boolean(selectedHold);
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
  const contextKey = JSON.stringify([job.id, batch, labelKey, overrides]);
  const load = useCallback(async (foreground = true) => {
    const current = ++generation.current;
    if (foreground) setLoading(true);
    try {
      const result = await factoryLabelService.context(
        job.id,
        batch || null,
        labelKey && labelKey !== "product" ? { ...overrides, label_key: labelKey } : overrides,
        page,
      );
      if (current !== generation.current) return;
      setData({ ...result, contextKey });
      if (foreground) setError("");
      if (!result.preview_only && job.status !== "in_progress" && result.devices?.length === 1 && result.devices[0].hold) {
        setDevice((selected) => selected || result.devices[0].id);
      }
      if (!request.current && result.labels?.length && !result.labels.some((label) => label.label_key === labelKey)) {
        setLabelKey(result.labels[0].label_key);
      }
      if (job.status !== "in_progress" && !batch && result.batches.length) {
        setBatch(result.batches[0].id);
        return;
      }
      const limit = result.candidate?.quantity_limit ?? (result.candidate?.quantity_basis ? null : result.candidate?.packaged_units);
      setQuantity((q) =>
        q === null && limit && result.candidate?.missing?.length === 0
          ? String(
              Math.min(
                10000,
                Math.max(0, limit - result.allocated),
              ),
            )
          : q,
      );
    } catch (e) {
      if (foreground && current === generation.current)
        setError(e.message || "Unable to load batch labels.");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [job.id, job.status, batch, labelKey, overrides, page, contextKey]);
  useEffect(() => {
    load();
    return () => {
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!flight.current) load(false);
    }, 10000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!submittedId && !device) return;
    let active = true;
    let timer;
    async function refreshStatus() {
      try {
        const data = await factoryLabelService.printStatus(job.id, submittedId, device);
        if (active) setStatusRead({ key: statusKey, data });
      } catch {
        if (active) setStatusRead((previous) => ({
          key: statusKey, data: previous?.key === statusKey ? previous.data : null,
          error: "Print status could not be refreshed. Check again before submitting more labels.",
        }));
      } finally {
        if (active) timer = setTimeout(refreshStatus, 2500);
      }
    }
    refreshStatus();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [job.id, submittedId, device, statusKey, statusVersion]);
  const candidate = data?.candidate,
    candidateKey = JSON.stringify([candidate, data?.saved_raster, previewOnly]);
  const image = renderedPreview?.key === candidateKey ? renderedPreview.image : null;
  useEffect(() => {
    let active = true;
    setRenderError("");
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
          if (active) setRenderedPreview({ key: candidateKey, image: result });
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
  };
  async function submit() {
    if (queueBlock || flight.current) return;
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
      const id = await factoryLabelService.enqueue(request.current);
      writePendingRequest(storageKey, null);
      request.current = null;
      setReprint(null);
      setReason("");
      setQuantity(null);
      setSubmittedId(id);
      await load();
      reviewRef.current?.focus();
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
      setNotice("Print outcome recorded.");
      setStatusVersion((version) => version + 1);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  function beginResolve(job, state) {
    setResolve({ job, state, reason: "", count: "", cleared: false });
  }
  function beginReprint(job) {
    const { inspection } = inspectPrint(job);
    const missing = job.state === "Failed" && inspection?.state === "Failed"
      ? job.quantity - inspection.usable_quantity : 0;
    setSubmittedId(null);
    setReprint(job);
    setReason("");
    setQuantity(missing > 0 ? String(missing) : "");
    resetRequest();
    quantityRef.current?.focus();
  }
  const outcomeForm = resolve && (
    <PrintOutcomeForm {...{ resolve, setResolve, issue, busy, canRecordOutcome, resolvePrint }} />
  );
  const labelLimit = candidate?.quantity_limit ?? (candidate?.quantity_basis ? null : candidate?.packaged_units);
  const remainingQuantity = labelLimit == null ? null : Math.max(0, Number(labelLimit) - (data?.allocated || 0));
  const quantityExceedsLimit = !reprint && remainingQuantity != null && Number(quantity) > remainingQuantity;
  const quantityValid = Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= 10000;
  const quantityError = quantityExceedsLimit ? `Enter no more than ${remainingQuantity} labels.`
    : !quantityValid ? "Enter a whole quantity from 1 to 10,000." : "";
  const queueBlock =
    busy ? "Processing the current request…" :
    !canPrint ? "Printing requires Production completion permission." :
    selectedHold ? "Review the previous print before queueing to this printer." :
    pendingRequest ? "" :
    submittedId ? "Review the current submission before starting another print." :
    currentStatus?.error ? "Refresh the printer status before queueing." :
    error ? "Refresh the print context before queueing." :
    loading || data?.contextKey !== contextKey ? "Checking batch and label eligibility…" :
    !batch ? "Select a completed Production batch." :
    !candidate?.definition ? "Select an active label configuration." :
    candidate.missing?.length ? "Confirm the missing batch evidence." :
    renderError ? "Resolve the label preview error before queueing." :
    !image ? "Waiting for the label preview." :
    !reprint && remainingQuantity === 0 ? "The initial allowance is fully allocated. Use an authorized reprint." :
    !selectedPrinter ? "Select an available printer." :
    !currentStatus?.data ? "Checking the selected printer for unresolved prints…" :
    quantityError ? quantityError :
    reprint && reason.trim().length < 3 ? "Enter the reprint reason." : "";
  const productName = candidate?.production_product_name || job.product_family_name ||
    job.product_name_en || job.product_name || candidate?.product_name || "Packaging SKU";
  return (
    <Modal
      title="Print Labels"
      description={`${productName} · ${job.job_order_no} · ${previewOnly ? "In Progress" : "Completed"}`}
      size="2xl"
      panelClassName="max-sm:max-h-[calc(100dvh-2rem)]"
      onClose={busy ? undefined : onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-text-secondary" id="label-queue-status" aria-live="polite">
            {previewOnly || showStatus || queueBlock === quantityError ? "" : queueBlock}
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              {previewOnly ? "Back" : showStatus ? "Close" : "Cancel"}
            </button>
            {!previewOnly && reviewUnknown && (
              <button type="button" className="btn-primary" disabled={busy}
                onClick={() => reviewRef.current?.focus()}>
                {selectedHold && (!submittedId || blocking?.id !== submittedId) ? "Review Previous Print" : "Review Print Result"}
              </button>
            )}
            {!previewOnly && !reviewUnknown && submitted && ["Sent", "Confirmed", "Failed"].includes(submitted.state) && canPrint && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => {
                setSubmittedId(null);
                setResolve(null);
                setNotice("");
                quantityRef.current?.focus();
              }}>New Print</button>
            )}
            {!previewOnly && !showStatus && <button type="button" className="btn-primary" disabled={Boolean(queueBlock)}
              aria-describedby="label-queue-status" onClick={submit}>
              <Printer size={15} />
              {busy ? "Processing…" : pendingRequest ? "Retry Submitted Request" : reprint ? "Queue Reprint" : "Queue Labels"}
            </button>}
          </div>
        </div>
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
        {currentStatus?.error && (
          <p role="alert" className="text-sm text-text-primary">{currentStatus.error}{" "}
            <button type="button" className="btn-secondary" onClick={() => setStatusVersion((version) => version + 1)}>Check Status</button>
          </p>
        )}
        {!previewOnly && showStatus && (
          <section ref={reviewRef} tabIndex={-1} aria-labelledby="print-result-title"
            className="space-y-2 rounded-xl border border-border bg-surface-muted p-3 focus-visible:outline focus-visible:outline-2 md:p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 id="print-result-title" className="font-semibold text-text-primary">
                {reviewUnknown ? "Needs Review" : "Print Submission"}
              </h3>
              {reviewJob && <FactoryStatusBadge status={reviewJob.state} tone={statusTone[reviewJob.state]} />}
            </div>
            <div className="space-y-1 text-sm" aria-live="polite">
              {reviewJob ? (
                <>
                  <p className="font-medium">
                    {reviewJob.quantity} requested · Job Order {reviewJob.job_order_no || job.job_order_no}
                    {` · Batch No. ${formatFactoryBatchNo(reviewJob.batch_no)}`}
                    {" · "}Print {reviewJob.id.slice(0, 8)}
                  </p>
                  <p className="text-text-secondary">{lifecycleMessage[reviewJob.state]}</p>
                  {submitted && blocking && submitted.id !== blocking.id && (
                    <p className="text-text-secondary">Your submission · {submitted.state} · {submitted.quantity} requested</p>
                  )}
                </>
              ) : selectedHold ? (
                <p>Review the print in Job Order {selectedHold.job_order_no}
                  {` · Batch No. ${formatFactoryBatchNo(selectedHold.batch_no)}`}. Loading the blocking print details…</p>
              ) : <p>Checking the submitted print status…</p>}
            </div>
            {reviewJob && <PrintJobDetails job={reviewJob} printer={selectedPrinter?.printer_name} />}
            {reviewUnknown && !canRecover && <p className="text-sm text-text-secondary">Ask an authorized verifier to review the physical output.</p>}
            {reviewJob && canRecover && (
              <>
                <PrintJobActions job={reviewJob} busy={busy} onResolve={beginResolve} onReprint={beginReprint}
                  allowReprint={canPrint && !pendingRequest && data?.history?.some((entry) => entry.id === reviewJob.id)} />
                {resolve?.job.id === reviewJob.id && outcomeForm}
              </>
            )}
          </section>
        )}
        {previewOnly && (
          <p role="status" className="text-sm text-text-secondary">
            Preview only. Printing is available after Production is complete and batch evidence is confirmed.
          </p>
        )}
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-6">
          <div className="min-w-0 space-y-3">
            <Field label="Label">
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
                  setQuantity(null);
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
            {!previewOnly && <Field label="Batch No.">
              <SearchableSelect
                value={batch}
                disabled={busy || pendingRequest}
                options={(data?.batches || []).map((b) => ({
                  value: b.id,
                  label: `${formatFactoryBatchNo(b.batch_no)} · ${b.packaged_units ?? "Unconfirmed"} packs`,
                }))}
                onChange={(v) => {
                  setBatch(v);
                  setOverrides({});
                  setDraft({});
                  setQuantity(null);
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
            {!previewOnly && !pendingRequest && canPrint && !busy && !reprint && candidate?.definition &&
              !data?.saved_raster && (candidate.quantity_basis === "packaged_units" || overrides.carton_evidence) && (
              <button type="button" className="btn-secondary" disabled={loading}
                onClick={() => {
                  setOverrides(({ carton_evidence, confirmed_cartons, ...rest }) =>
                    carton_evidence ? rest : { ...rest, carton_evidence: true });
                  setDraft(({ confirmed_cartons, ...rest }) => rest);
                  setQuantity(null);
                  resetRequest();
                }}>
                {overrides.carton_evidence ? "Use confirmed packaged units" : "Use verified carton count"}
              </button>
            )}
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
                    setOverrides({ ...overrides, ...draft, confirmed: true });
                    resetRequest();
                  }}
                >
                  Confirm Evidence and Preview
                </button>
              </div>
            )}
            {candidate?.definition && (
              <dl className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                {(previewOnly || candidate.batch_no !== data?.batches?.find((item) => item.id === batch)?.batch_no) &&
                  <div className="min-w-0"><dt className="text-text-secondary">Batch No.</dt><dd className="break-words font-semibold">{formatFactoryBatchNo(candidate.batch_no)}</dd></div>}
                <div><dt className="text-text-secondary">MFG</dt><dd>{formatFactoryDate(candidate.manufacturing_date)}</dd></div>
                <div><dt className="text-text-secondary">EXP</dt><dd>{formatFactoryDate(candidate.expiry_date)}</dd></div>
              </dl>
            )}
            {!previewOnly && <>
            <Field label="Printer" helper={selectedPrinter && !selectedHold ? printerStatus(selectedPrinter) :
              data && !data.devices?.length ? "Set up a Print Bridge to register a printer." : undefined}>
              <SearchableSelect
                value={device}
                disabled={busy || pendingRequest}
                options={(data?.devices || []).map((d) => ({
                  value: d.id,
                  label: `${d.name} · ${d.printer_name}`,
                  helper: printerStatus(d),
                }))}
                onChange={(v) => {
                  setDevice(v);
                  resetRequest();
                }}
              />
            </Field>
            <Field label="Quantity"
              helper={remainingQuantity != null && !reprint ? `${remainingQuantity} remaining` : undefined}
              error={!showStatus && !pendingRequest && queueBlock === quantityError ? quantityError : undefined}>
              <input
                ref={quantityRef}
                aria-label="Label quantity"
                className={inputClass()}
                type="number"
                min="1"
                max={reprint || remainingQuantity == null ? 10000 : Math.min(10000, remainingQuantity)}
                step="1"
                disabled={busy || pendingRequest || !canPrint}
                value={quantity ?? ""}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  resetRequest();
                }}
              />
            </Field>
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
                    setQuantity(remainingQuantity == null ? null : String(Math.min(10000, remainingQuantity)));
                    resetRequest();
                  }}
                >
                  Cancel Reprint
                </button>
              </div>
            )}
            </>}
          </div>
          <div className="order-first min-w-0 space-y-3 rounded-xl border border-border bg-surface-muted p-3 md:sticky md:top-0 md:order-none md:p-4">
            <h3 className="text-sm font-semibold text-text-primary">Label preview · 203 DPI</h3>
            {renderError && (
              <p role="alert" className="text-sm text-text-primary">
                {renderError}
              </p>
            )}
            {image ? (
              <img
                src={image.preview}
                alt={`Label preview for ${candidate.product_name}, batch ${formatFactoryBatchNo(candidate.batch_no)}`}
                className="mx-auto h-auto max-h-[55dvh] w-auto max-w-full border border-border bg-white"
              />
            ) : (
              <p className="text-sm text-text-secondary">
                {previewOnly ? "Select an active label to preview its layout." : "Complete the batch evidence and label configuration to preview."}
              </p>
            )}
            {image && (
              <p className="text-center text-sm text-text-secondary">
                {candidate.width_mm} × {candidate.height_mm} mm ·{" "}
                {image.raster.width} × {image.raster.height} dots
              </p>
            )}
          </div>
        </div>
        {!previewOnly && <section aria-labelledby="label-print-history" className="space-y-2 rounded-xl border border-border bg-surface-muted p-3 md:p-4">
          <div className="flex items-center justify-between">
            <h3 id="label-print-history" className="font-semibold text-text-primary">Print History</h3>
            <button
              className="btn-secondary"
              disabled={busy || loading}
              onClick={() => {
                setStatusVersion((version) => version + 1);
                load();
              }}
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
            const shownInPanel = reviewJob?.id === h.id;
            return (
              <details key={h.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                <summary className="cursor-pointer">
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-text-secondary">{formatFactoryDate(h.created_at)}</span>
                    <span>{h.label_name || "Product Label"}{h.reprint_of ? " · Reprint" : ""}</span>
                    <span className="font-semibold">{h.quantity} requested</span>
                    <FactoryStatusBadge status={h.state} tone={statusTone[h.state]} />
                  </span>
                </summary>
                <div className="mt-3 space-y-3">
                  <PrintJobDetails job={h} audit printer={data.devices?.find((d) => d.id === h.device_id)?.printer_name} />
                  {canRecover && !shownInPanel && <PrintJobActions job={h} busy={busy}
                    allowReprint={!pendingRequest && canPrint} onResolve={beginResolve} onReprint={beginReprint} />}
                  {canRecover && !shownInPanel && resolve?.job.id === h.id && outcomeForm}
                </div>
              </details>
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
        </section>}
      </div>
    </Modal>
  );
}
