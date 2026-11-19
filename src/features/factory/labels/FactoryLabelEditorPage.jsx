import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Save, CheckCircle2, History } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import { factoryLabelService } from "../../../services/factoryLabelService.js";
import {
  labelPreviewSnapshot,
  productLabelDraft,
  templateLabelDraft,
  editableLabelDefinition,
  labelTemplateDimensions,
  selectableLabelTemplates,
  templatePreviewSnapshot,
} from "./labelManagementModel.js";
import LabelLayoutEditor from "./LabelLayoutEditor.jsx";
import useLabelPreview from "./useLabelPreview.js";
import { openLabelManagement } from "./labelManagementNavigation.js";
import { formatFactoryDate } from "../utils/factoryDates.js";
import ProductLabelContent from "./ProductLabelContent.jsx";
import LabelStudioCanvas from "./LabelStudioCanvas.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import "./labelManagement.css";

export default function FactoryLabelEditorPage({
  kind,
  entityKey,
  labelKey = "product",
  canEdit,
  onBack,
  onConfirm,
  onNotify,
}) {
  const [data, setData] = useState(null),
    [payload, setPayload] = useState(null),
    [draft, setDraft] = useState(null),
    [error, setError] = useState(""),
    [action, setAction] = useState(""),
    [historyOpen, setHistoryOpen] = useState(false),
    [needsRefresh, setNeedsRefresh] = useState(false);
  const saved = useRef(""),
    lock = useRef(false),
    request = useRef(null),
    publication = useRef(null);
  const busy = Boolean(action);

  function applyEditor(result) {
    const value = kind === "product" ? productLabelDraft(result, labelKey) : templateLabelDraft(result);
    const pinned = kind === "product" && result.templates.find((t) => t.id === value.template_id);
    const working = pinned ? { ...value, ...labelTemplateDimensions(pinned) } : value;
    const savedDraft = result.draft?.state === "draft";
    setPayload(working);
    setData(result);
    setDraft(result.draft);
    saved.current = JSON.stringify(savedDraft ? value : working);
    setNeedsRefresh(false);
    setError("");
  }

  async function load() {
    applyEditor(await factoryLabelService.editor(kind, entityKey));
  }

  useEffect(() => {
    let active = true;
    factoryLabelService.editor(kind, entityKey)
      .then((result) => { if (active) applyEditor(result); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
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
      ? kind === "template"
        ? templatePreviewSnapshot(payload, definition)
        : labelPreviewSnapshot(payload, definition, data?.sku)
      : { width_mm: 80, height_mm: 90, definition: { elements: [] } },
  );
  const update = (key, value) => {
    setPayload((p) => ({ ...p, [key]: value }));
    request.current = null;
    publication.current = null;
  };
  const updateContent = (key, value) =>
    update("content", { ...payload.content, [key]: value });
  async function leave(navigate) {
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
    navigate();
  }
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setAction("Saving…");
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
      onNotify?.({ title: "Draft saved", message: `Revision ${result.revision} is ready to review.` });
      return result;
    } catch (e) {
      showError("Unable to save draft", e);
    } finally {
      lock.current = false;
      setAction("");
    }
  }
  function showError(title, e) {
    const message = e.message || title;
    setError(message);
    onNotify?.({ title, message, tone: "error" });
  }

  const canActivate = canEdit && !busy && !dirty && !needsRefresh && draft?.state === "draft" &&
    Boolean(definition) && !preview.error && !preview.loading;
  async function activate() {
    if (lock.current || !canActivate || !onConfirm) return;
    lock.current = true;
    setAction("Awaiting confirmation");
    setError("");
    try {
      const confirmed = await onConfirm({
        title: "Activate saved version?",
        message: kind === "product"
          ? "Confirm you reviewed the saved preview, label content, and applicable regulatory wording. New batches without a saved label snapshot will use this version."
          : "Confirm you reviewed the saved layout and preview. Existing SKU assignments stay pinned to their selected template versions.",
        confirmLabel: "Activate Version",
      });
      if (!confirmed) return;
      publication.current ||= crypto.randomUUID();
      setAction("Activating…");
      const publishedDraft = await factoryLabelService.publish(
        draft.id,
        draft.revision,
        publication.current,
        "Saved version reviewed and activated in Label Studio.",
        true,
      );
      const version = publishedDraft.base_version + 1;
      setDraft(publishedDraft);
      setData((current) => ({
        ...current,
        published: { id: publishedDraft.published_id, version, template_id: payload.template_id },
      }));
      publication.current = null;
      onNotify?.({ title: `Version ${version} activated`, message: kind === "template"
        ? "Existing SKU assignments stay pinned."
        : "Historical batches retain their saved labels." });
      try {
        await load();
      } catch (e) {
        setNeedsRefresh(true);
        showError("Version activated · refresh needed", e);
      }
    } catch (e) {
      showError("Unable to activate version", e);
    } finally {
      lock.current = false;
      setAction("");
    }
  }
  const disabled = busy || needsRefresh || !canEdit;
  const labelName = payload?.label_name ?? "Product Label";
  const heading = kind === "template" ? "Template Designer" : "Product Label Editor";
  const backButton = (
    <button
      type="button"
      className="btn-ghost inline-flex items-center gap-2 justify-self-start rounded-control pr-2 type-body-sm font-medium text-text-secondary transition enabled:hover:bg-[var(--theme-hover)] enabled:hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Back to Label Management"
      disabled={busy}
      onClick={() => leave(onBack)}
    >
      <span className="icon-btn size-9 shrink-0 pointer-events-none" aria-hidden="true">
        <ArrowLeft size={16} />
      </span>
      <span>Label Management</span>
    </button>
  );
  if (!payload)
    return (
      <div className="space-y-4">
        <div className="label-studio-header">
          {backButton}
          <PageHeader title={heading} description="Loading label configuration." />
        </div>
        {error ? (
          <p role="alert">
            {error}{" "}
            <button className="btn-secondary" onClick={() => load().catch((e) => setError(e.message))}>
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
      <div className="label-studio-header">
        {backButton}
        <PageHeader
          title={heading}
          wrapTitle
          metadata={
            <>
              <FactoryStatusBadge
                status={data.published ? (kind === "template" ? "Active" : "Ready") : draft?.state === "draft" || dirty ? "Draft" : "Not Configured"}
              />
              <span>Active version {data.published?.version ? `v${data.published.version}` : "—"}</span>
              {data.published && draft?.state === "draft" && <FactoryStatusBadge status="Draft" />}
              <span role="status">
                {action
                  ? action
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
              ? `${data.sku.product_code || ""} · ${data.sku.product_name} · ${labelName || "New label"}`
              : <span className="label-studio-template-name">{payload.name || "Untitled template"}</span>
          }
          secondaryActions={
            <button type="button" className="btn-secondary label-studio-history-button" disabled={busy || needsRefresh} onClick={() => setHistoryOpen(true)}>
              <History size={14} aria-hidden="true" /> Version History
            </button>
          }
          primaryActions={
            canEdit ? (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={disabled || (!dirty && Boolean(draft || data.published)) || (kind === "product" && !labelName.trim())}
                  onClick={save}
                >
                  <Save size={14} />
                  {action === "Saving…" ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canActivate}
                  onClick={activate}
                >
                  <CheckCircle2 size={14} /> {action === "Activating…" ? "Activating…" : "Activate Version"}
                </button>
              </>
            ) : null
          }
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-text-primary">
          {error}
        </p>
      )}
      {needsRefresh && (
        <button type="button" className="btn-secondary justify-self-start"
          onClick={() => load().catch((e) => showError("Unable to refresh label version", e))}>
          Refresh version
        </button>
      )}
      {kind === "product" ? (
        <div className="label-studio-product-grid">
          <ProductLabelContent
            payload={payload}
            baseline={draft?.state === "draft" ? draft.payload : productLabelDraft(data, labelKey)}
            templates={selectableLabelTemplates(data)}
            template={template}
            activeTemplate={data.templates.find((t) => t.id === data.published?.template_id)}
            definition={definition}
            disabled={disabled}
            update={update}
            updateContent={updateContent}
            onAssign={(id) => {
              if (id === payload.template_id) return;
              const next = data.templates.find((t) => t.id === id);
              request.current = null;
              publication.current = null;
              setPayload((p) => ({
                ...p,
                template_id: id,
                ...labelTemplateDimensions(next),
                content: { ...p.content, text_overrides: {} },
              }));
            }}
            onOpenTemplate={() => leave(() => openLabelManagement({
              section: "templates",
              template: template.template_key,
            }))}
          />
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
          </div>
        </div>
      ) : (
        <LabelLayoutEditor
          key={data.published?.id || entityKey}
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
            <section className="label-studio-template-settings" aria-labelledby="label-template-settings">
              <h2 id="label-template-settings">Template Settings</h2>
              <Field label="Template name">
                <input
                  aria-label="Template name"
                  className={inputClass()}
                  disabled={disabled}
                  value={payload.name}
                  maxLength={120}
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
            </section>
          }
        />
      )}
      {historyOpen && (
        <Modal title="Version History" onClose={() => setHistoryOpen(false)}>
          {versionHistory(data)}
        </Modal>
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
