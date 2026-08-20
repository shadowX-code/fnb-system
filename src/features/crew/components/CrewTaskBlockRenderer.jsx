import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileText,
  HeartPulse,
  Lightbulb,
  Thermometer,
  X,
} from "lucide-react";
import "./CrewTaskBlockRenderer.css";

export const TASK_BLOCK_TYPES = [
  "text",
  "checklist_item",
  "key_point",
  "image",
  "sop_reference",
  "yes_no",
  "single_choice",
  "number",
  "temperature",
  "short_text",
  "health_rating",
  "confirmation",
];

export const INFORMATIONAL_TASK_BLOCK_TYPES = new Set(["text", "key_point", "image", "sop_reference"]);

const exceptionReasons = ["equipment_issue", "stock_unavailable", "area_unavailable", "manager_instruction", "other"];

export function normalizeTaskBlock(block = {}) {
  const required = block.required ?? block.is_required ?? true;
  return {
    ...block,
    block_type: block.block_type || "text",
    config: block.config || {},
    required,
    is_required: required,
    status: block.status || "pending",
    response: block.response || {},
  };
}

export function isTaskBlockActionable(block) {
  return !INFORMATIONAL_TASK_BLOCK_TYPES.has(normalizeTaskBlock(block).block_type);
}

export function isTaskBlockResponded(block) {
  return !["pending", "not_started", "in_progress"].includes(normalizeTaskBlock(block).status);
}

export function isTaskBlockComplete(block) {
  return isTaskBlockResponded(block) && normalizeTaskBlock(block).status !== "not_checked";
}

export default function CrewTaskBlockRenderer({
  block: sourceBlock,
  index = 0,
  mode = "interactive",
  allowException = false,
  saving = false,
  onSubmit,
  onPreviewChange,
  onOpenSop,
  compact = false,
}) {
  const { t } = useTranslation();
  const block = useMemo(() => normalizeTaskBlock(sourceBlock), [sourceBlock]);
  const [response, setResponse] = useState(block.response);
  const [previewStatus, setPreviewStatus] = useState(block.status);
  const [expanded, setExpanded] = useState(false);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [note, setNote] = useState(block.note || "");
  const preview = mode === "preview";
  const readonly = mode === "readonly";
  const actionable = isTaskBlockActionable(block);
  const status = preview ? previewStatus : block.status;
  const responded = !["pending", "not_started", "in_progress"].includes(status);
  const title = String(block.title || "").trim();
  const warning = ["exception", "needs_attention"].includes(status);
  const result = blockResult({ ...block, status, response }, t);

  useEffect(() => {
    setResponse(block.response);
    setPreviewStatus(block.status);
    setExpanded(false);
    setExceptionOpen(false);
    setExceptionReason("");
    setNote(block.note || "");
  }, [block.id, block.block_type, JSON.stringify(block.config), block.status]);

  async function submit(action, nextResponse = response, reason = null, nextNote = note) {
    if (preview) {
      setResponse(nextResponse);
      setPreviewStatus(action === "exception" ? "exception" : action);
      setExpanded(false);
      setExceptionOpen(false);
      onPreviewChange?.({ block, action, response: nextResponse, reason, note: nextNote || null });
      return true;
    }
    if (readonly || saving) return false;
    try {
      await onSubmit?.({ block, action, response: nextResponse, reason, note: nextNote || null });
      setExpanded(false);
      setExceptionOpen(false);
      return true;
    } catch {
      return false;
    }
  }

  if (!title) {
    return <section className="crew-task-block is-incomplete" data-block-type={block.block_type} data-preview-mode={preview ? "true" : undefined}>
      <BlockNumber index={index} status="pending" />
      <div className="crew-task-block-main"><strong>{t("tasks.addTitle")}</strong><small>{taskTypeLabel(block.block_type, t)}</small></div>
    </section>;
  }

  const summaryStatus = actionable ? result : expanded ? t("tasks.hide") : t("tasks.view");
  const canOpen = !readonly && (!actionable || !responded);

  return <section className={`crew-task-block is-${block.block_type} is-${status}${expanded ? " is-expanded" : ""}${compact ? " is-compact" : ""}`} data-block-type={block.block_type} data-preview-mode={preview ? "true" : undefined}>
    <button type="button" className="crew-task-block-summary" aria-expanded={expanded} disabled={!canOpen} onClick={() => setExpanded((value) => !value)}>
      <BlockNumber index={index} status={status} />
      <span className="crew-task-block-copy">
        <span><strong>{title}</strong>{block.required === false ? <em>{t("common.optional")}</em> : null}</span>
        <small>{collapsedDescription(block, t)}</small>
      </span>
      <span className={`crew-task-block-result${warning ? " is-warning" : ""}${responded ? " is-saved" : ""}`}>{summaryStatus}</span>
      {canOpen ? <ChevronRight className="crew-task-block-chevron" size={17} aria-hidden="true" /> : <CheckCircle2 className="crew-task-block-saved-icon" size={17} aria-hidden="true" />}
    </button>

    {expanded ? <div className="crew-task-block-panel">
      {block.description && !["key_point", "text"].includes(block.block_type) ? <p>{block.description}</p> : null}
      <BlockControl block={block} response={response} setResponse={setResponse} mode={mode} saving={saving} submit={submit} onOpenSop={onOpenSop} />
      {actionable && allowException && !responded ? <button type="button" className="crew-task-report-link" onClick={() => setExceptionOpen(true)} disabled={readonly || saving}><AlertTriangle size={15} /> {t("tasks.reportIssue")}</button> : null}
      {block.evidence_requirement && block.evidence_requirement !== "none" ? <small className="crew-task-evidence">{t("tasks.evidence", { type: String(block.evidence_requirement).replaceAll("_", " ") })}</small> : null}
    </div> : null}

    {exceptionOpen && typeof document !== "undefined" ? createPortal(<ExceptionSheet
      title={title}
      reason={exceptionReason}
      setReason={setExceptionReason}
      note={note}
      setNote={setNote}
      saving={saving}
      readonly={readonly}
      onClose={() => setExceptionOpen(false)}
      onSubmit={() => submit("exception", response, exceptionReason, note)}
    />, document.body) : null}
  </section>;
}

function BlockNumber({ index, status }) {
  const responded = !["pending", "not_started", "in_progress"].includes(status);
  return <span className={`crew-task-block-number is-${status}`} aria-hidden="true">{responded ? status === "exception" || status === "needs_attention" ? <AlertTriangle size={16} /> : <Check size={17} /> : String(index + 1).padStart(2, "0")}</span>;
}

function taskTypeLabel(type, t) { return t(`tasks.types.${type}`, { defaultValue: t("tasks.task") }); }

function collapsedDescription(block, t) {
  if (block.block_type === "sop_reference") return block.sop_reference?.title || block.sop_title || taskTypeLabel("sop_reference", t);
  if (["key_point", "text"].includes(block.block_type) && block.description) return block.description;
  return taskTypeLabel(block.block_type, t);
}

function blockResult(block, t) {
  const status = block.status || "pending";
  if (["pending", "not_started", "in_progress"].includes(status)) return t("tasks.pending");
  if (status === "exception") return t("tasks.issueReported");
  if (block.block_type === "checklist_item") return t("tasks.done");
  if (block.block_type === "confirmation") return t("tasks.confirmed");
  if (block.block_type === "health_rating") return t(`status.${status}`, { defaultValue: t("common.save") });
  const value = block.response?.value;
  if (value !== undefined && String(value).trim()) {
    const unit = block.config?.unit || (block.block_type === "temperature" ? "°C" : "");
    return `${String(value).replaceAll("_", " ")}${unit ? ` ${unit}` : ""}`;
  }
  return t(`status.${status}`, { defaultValue: t("common.save") });
}

function BlockControl({ block, response, setResponse, mode, saving, submit, onOpenSop }) {
  const { t } = useTranslation();
  const disabled = mode === "readonly" || saving;
  const type = block.block_type;
  const value = response.value ?? "";
  if (type === "text") return <div className="crew-task-instruction">{block.description || t("tasks.addInstruction")}</div>;
  if (type === "key_point") return <div className="crew-task-key-point"><Lightbulb size={17} /><span>{block.description || t("tasks.addKeyPoint")}</span></div>;
  if (type === "image") return <div className="crew-task-unavailable"><FileText size={17} /><span>{block.media?.caption || block.config?.caption || t("tasks.imageUnavailable")}</span></div>;
  if (type === "sop_reference") {
    const sop = block.sop_reference;
    if (!sop && !block.sop_version_id) return <div className="crew-task-unavailable"><AlertTriangle size={16} /><span>{t("tasks.choosePublishedSop")}</span></div>;
    return <button type="button" aria-label={mode === "preview" ? `${t("tasks.openSop")} ${t("tasks.preview").toLowerCase()}` : t("tasks.openSop")} className="crew-task-sop-card" onClick={() => onOpenSop?.(sop || { sop_version_id: block.sop_version_id })} disabled={!onOpenSop && mode !== "preview"}>
      <FileText size={18} /><span><strong>{sop?.title || block.sop_title || t("tasks.publishedSop")}</strong><small>{sop?.version ? `v${sop.version}` : block.sop_version ? `v${block.sop_version}` : ""}</small></span><em>{mode === "preview" ? t("tasks.openPreview") : t("tasks.openSop")}</em>
    </button>;
  }
  if (type === "checklist_item") return <button type="button" aria-label={t("tasks.completeBlock", { title: block.title })} className="crew-task-focused-action" disabled={disabled} onClick={() => submit("completed", { value: true })}><ClipboardCheck size={18} /> {t("tasks.markDone")}</button>;
  if (type === "confirmation") return <button type="button" aria-label={`${t("tasks.confirmAction")} ${block.title}`} className="crew-task-focused-action" disabled={disabled} onClick={() => submit("completed", { value: true })}><CheckCircle2 size={18} /> {t("tasks.confirmAction")}</button>;
  if (type === "yes_no") return <div className="crew-task-input-wrap"><div className="crew-task-choice-grid is-two">{[["yes", t("tasks.yes")], ["no", t("tasks.no")]].map(([choice, label]) => <button key={choice} type="button" aria-pressed={value === choice} disabled={disabled} onClick={() => setResponse({ value: choice })}>{label}</button>)}</div><button type="button" className="crew-task-submit" disabled={disabled || !value} onClick={() => submit("completed")}>{saving ? t("common.saving") : t("tasks.saveAnswer")}</button></div>;
  if (type === "single_choice") {
    const options = block.config?.options || [];
    if (!options.length) return <div className="crew-task-unavailable"><AlertTriangle size={16} /><span>{t("tasks.addOption")}</span></div>;
    return <div className="crew-task-input-wrap"><div className="crew-task-choice-list" role="radiogroup">{options.map((option) => <button key={option} type="button" role="radio" aria-checked={value === option} disabled={disabled} onClick={() => setResponse({ value: option })}><i />{option}</button>)}</div><button type="button" className="crew-task-submit" disabled={disabled || !value} onClick={() => submit("completed")}>{saving ? t("common.saving") : t("tasks.saveChoice")}</button></div>;
  }
  if (["number", "temperature"].includes(type)) {
    const unit = block.config?.unit || (type === "temperature" ? "°C" : "");
    return <div className="crew-task-input-wrap"><label><span>{type === "temperature" ? <Thermometer size={15} /> : "#"}</span><input aria-label={taskTypeLabel(type, t)} type="number" min={block.config?.min ?? undefined} max={block.config?.max ?? undefined} value={value} disabled={disabled} onChange={(event) => setResponse({ value: event.target.value })} /><em>{unit}</em></label><RangeHint config={block.config} unit={unit} /><button type="button" className="crew-task-submit" disabled={disabled || String(value).trim() === ""} onClick={() => submit("completed")}>{saving ? t("common.saving") : t("tasks.saveValue")}</button></div>;
  }
  if (type === "short_text") return <div className="crew-task-input-wrap"><textarea aria-label={taskTypeLabel(type, t)} value={value} disabled={disabled} onChange={(event) => setResponse({ value: event.target.value })} /><button type="button" className="crew-task-submit" disabled={disabled || !String(value).trim()} onClick={() => submit("completed")}>{saving ? t("common.saving") : t("tasks.saveResponse")}</button></div>;
  if (type === "health_rating") return <div className="crew-task-health"><div className="crew-task-choice-grid is-health">{[["good", t("tasks.good")], ["needs_attention", t("tasks.needsAttention")], ["not_checked", t("tasks.notChecked")]].map(([choice, choiceLabel]) => <button key={choice} type="button" aria-pressed={value === choice} disabled={disabled} onClick={() => setResponse({ value: choice })}>{choice === "good" ? <Check size={15} /> : choice === "needs_attention" ? <AlertTriangle size={15} /> : <HeartPulse size={15} />}{choiceLabel}</button>)}</div>{value === "needs_attention" ? <textarea aria-label={t("tasks.needsAttention")} value={response.note || ""} disabled={disabled} onChange={(event) => setResponse({ ...response, note: event.target.value })} /> : null}<button type="button" className="crew-task-submit" disabled={disabled || !value || (value === "needs_attention" && !String(response.note || "").trim())} onClick={() => submit(value, response, value === "needs_attention" ? "needs_attention" : null, response.note)}>{saving ? t("common.saving") : t("tasks.saveRating")}</button></div>;
  return null;
}

function ExceptionSheet({ title, reason, setReason, note, setNote, saving, readonly, onClose, onSubmit }) {
  const { t } = useTranslation();
  return <div className="crew-task-exception-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="crew-task-exception-sheet" role="dialog" aria-modal="true" aria-label={t("tasks.reportIssueFor", { title })}>
      <header><div><strong>{t("tasks.reportIssue")}</strong><span>{title}</span></div><button type="button" aria-label={t("common.close")} onClick={onClose}><X size={19} /></button></header>
      <div className="crew-task-exception-body">
        <label>{t("attendance.reason")}<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="">{t("tasks.chooseReason")}</option>{exceptionReasons.map((reasonValue) => <option key={reasonValue} value={reasonValue}>{t(`tasks.reasons.${reasonValue}`)}</option>)}</select></label>
        <label>{t("tasks.note")}<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("tasks.explainIssue")} /></label>
        <small>{t("tasks.evidenceUnavailable")}</small>
      </div>
      <footer><button type="button" className="crew-task-sheet-cancel" onClick={onClose}>{t("common.cancel")}</button><button type="button" className="crew-task-sheet-submit" disabled={!reason || saving || readonly} onClick={onSubmit}>{saving ? t("common.saving") : t("tasks.submitException")}</button></footer>
    </section>
  </div>;
}

function RangeHint({ config, unit }) {
  const { t } = useTranslation();
  if (config?.min === undefined && config?.max === undefined) return null;
  return <small className="crew-task-range">{t("tasks.expectedRange", { min: config?.min ?? t("tasks.any"), max: config?.max ?? t("tasks.any"), unit })}</small>;
}
