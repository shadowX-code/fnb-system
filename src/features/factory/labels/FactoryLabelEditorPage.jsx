import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Save, CheckCircle2 } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { factoryLabelService } from "../../../services/factoryLabelService.js";
import {
  labelContentFields,
  labelPreviewSnapshot,
  productLabelDraft,
  templateLabelDraft,
  productionLabelFields,
} from "./labelManagementModel.js";
import LabelLayoutEditor from "./LabelLayoutEditor.jsx";
import useLabelPreview from "./useLabelPreview.js";
import { openLabelManagement } from "./labelManagementNavigation.js";
import { formatFactoryDate } from "../utils/factoryDates.js";
import { legacyLabelContentField } from "./labelRenderer.js";
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
    [notice, setNotice] = useState("");
  const saved = useRef(""),
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
      ? labelPreviewSnapshot(payload, definition, data?.sku)
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
  const heading =
    kind === "product" ? "Product Label Editor" : "Template Editor";
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
    <div className="space-y-5">
      <PageHeader
        title={heading}
        description={
          kind === "product"
            ? `${data.sku.product_code || ""} · ${data.sku.product_name}`
            : payload.name
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
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <strong>
          {draft?.state === "draft" || dirty
            ? "Draft"
            : data.published
              ? "Approved"
              : "Not configured"}
        </strong>
        <span className="text-text-secondary">
          Approved version: {data.published?.version || "None"}
          {draft?.revision ? ` · Draft revision ${draft.revision}` : ""}
          {dirty ? " · Unsaved changes" : ""}
        </span>
      </div>
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
        <div className="label-editor-grid">
          <div className="space-y-5">
            <div className="space-y-3">
              <h2 className="font-semibold text-text-primary">
                SKU label content
              </h2>
              <p className="text-sm text-text-secondary">
                These approved label values apply only to this Packaging SKU.
                The product master remains the source of its identity.
              </p>
              <Field label="Approved template version">
                <SearchableSelect
                  value={payload.template_id}
                  disabled={disabled}
                  options={data.templates.map((t) => ({
                    value: t.id,
                    label: `${t.name} · v${t.version}`,
                  }))}
                  onChange={(id) => {
                    const next = data.templates.find((t) => t.id === id);
                    setPayload((p) => ({
                      ...p,
                      template_id: id,
                      width_mm: next?.definition.width_mm || p.width_mm,
                      height_mm: next?.definition.height_mm || p.height_mm,
                      content: { ...p.content, text_overrides: {} },
                    }));
                    setApproval(false);
                    request.current = null;
                  }}
                />
              </Field>
              <p className="text-sm text-text-secondary">
                Template assignments are pinned. Publishing a shared template
                does not upgrade this product automatically.
              </p>
              {template && (
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={busy || dirty}
                  onClick={() =>
                    openLabelManagement({
                      section: "templates",
                      template: template.template_key,
                    })
                  }
                >
                  Open Shared Template
                </button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {labelContentFields.map(([key, label]) => (
                <Field key={key} label={label}>
                  <textarea
                    aria-label={label}
                    className={inputClass()}
                    disabled={disabled}
                    required={key === "product_name"}
                    value={payload.content?.[key] || ""}
                    onChange={(e) => updateContent(key, e.target.value)}
                    maxLength={3900}
                  />
                </Field>
              ))}
              <Field label="Net weight">
                <input
                  aria-label="Net weight"
                  className={inputClass()}
                  disabled={disabled}
                  value={payload.net_weight}
                  onChange={(e) => update("net_weight", e.target.value)}
                />
              </Field>
              <Field label="Storage instructions">
                <textarea
                  aria-label="Storage instructions"
                  className={inputClass()}
                  disabled={disabled}
                  value={payload.storage_instructions}
                  onChange={(e) =>
                    update("storage_instructions", e.target.value)
                  }
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["width_mm", "Width (mm)"],
                ["height_mm", "Height (mm)"],
                ["shelf_life_days", "Approved shelf life (days)"],
              ].map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    aria-label={label}
                    type="number"
                    min="1"
                    step={key === "shelf_life_days" ? "1" : "0.1"}
                    className={inputClass()}
                    disabled={disabled}
                    value={payload[key] ?? ""}
                    onChange={(e) =>
                      update(
                        key,
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </Field>
              ))}
              <Field label="When recorded expiry is missing">
                <SearchableSelect
                  value={payload.expiry_rule}
                  disabled={disabled}
                  options={[
                    {
                      value: "production",
                      label: "Require confirmed Production expiry",
                    },
                    {
                      value: "days_after",
                      label: "Manufacturing date + shelf life",
                    },
                    {
                      value: "inclusive_days",
                      label: "Manufacturing date + shelf life − 1 day",
                    },
                  ]}
                  onChange={(value) => update("expiry_rule", value)}
                />
              </Field>
            </div>
            {definition?.elements.some(
              (e) => e.type === "text" && !e.field,
            ) && (
              <details className="space-y-3" open>
                <summary className="cursor-pointer font-semibold">
                  Additional static text — this SKU only
                </summary>
                <p className="text-sm text-text-secondary">
                  Overrides are tied to this exact template version. Assigning
                  another template resets them.
                </p>
                {definition.elements.map((e, i) =>
                  e.type === "text" &&
                  !e.field &&
                  !legacyLabelContentField(definition.elements, i) ? (
                    <Field
                      key={i}
                      label={`Text ${i + 1}: ${(e.text || "").slice(0, 55)}`}
                    >
                      <textarea
                        aria-label={`SKU static text ${i + 1}`}
                        className={inputClass()}
                        disabled={disabled}
                        value={
                          payload.content?.text_overrides?.[i] ?? e.text ?? ""
                        }
                        onChange={(event) =>
                          updateContent("text_overrides", {
                            ...payload.content?.text_overrides,
                            [i]: event.target.value,
                          })
                        }
                      />
                    </Field>
                  ) : null,
                )}
              </details>
            )}
          </div>
          <div className="label-preview-panel space-y-4">
            <h2 className="font-semibold">Live label preview</h2>
            {preview.image && (
              <img
                className="mx-auto h-auto w-full max-w-80 border border-border bg-white"
                src={preview.image}
                alt="Product label live preview"
              />
            )}
            {preview.loading && <p role="status">Rendering preview…</p>}
            {preview.error && <p role="alert">{preview.error}</p>}
            <p className="text-sm text-text-secondary">
              {payload.width_mm} × {payload.height_mm} mm · 203 DPI. MFG, EXP,
              Batch No. and actual packaged units are read-only Production
              fields. Preview placeholders are replaced only by the operational
              print workflow.
            </p>
            <div className="space-y-1 text-sm">
              {productionLabelFields.map((field) => (
                <div key={field} className="flex justify-between gap-2">
                  <span>
                    {
                      {
                        manufacturing_date: "MFG",
                        expiry_date: "EXP",
                        batch_no: "Batch No.",
                        packaged_units: "Actual packaged units",
                      }[field]
                    }
                  </span>
                  <strong>From Production</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Template name">
              <input
                aria-label="Template name"
                className={inputClass()}
                disabled={disabled}
                value={payload.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </Field>
            {[
              ["width_mm", "Width (mm)"],
              ["height_mm", "Height (mm)"],
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
          <p className="text-sm text-text-secondary">
            Shared layouts define positions, typography, borders and images.
            Bind product text to SKU content fields; Production fields accept no
            entered values. Publishing creates a new template version and
            preserves existing product assignments.
          </p>
          <LabelLayoutEditor
            definition={payload.definition}
            width={Number(payload.width_mm)}
            height={Number(payload.height_mm)}
            image={preview.image}
            error={preview.error}
            onChange={(value) => update("definition", value)}
            disabled={disabled}
          />
        </div>
      )}
      {review && (
        <div className="space-y-4 rounded-xl border border-border p-5">
          <h2 className="font-semibold">
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
      <details className="border-t border-border pt-4">
        <summary className="cursor-pointer font-semibold">
          Approved version history
        </summary>
        <p className="mt-2 text-sm text-text-secondary">
          Latest 20 immutable versions
        </p>
        {data.history.map((h) => (
          <div key={h.id} className="border-b border-border py-3 text-sm">
            <strong>Version {h.version}</strong> ·{" "}
            {formatFactoryDate(h.created_at)}
            {h.approval_note ? <p>{h.approval_note}</p> : null}
          </div>
        ))}
        {!data.history.length && (
          <p className="py-3 text-sm text-text-secondary">
            No approved versions yet.
          </p>
        )}
      </details>
    </div>
  );
}
