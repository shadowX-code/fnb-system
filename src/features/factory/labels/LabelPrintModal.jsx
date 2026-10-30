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
};
export default function LabelPrintModal({ job, can, actorId, onClose }) {
  const storageKey = pendingRequestKey(actorId, job.id);
  const [initialRequest] = useState(() => readPendingRequest(storageKey));
  const [data, setData] = useState(null),
    [batch, setBatch] = useState(initialRequest?.p_production || ""),
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
  const canPrint = can("factory_production.complete"),
    canRecover = can("factory_production.verify");
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = await factoryLabelService.context(
        job.id,
        batch || null,
        overrides,
        page,
      );
      if (current !== generation.current) return;
      setData(result);
      setError("");
      if (!batch && result.batches.length) {
        setBatch(result.batches[0].id);
        return;
      }
      setQuantity((q) =>
        q === "" && result.candidate?.packaged_units
          ? String(
              Math.min(
                10000,
                Math.max(0, result.candidate.packaged_units - result.allocated),
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
  }, [job.id, batch, overrides, page]);
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
    candidateKey = JSON.stringify([candidate, data?.saved_raster]);
  useEffect(() => {
    let active = true;
    setImage(null);
    setRenderError("");
    if (!request.current) setConfirmed(false);
    if (candidate?.definition && candidate.missing?.length === 0)
      (data?.saved_raster
        ? Promise.resolve().then(() => previewFrozenRaster(data.saved_raster))
        : renderLabel(candidate)
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
    if (flight.current || (!request.current && (!confirmed || !image))) return;
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
          p_overrides: overrides,
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
      setNotice(
        "Labels queued. Sent means accepted by the print transport; confirm the physical labels after inspection.",
      );
      await load();
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
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      await factoryLabelService.resolve(
        resolve.job.id,
        resolve.state,
        resolve.reason,
      );
      setResolve(null);
      setNotice("Print outcome recorded.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  const usable = Boolean(
    image &&
      !renderError &&
      !error &&
      !loading &&
      candidate?.missing?.length === 0,
  );
  return (
    <Modal
      title="Print Labels"
      description={`${job.job_order_no} · Completed packaged output`}
      size="2xl"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn-secondary" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button
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
          </button>
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
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <Field label="Production batch">
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
            </Field>
            {loading && !data && <p role="status">Loading batch evidence…</p>}
            {data && !data.batches.length && (
              <p>
                No completed Production batch is available for this Job Order.
              </p>
            )}
            {candidate?.missing?.includes("label_configuration") ? (
              <p role="alert">
                Configure this Packaging SKU’s approved label in Factory Settings → Label Management before printing.
              </p>
            ) : null}
            {candidate?.missing?.some(
              (key) => key !== "label_configuration",
            ) && (
              <div className="space-y-3 rounded-xl border border-border p-4">
                <h3 className="font-semibold text-text-primary">
                  Confirm missing batch evidence
                </h3>
                <p className="text-sm text-text-secondary">
                  These values are saved with the label only. Check the original
                  production and packaging evidence.
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
                          type={key === "packaged_units" ? "number" : "text"}
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
                <dt className="text-text-secondary">
                  Initial labels allocated
                </dt>
                <dd>{data.allocated}</dd>
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
            <Field label="Windows print bridge">
              <SearchableSelect
                value={device}
                disabled={busy || pendingRequest}
                options={(data?.devices || []).map((d) => ({
                  value: d.id,
                  label: `${d.name} · ${d.printer_name}`,
                  helper: `${Date.now() - Date.parse(d.last_seen) > 90000 ? "Offline" : d.status} · ${d.transport}`,
                }))}
                onChange={(v) => {
                  setDevice(v);
                  resetRequest();
                }}
              />
            </Field>
            {!data?.devices?.length && (
              <p className="text-sm text-text-secondary">
                Install and sign in to the Windows bridge to register a printer.
              </p>
            )}
            <p className="text-sm">
              <a
                className="underline"
                href="/downloads/feedx-print-bridge-staging.zip"
                download
              >
                Download Windows Print Bridge
              </a>
            </p>
            <Field label="Label quantity">
              <input
                aria-label="Label quantity"
                className={inputClass()}
                type="number"
                min="1"
                max="10000"
                step="1"
                disabled={busy || pendingRequest || !canPrint}
                value={quantity}
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
                alt={`Label preview for ${candidate.product_name}, batch ${candidate.batch_no}`}
                className="mx-auto h-auto w-full max-w-80 border border-border bg-white"
              />
            ) : (
              <p className="text-sm text-text-secondary">
                Complete the batch evidence and label configuration to preview.
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
        <div className="space-y-3 border-t border-border pt-4">
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
              No print requests for this batch.
            </p>
          )}
          {(data?.history || []).map((h) => (
            <div
              key={h.id}
              className="space-y-2 border-b border-border pb-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong>
                    {h.state} · {h.quantity} labels
                  </strong>
                  <p className="text-text-secondary">
                    {h.operator_name || "Recorded operator"} ·{" "}
                    {formatFactoryDate(h.created_at)} · Template{" "}
                    {h.template_version}
                    {h.reprint_of ? " · Reprint" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canRecover &&
                    ["Sent", "Confirmed", "Failed", "Unknown"].includes(
                      h.state,
                    ) && (
                      <button
                        className="btn-secondary"
                        disabled={busy || pendingRequest}
                        onClick={() => {
                          setReprint(h);
                          setReason("");
                          setQuantity(String(h.quantity));
                          resetRequest();
                        }}
                      >
                        Reprint
                      </button>
                    )}
                  {canRecover &&
                    ["Sent", "Unknown", "Queued", "Printing"].includes(
                      h.state,
                    ) && (
                      <button
                        className="btn-secondary"
                        disabled={busy}
                        onClick={() =>
                          setResolve({
                            job: h,
                            state:
                              h.state === "Queued"
                                ? "Failed"
                                : h.state === "Printing"
                                  ? "Unknown"
                                  : "Confirmed",
                            reason: "",
                          })
                        }
                      >
                        Review Outcome
                      </button>
                    )}
                </div>
              </div>
              {(h.detail || h.reprint_reason) && (
                <p>{h.detail || h.reprint_reason}</p>
              )}
              <details>
                <summary className="cursor-pointer text-text-secondary">
                  Audit history
                </summary>
                {(h.events || []).map((e) => (
                  <p key={e.id} className="mt-1">
                    {e.state} · {new Date(e.created_at).toLocaleString()} ·{" "}
                    {e.detail || "Recorded by operator"}
                  </p>
                ))}
              </details>
            </div>
          ))}
          {data?.history_total > 20 && (
            <FactoryPagination
              page={page}
              pageSize={20}
              total={data.history_total}
              onPageChange={setPage}
              onPageSizeChange={() => {}}
            />
          )}
        </div>
        {resolve && (
          <div className="space-y-3 rounded-xl border border-border p-4">
            <h3 className="font-semibold">Review Print Outcome</h3>
            <p className="text-sm text-text-secondary">
              Inspect the physical output and Windows queue. Clear any held
              spooler job before authorizing a reprint. A live Printing claim
              cannot be cancelled.
            </p>
            <SearchableSelect
              value={resolve.state}
              options={(resolve.job.state === "Queued"
                ? ["Failed"]
                : resolve.job.state === "Printing"
                  ? ["Unknown"]
                  : ["Confirmed", "Failed"]
              ).map((value) => ({
                value,
                label:
                  value === "Confirmed"
                    ? "Physically printed and inspected"
                    : value === "Failed"
                      ? "Not printed / remaining output discarded"
                      : "Interrupted; outcome uncertain",
              }))}
              onChange={(state) => setResolve((r) => ({ ...r, state }))}
            />
            <Field label="Inspection / recovery reason">
              <input
                aria-label="Inspection / recovery reason"
                className={inputClass()}
                maxLength={1000}
                value={resolve.reason}
                disabled={busy}
                onChange={(e) =>
                  setResolve((r) => ({ ...r, reason: e.target.value }))
                }
              />
            </Field>
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => setResolve(null)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={busy || resolve.reason.trim().length < 3}
                onClick={resolvePrint}
              >
                Record Outcome
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
