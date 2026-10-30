import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Save, CheckCircle2 } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import { factoryLabelService } from "../../../services/factoryLabelService.js";
import {
  labelPreviewSnapshot,
  productLabelDraft,
  templateLabelDraft,
  editableLabelDefinition,
} from "./labelManagementModel.js";
import LabelLayoutEditor from "./LabelLayoutEditor.jsx";
import useLabelPreview from "./useLabelPreview.js";
import { openLabelManagement } from "./labelManagementNavigation.js";
import { formatFactoryDate } from "../utils/factoryDates.js";
import ProductLabelContent from "./ProductLabelContent.jsx";
import LabelStudioCanvas from "./LabelStudioCanvas.jsx";
import FactorySegmentedControl from "../components/FactorySegmentedControl.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import { LockKeyhole, History } from "lucide-react";
import "./labelManagement.css";

export default function FactoryLabelEditorPage({
  kind,
  entityKey,
  canEdit,
  onBack,
  onConfirm,
}) {
  const [data, setData] = useState(null),
    [payload, setPayload] = useState(null),
    [draft, setDraft] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false),
    [approval, setApproval] = useState(false),
    [note, setNote] = useState(""),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState("content");
  const saved = useRef(""),
    reviewHeading = useRef(null),
    lock = useRef(false),
    request = useRef(null),
    publication = useRef(null);
  const load = () =>
    factoryLabelService
      .editor(kind, entityKey)
      .then((result) => {
        const value =
          kind === "product"
            ? productLabelDraft(result)
            : templateLabelDraft(result);
        setData(result);
        setPayload(value);
        setDraft(result.draft);
        saved.current = JSON.stringify(value);
        setReview(false);
        setApproval(false);
        setError("");
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    let active = true;
    factoryLabelService
      .editor(kind, entityKey)
      .then((result) => {
        if (!active) return;
        const value =
          kind === "product"
            ? productLabelDraft(result)
            : templateLabelDraft(result);
        setData(result);
        setPayload(value);
        setDraft(result.draft);
        saved.current = JSON.stringify(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [kind, entityKey]);
  const dirty = payload && JSON.stringify(payload) !== saved.current;
  useEffect(() => {
    if (review) {
      reviewHeading.current?.scrollIntoView?.({
        block: "start",
        behavior: "smooth",
      });
      reviewHeading.current?.focus();
    }
  }, [review]);
  useEffect(() => {
    const guard = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const template =
    kind === "product"
      ? data?.templates.find((t) => t.id === payload?.template_id)
      : null;
  const definition =
    kind === "product" ? template?.definition : payload?.definition;
  const preview = useLabelPreview(
    payload && definition
      ? labelPreviewSnapshot(
          kind === "template"
            ? {
                ...payload,
                content: {
                  product_name: "Product name",
                  product_name_cn: "中文名称",
                  product_name_bm: "Nama produk",
                  ingredients: "Ingredients from SKU",
                  manufacturer_name: "Manufacturer from SKU",
                  manufacturer_address: "Address from SKU",
                },
              }
            : payload,
          definition,
          data?.sku,
        )
      : { width_mm: 80, height_mm: 90, definition: { elements: [] } },
  );
  const update = (key, value) => {
    setPayload((p) => ({ ...p, [key]: value }));
    request.current = null;
    publication.current = null;
    setApproval(false);
    setReview(false);
  };
  const updateContent = (key, value) =>
    update("content", { ...payload.content, [key]: value });
  async function back() {
    if (
      dirty &&
      !(await onConfirm?.({
        title: "Leave Label Editor?",
        message:
          "Unsaved changes will be discarded. Save the draft to keep them.",
        confirmLabel: "Leave Editor",
        tone: "warning",
      }))
    )
      return;
    onBack();
  }
  async function save(asReview = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const hash = JSON.stringify(payload);
      if (request.current?.hash !== hash)
        request.current = { hash, id: crypto.randomUUID() };
      const result = await factoryLabelService.saveDraft(
        kind,
        entityKey,
        payload,
        draft?.revision || 0,
        data.published?.version || 0,
        request.current.id,
      );
      setDraft(result);
      saved.current = hash;
      setNotice(
        "Draft saved. Operational printing continues to use the approved version.",
      );
      if (asReview) setReview(true);
      return result;
    } catch (e) {
      setError(e.message || "Unable to save label draft.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function beginReview() {
    if (preview.error || preview.loading) return;
    if (dirty || draft?.state !== "draft") await save(true);
    else setReview(true);
  }
  async function publish() {
    if (lock.current || !approval || preview.error || preview.loading) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      publication.current ||= crypto.randomUUID();
      await factoryLabelService.publish(
        draft.id,
        draft.revision,
        publication.current,
        note,
        true,
      );
      setNotice(
        "Approved version published. Historical labels retain their original snapshot.",
      );
      await load();
      setNote("");
      publication.current = null;
    } catch (e) {
      setError(e.message || "Unable to publish label version.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const disabled = busy || !canEdit || review;
  const heading = "Label Studio";
  if (!payload)
    return (
      <div className="space-y-4">
        <PageHeader
          title={heading}
          description="Loading label configuration."
          actions={
            <button className="btn-secondary" onClick={onBack}>
              <ArrowLeft size={14} />
              Label Management
            </button>
          }
        />
        {error ? (
          <p role="alert">
            {error}{" "}
            <button className="btn-secondary" onClick={load}>
              Retry
            </button>
          </p>
        ) : (
          <p role="status">Loading…</p>
        )}
      </div>
    );
  return (
    <div className="label-studio">
      <PageHeader
        title={heading}
        wrapTitle
        metadata={
          <>
            <FactoryStatusBadge
              status={
                draft?.state === "draft" || dirty
                  ? "Draft"
                  : data.published
                    ? "Published"
                    : "Not configured"
              }
            />
            <span>Published v{data.published?.version || "—"}</span>
            <span aria-live="polite">
              {busy
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : draft?.state === "draft"
                    ? `Draft saved · revision ${draft.revision}`
                    : "No unsaved edits"}
            </span>
          </>
        }
        description={
          kind === "product"
            ? `${data.sku.product_code || ""} · ${data.sku.product_name}`
            : `Template · ${payload.name}`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={back}
            >
              <ArrowLeft size={14} />
              Label Management
            </button>
            {canEdit && !review ? (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => save()}
                >
                  <Save size={14} />
                  {busy ? "Saving…" : "Save Draft"}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || preview.loading || !!preview.error}
                  onClick={beginReview}
                >
                  Review & Publish
                </button>
              </>
            ) : null}
          </div>
        }
      />
      {error && (
        <p role="alert" className="text-sm text-text-primary">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-text-primary">
          {notice}
        </p>
      )}
      {kind === "product" ? (
        <div className="label-studio-product-grid">
          <div className="label-studio-product-content">
            <FactorySegmentedControl
              label="Product label sections"
              value={tab}
              onChange={setTab}
              options={[
                { value: "content", label: "Product Content" },
                { value: "production", label: "Production Fields" },
                { value: "history", label: "Version History" },
              ]}
            />
            {tab === "content" && (
              <ProductLabelContent
                payload={payload}
                data={data}
                template={template}
                definition={definition}
                disabled={disabled}
                dirty={dirty}
                update={update}
                updateContent={updateContent}
                onAssign={(id) => {
                  const next = data.templates.find((t) => t.id === id);
                  update("template_id", id);
                  setPayload((p) => ({
                    ...p,
                    template_id: id,
                    width_mm: next?.definition.width_mm || p.width_mm,
                    height_mm: next?.definition.height_mm || p.height_mm,
                    content: { ...p.content, text_overrides: {} },
                  }));
                }}
              />
            )}
            {tab === "production" && (
              <section className="label-studio-form-section">
                <div className="label-studio-section-heading">
                  <h2>Production fields</h2>
                  <span>
                    <LockKeyhole size={14} /> Read-only
                  </span>
                </div>
                <p className="label-studio-hint">
                  Resolved from the completed Production batch in Job Order →
                  Print Labels. No dates, batch references or quantities can be
                  entered here.
                </p>
                <dl className="label-studio-production-fields">
                  {[
                    ["MFG", "Manufacturing date"],
                    ["EXP", "Expiry date"],
                    ["Batch No.", "Production batch reference"],
                    ["Actual packaged units", "Confirmed packaged quantity"],
                  ].map(([name, description]) => (
                    <div key={name}>
                      <dt>
                        <strong>{name}</strong>
                        <span>{description}</span>
                      </dt>
                      <dd>
                        <LockKeyhole size={13} /> From Production
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="label-studio-hint">
                  Recorded Production expiry takes priority over approved
                  fallback rules. Printing uses confirmed units, never estimated
                  output.
                </p>
              </section>
            )}
            {tab === "history" && versionHistory(data)}
          </div>
          <div className="label-studio-product-preview">
            <LabelStudioCanvas
              width={Number(payload.width_mm)}
              height={Number(payload.height_mm)}
              image={preview.image}
              loading={preview.loading}
              error={preview.error}
              issues={preview.issues}
              elements={
                definition ? editableLabelDefinition(definition).elements : []
              }
              title="Live label preview"
            />
            <p className="label-studio-hint">
              <LockKeyhole size={13} /> MFG, EXP, batch and quantities come from
              Production at print time.
            </p>
          </div>
        </div>
      ) : (
        <>
          <LabelLayoutEditor
            definition={payload.definition}
            width={Number(payload.width_mm)}
            height={Number(payload.height_mm)}
            image={preview.image}
            error={preview.error}
            issues={preview.issues}
            loading={preview.loading}
            onChange={(value) => update("definition", value)}
            disabled={disabled}
            configuration={
              <details className="label-studio-template-settings">
                <summary>
                  Template settings{" "}
                  <span>
                    {payload.width_mm} × {payload.height_mm} mm
                  </span>
                </summary>
                <Field label="Template name">
                  <input
                    aria-label="Template name"
                    className={inputClass()}
                    disabled={disabled}
                    value={payload.name}
                    onChange={(e) => update("name", e.target.value)}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["width_mm", "Label width (mm)"],
                    ["height_mm", "Label height (mm)"],
                  ].map(([key, label]) => (
                    <Field key={key} label={label}>
                      <input
                        aria-label={label}
                        type="number"
                        min="20"
                        step="0.1"
                        className={inputClass()}
                        disabled={disabled}
                        value={payload[key]}
                        onChange={(e) => update(key, Number(e.target.value))}
                      />
                    </Field>
                  ))}
                </div>
                <p className="label-studio-hint">
                  Editing the next version. Published layouts and product
                  assignments stay pinned.
                </p>
              </details>
            }
          />
          <details className="label-studio-history">
            <summary>
              <History size={14} /> Version History{" "}
              <span>{data.history.length} versions</span>
            </summary>
            {versionHistory(data)}
          </details>
        </>
      )}
      {review && (
        <div className="space-y-4 rounded-xl border border-border p-5">
          <h2 ref={reviewHeading} tabIndex={-1} className="font-semibold">
            Approve and publish version {(data.published?.version || 0) + 1}
          </h2>
          <p className="text-sm text-text-secondary">
            Review the complete preview and all text. Historical snapshots and
            approved versions stay unchanged.{" "}
            {kind === "product"
              ? "New, unsnapshotted batches use this version after publication."
              : "Products continue using their assigned approved template version."}
          </p>
          <Field label="Approval / publication reason">
            <textarea
              aria-label="Approval / publication reason"
              className={inputClass()}
              value={note}
              disabled={busy}
              onChange={(e) => {
                setNote(e.target.value);
                publication.current = null;
              }}
              maxLength={1000}
            />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={approval}
              disabled={busy}
              onChange={(e) => setApproval(e.target.checked)}
            />
            I reviewed the preview and approve the label content, layout and
            applicable regulatory wording. Production-owned fields remain
            dynamic.
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setReview(false);
                setApproval(false);
              }}
            >
              Continue Editing
            </button>
            <button
              className="btn-primary"
              disabled={
                busy ||
                !approval ||
                note.trim().length < 3 ||
                !!preview.error ||
                preview.loading
              }
              onClick={publish}
            >
              <CheckCircle2 size={14} />
              {busy ? "Publishing…" : "Approve & Publish"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function versionHistory(data) {
  return (
    <section className="label-studio-form-section">
      <div className="label-studio-section-heading">
        <h2>Published versions</h2>
        <span>Latest 20 · immutable</span>
      </div>
      <p className="label-studio-hint">
        Historical batches keep their approved content, template version and
        saved print pixels.
      </p>
      {data.history.map((h) => (
        <div key={h.id} className="label-studio-history-row">
          <strong>Version {h.version}</strong>
          <span>{formatFactoryDate(h.created_at)}</span>
          {h.approval_note && <p>{h.approval_note}</p>}
        </div>
      ))}
      {!data.history.length && (
        <p className="label-studio-hint">No published versions yet.</p>
      )}
    </section>
  );
}
