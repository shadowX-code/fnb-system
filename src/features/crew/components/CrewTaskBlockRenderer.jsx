import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
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
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [pendingIssueAction, setPendingIssueAction] = useState(null);
  const [readMore, setReadMore] = useState(false);
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
    setExceptionOpen(false);
    setPendingIssueAction(null);
    setReadMore(false);
    setExceptionReason("");
    setNote(block.note || "");
  }, [block.id, block.block_type, JSON.stringify(block.config), block.status]);

  async function submit(action, nextResponse = response, reason = null, nextNote = note) {
    if (preview) {
      setResponse(nextResponse);
      setPreviewStatus(action === "exception" ? "exception" : action);
      setExceptionOpen(false);
      onPreviewChange?.({ block, action, response: nextResponse, reason, note: nextNote || null });
      return true;
    }
    if (readonly || saving) return false;
    try {
      const saved = await onSubmit?.({ block, action, response: nextResponse, reason, note: nextNote || null });
      setExceptionOpen(false);
      return saved || true;
    } catch {
      return false;
    }
  }

  if (!title) {
    return <section className="crew-ui-functional-surface crew-task-block is-incomplete" data-block-type={block.block_type} data-preview-mode={preview ? "true" : undefined}>
      <BlockNumber index={index} status="pending" />
      <div className="crew-task-block-main"><strong>{t("tasks.addTitle")}</strong><small>{taskTypeLabel(block.block_type, t)}</small></div>
    </section>;
  }

  const requiredCompletionNote = actionable && block.evidence_requirement === "note";
  const supportsCompletionNote = actionable && ["note", "optional_note"].includes(block.evidence_requirement);
  const canReportIssue = actionable && allowException && !readonly && Boolean(pendingIssueAction);
  const issueAction = pendingIssueAction || (status === "needs_attention" ? "needs_attention" : "exception");
  const summaryStatus = actionable ? result : taskTypeLabel(block.block_type, t);

  return <section className={`crew-task-block is-${block.block_type} is-${status}${compact ? " is-compact" : ""}`} data-block-type={block.block_type} data-preview-mode={preview ? "true" : undefined}>
    <div className="crew-task-block-summary">
      <BlockNumber index={index} status={status} />
      <div className="crew-task-block-copy">
        <span><strong>{title}</strong>{block.required === false ? <em>{t("common.optional")}</em> : null}</span>
        {!INFORMATIONAL_TASK_BLOCK_TYPES.has(block.block_type) ? <small>{taskTypeLabel(block.block_type, t)}</small> : null}
      </div>
      <span className={`crew-ui-status crew-task-block-result${blockStatusTone(status) === "success" ? " is-success" : blockStatusTone(status) === "warning" ? " is-warning" : ""}`}>{summaryStatus}</span>
      {responded ? <CheckCircle2 className="crew-task-block-saved-icon" size={17} aria-hidden="true" /> : null}
    </div>

    <div className="crew-task-block-panel">
      {block.description && !["key_point", "text"].includes(block.block_type) ? <p>{block.description}</p> : null}
      {supportsCompletionNote && !readonly && !responded ? <label className="crew-ui-form-field crew-task-additional-note"><span>{requiredCompletionNote ? "Completion note" : "Completion note (optional)"}</span><textarea className="crew-ui-field crew-task-textarea" value={note} disabled={saving} onChange={(event) => setNote(event.target.value)} placeholder={requiredCompletionNote ? "Add the required completion note" : "Add a note if useful"} /></label> : null}
      {readonly && actionable ? <div className="crew-task-readonly-result">{result}</div> : <BlockControl block={block} response={response} setResponse={setResponse} mode={mode} saving={saving} responded={responded} completionNote={note} completionNoteRequired={requiredCompletionNote} submit={submit} onOpenSop={onOpenSop} readMore={readMore} setReadMore={setReadMore} onNeedsAttention={() => { setPendingIssueAction("health"); }} onNoException={() => { setPendingIssueAction("yes_no"); }} />}
      {canReportIssue ? <button type="button" className="crew-task-report-link" onClick={() => setExceptionOpen(true)} disabled={saving}><AlertTriangle size={15} /> {t("tasks.reportIssue")}</button> : null}
      {block.evidence_requirement && block.evidence_requirement !== "none" ? <small className="crew-task-evidence">{t("tasks.evidence", { type: String(block.evidence_requirement).replaceAll("_", " ") })}</small> : null}
    </div>

    {exceptionOpen && typeof document !== "undefined" ? createPortal(<ExceptionSheet
      title={title}
      reason={exceptionReason}
      setReason={setExceptionReason}
      note={note}
      setNote={setNote}
      saving={saving}
      readonly={readonly}
      onClose={() => setExceptionOpen(false)}
      action={issueAction}
      requiresReason={issueAction === "exception"}
      onSubmit={() => submit(issueAction, response, issueAction === "exception" ? exceptionReason : null, note)}
    />, document.body) : null}
  </section>;
}

function blockStatusTone(status) {
  if (["completed", "good"].includes(status)) return "success";
  if (["exception", "needs_attention", "not_checked"].includes(status)) return "warning";
  return "neutral";
}

function BlockNumber({ index, status }) {
  const responded = !["pending", "not_started", "in_progress"].includes(status);
  const tone = blockStatusTone(status);
  return <span className={`crew-ui-icon-container crew-ui-icon-container--compact crew-task-block-number${tone === "success" ? " is-success" : tone === "warning" ? " is-warning" : ""}`} aria-hidden="true">{responded ? status === "exception" || status === "needs_attention" ? <AlertTriangle size={16} /> : <Check size={17} /> : String(index + 1).padStart(2, "0")}</span>;
}

function taskTypeLabel(type, t) { return t(`tasks.types.${type}`, { defaultValue: t("tasks.task") }); }

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

function BlockControl({ block, response, setResponse, mode, saving, responded, completionNote, completionNoteRequired, submit, onOpenSop, readMore, setReadMore, onNeedsAttention, onNoException }) {
  const { t } = useTranslation();
  const disabled = mode === "readonly" || saving || responded;
  const immediateDisabled = disabled || (completionNoteRequired && String(completionNote).trim().length < 3);
  const type = block.block_type;
  const value = response.value ?? "";
  if (type === "text") return <InstructionContent content={block.description || t("tasks.addInstruction")} readMore={readMore} setReadMore={setReadMore} />;
  if (type === "key_point") return <div className="crew-task-key-point"><Lightbulb size={17} /><InstructionContent content={block.description || t("tasks.addKeyPoint")} readMore={readMore} setReadMore={setReadMore} /></div>;
  if (type === "image") return <div className="crew-task-unavailable"><FileText size={17} /><span>{block.media?.caption || block.config?.caption || t("tasks.imageUnavailable")}</span></div>;
  if (type === "sop_reference") {
    const sop = block.sop_reference;
    if (!sop && !block.sop_version_id) return <div className="crew-task-unavailable"><AlertTriangle size={16} /><span>{t("tasks.choosePublishedSop")}</span></div>;
    return <button type="button" aria-label={mode === "preview" ? `${t("tasks.viewSop")} ${t("tasks.preview").toLowerCase()}` : t("tasks.viewSop")} className="crew-ui-functional-surface crew-task-sop-card" onClick={() => onOpenSop?.(sop || { sop_version_id: block.sop_version_id })} disabled={!onOpenSop && mode !== "preview"}>
      <FileText size={18} /><span><strong>{sop?.title || block.sop_title || t("tasks.publishedSop")}</strong><small>{sop?.version ? `v${sop.version}` : block.sop_version ? `v${block.sop_version}` : ""}</small></span><em>{mode === "preview" ? t("tasks.openPreview") : `${t("tasks.viewSop")} ›`}</em>
    </button>;
  }
  if (type === "checklist_item") return <button type="button" aria-label={t("tasks.completeBlock", { title: block.title })} className="crew-task-direct-toggle" disabled={immediateDisabled} onClick={() => submit("completed", { value: true })}><ClipboardCheck size={18} /> <span>{t("tasks.markDone")}</span></button>;
  if (type === "confirmation") return <button type="button" aria-label={`${t("tasks.confirmAction")} ${block.title}`} className="crew-mobile-primary crew-task-focused-action" disabled={immediateDisabled} onClick={() => submit("completed", { value: true })}><CheckCircle2 size={18} /> {t("tasks.confirmAction")}</button>;
  if (type === "yes_no") return <div className="crew-task-input-wrap"><div className="crew-ui-choice-list crew-task-choice-grid is-two">{[["yes", t("tasks.yes")], ["no", t("tasks.no")]].map(([choice, label]) => <button key={choice} className={value === choice ? "is-selected" : ""} type="button" aria-pressed={value === choice} disabled={immediateDisabled} onClick={() => {
    const nextResponse = { value: choice };
    setResponse(nextResponse);
    if (choice === "no" && block.config?.no_requires_issue) { onNoException?.(); return; }
    submit("completed", nextResponse);
  }}>{label}</button>)}</div></div>;
  if (type === "single_choice") {
    const options = block.config?.options || [];
    if (!options.length) return <div className="crew-task-unavailable"><AlertTriangle size={16} /><span>{t("tasks.addOption")}</span></div>;
    return <div className="crew-task-input-wrap"><div className="crew-ui-choice-list crew-task-choice-list" role="radiogroup">{options.map((option) => <button key={option} className={value === option ? "is-selected" : ""} type="button" role="radio" aria-checked={value === option} disabled={immediateDisabled} onClick={() => { const nextResponse = { value: option }; setResponse(nextResponse); submit("completed", nextResponse); }}><i />{option}</button>)}</div></div>;
  }
  if (["number", "temperature"].includes(type)) {
    const unit = block.config?.unit || (type === "temperature" ? "°C" : "");
    return <div className="crew-task-input-wrap"><label className="crew-ui-field crew-task-number-field"><span>{type === "temperature" ? <Thermometer size={15} /> : "#"}</span><input aria-label={taskTypeLabel(type, t)} type="number" min={block.config?.min ?? undefined} max={block.config?.max ?? undefined} value={value} disabled={disabled} onChange={(event) => setResponse({ value: event.target.value })} /><em>{unit}</em></label><RangeHint config={block.config} unit={unit} /><button type="button" className="crew-mobile-primary crew-task-submit" disabled={immediateDisabled || String(value).trim() === ""} onClick={() => submit("completed")}>{saving ? t("common.saving") : t("tasks.saveValue")}</button></div>;
  }
  if (type === "short_text") return <div className="crew-task-input-wrap"><textarea className="crew-ui-field crew-task-textarea" aria-label={taskTypeLabel(type, t)} value={value} disabled={disabled} onChange={(event) => setResponse({ value: event.target.value })} /><button type="button" className="crew-mobile-primary crew-task-submit" disabled={immediateDisabled || !String(value).trim()} onClick={() => submit("completed")}>{saving ? t("common.saving") : t("tasks.saveResponse")}</button></div>;
  if (type === "health_rating") return <div className="crew-task-health"><div className="crew-ui-choice-list crew-task-choice-grid is-health">{[["good", t("tasks.good")], ["needs_attention", t("tasks.needsAttention")], ["not_checked", t("tasks.notChecked")]].map(([choice, choiceLabel]) => <button key={choice} className={value === choice ? "is-selected" : ""} type="button" aria-pressed={value === choice} disabled={immediateDisabled} onClick={() => {
    const nextResponse = { value: choice };
    setResponse(nextResponse);
    if (choice === "needs_attention") { onNeedsAttention?.(); return; }
    submit(choice, nextResponse);
  }}>{choice === "good" ? <Check size={15} /> : choice === "needs_attention" ? <AlertTriangle size={15} /> : <HeartPulse size={15} />}{choiceLabel}</button>)}</div></div>;
  return null;
}

function InstructionContent({ content, readMore, setReadMore }) {
  const { t } = useTranslation();
  const long = content.length > 180 || content.split("\n").length > 3;
  const visible = long && !readMore ? `${content.slice(0, 180).trimEnd()}…` : content;
  return <div className="crew-task-instruction"><span>{visible}</span>{long ? <button type="button" className="crew-task-read-more" onClick={() => setReadMore((value) => !value)}>{readMore ? t("tasks.showLess") : t("tasks.readMore")}</button> : null}</div>;
}

function ExceptionSheet({ title, reason, setReason, note, setNote, saving, readonly, action, requiresReason, onClose, onSubmit }) {
  const { t } = useTranslation();
  return <div className="crew-task-exception-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="crew-task-exception-sheet" role="dialog" aria-modal="true" aria-label={t("tasks.reportIssueFor", { title })}>
      <header><div><strong>{t("tasks.reportIssue")}</strong><span>{title}</span></div><button className="crew-mobile-ghost crew-task-exception-close" type="button" aria-label={t("common.close")} onClick={onClose}><X size={19} /></button></header>
      <div className="crew-task-exception-body">
        {requiresReason ? <label className="crew-ui-form-field">{t("attendance.reason")}<select className="crew-ui-field" value={reason} onChange={(event) => setReason(event.target.value)}><option value="">{t("tasks.chooseReason")}</option>{exceptionReasons.map((reasonValue) => <option key={reasonValue} value={reasonValue}>{t(`tasks.reasons.${reasonValue}`)}</option>)}</select></label> : null}
        <label className="crew-ui-form-field">{t("tasks.note")}<textarea className="crew-ui-field crew-task-exception-textarea" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("tasks.explainIssue")} /></label>
        <small>{t("tasks.evidenceUnavailable")}</small>
      </div>
      <footer className="crew-ui-sticky-actions crew-ui-sticky-actions--sheet"><button type="button" className="crew-mobile-ghost" onClick={onClose}>{t("common.cancel")}</button><button type="button" className="crew-mobile-primary" disabled={(requiresReason && !reason) || (!requiresReason && String(note).trim().length < 3) || saving || readonly} onClick={onSubmit}>{saving ? t("common.saving") : action === "needs_attention" ? t("tasks.reportIssue") : t("tasks.submitException")}</button></footer>
    </section>
  </div>;
}

function RangeHint({ config, unit }) {
  const { t } = useTranslation();
  if (config?.min === undefined && config?.max === undefined) return null;
  return <small className="crew-task-range">{t("tasks.expectedRange", { min: config?.min ?? t("tasks.any"), max: config?.max ?? t("tasks.any"), unit })}</small>;
}
