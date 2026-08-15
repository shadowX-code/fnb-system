import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  HeartPulse,
  Lightbulb,
  Thermometer,
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

const typeLabels = {
  text: "Instruction",
  checklist_item: "Checklist item",
  key_point: "Key point",
  image: "Image",
  sop_reference: "SOP reference",
  yes_no: "Yes / No",
  single_choice: "Choose one",
  number: "Number input",
  temperature: "Temperature input",
  short_text: "Short text",
  health_rating: "Health rating",
  confirmation: "Confirmation",
};

const statusLabels = {
  pending: "Not Started",
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  good: "Good",
  needs_attention: "Needs Attention",
  not_checked: "Not Checked",
  exception: "Exception",
};

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
  const block = useMemo(() => normalizeTaskBlock(sourceBlock), [sourceBlock]);
  const [response, setResponse] = useState(block.response);
  const [previewStatus, setPreviewStatus] = useState(block.status);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [note, setNote] = useState(block.note || "");
  const preview = mode === "preview";
  const readonly = mode === "readonly";
  const actionable = isTaskBlockActionable(block);
  const status = preview ? previewStatus : block.status;
  const title = String(block.title || "").trim();
  const complete = ["completed", "good"].includes(status);
  const warning = ["exception", "needs_attention"].includes(status);

  useEffect(() => {
    setResponse(block.response);
    setPreviewStatus(block.status);
    setExceptionOpen(false);
    setExceptionReason("");
    setNote(block.note || "");
  }, [block.id, block.block_type, JSON.stringify(block.config), block.status]);

  function submit(action, nextResponse = response, reason = null, nextNote = note) {
    if (preview) {
      setPreviewStatus(action === "exception" ? "exception" : action);
      onPreviewChange?.({ block, action, response: nextResponse, reason, note: nextNote || null });
      return;
    }
    if (readonly || saving) return;
    onSubmit?.({ block, action, response: nextResponse, reason, note: nextNote || null });
  }

  if (!title) {
    return <section className="crew-task-block is-incomplete" data-block-type={block.block_type} data-preview-mode={preview ? "true" : undefined}>
      <BlockNumber index={index} status="pending" />
      <div className="crew-task-block-main"><strong>Add a title to preview this block.</strong><small>{typeLabels[block.block_type] || "Task block"}</small></div>
    </section>;
  }

  return <section className={`crew-task-block is-${block.block_type} is-${status}${compact ? " is-compact" : ""}`} data-block-type={block.block_type} data-preview-mode={preview ? "true" : undefined}>
    <BlockNumber index={index} status={status} />
    <div className="crew-task-block-main">
      <header className="crew-task-block-head">
        <div><strong>{title}</strong>{block.required === false ? <span>Optional</span> : null}</div>
        {actionable && status !== "pending" ? <em>{statusLabels[status] || status}</em> : null}
      </header>
      {block.block_type !== "key_point" && block.description ? <p>{block.description}</p> : null}
      <BlockControl block={block} response={response} setResponse={setResponse} mode={mode} complete={complete} saving={saving} submit={submit} onOpenSop={onOpenSop} />
      {actionable && allowException && !complete ? <div className="crew-task-exception">
        <button type="button" className="crew-task-link is-warning" onClick={() => setExceptionOpen((value) => !value)} disabled={readonly || saving}><AlertTriangle size={14} /> Record exception</button>
        {exceptionOpen ? <div className="crew-task-exception-fields">
          <label>Reason<select value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)}><option value="">Choose reason</option><option value="equipment_issue">Equipment issue</option><option value="stock_unavailable">Stock unavailable</option><option value="area_unavailable">Area unavailable</option><option value="manager_instruction">Manager instruction</option><option value="other">Other</option></select></label>
          <label>Note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Explain what prevented completion" /></label>
          <button type="button" className="crew-task-secondary-action" disabled={!exceptionReason || saving || readonly} onClick={() => submit("exception", response, exceptionReason, note)}>Submit exception</button>
        </div> : null}
      </div> : null}
      {block.evidence_requirement && block.evidence_requirement !== "none" ? <small className="crew-task-evidence">Evidence: {String(block.evidence_requirement).replaceAll("_", " ")}</small> : null}
    </div>
  </section>;
}

function BlockNumber({ index, status }) {
  return <span className={`crew-task-block-number is-${status}`} aria-hidden="true">{["completed", "good"].includes(status) ? <Check size={17} /> : ["exception", "needs_attention"].includes(status) ? <AlertTriangle size={16} /> : String(index + 1).padStart(2, "0")}</span>;
}

function BlockControl({ block, response, setResponse, mode, complete, saving, submit, onOpenSop }) {
  const disabled = mode === "readonly" || saving || complete;
  const type = block.block_type;
  const value = response.value ?? "";
  if (type === "text") return null;
  if (type === "key_point") return <div className="crew-task-key-point"><Lightbulb size={17} /><span>{block.description || "Add key point content to preview this block."}</span></div>;
  if (type === "image") return <div className="crew-task-unavailable"><FileText size={17} /><span>{block.media?.caption || block.config?.caption || "Secure task image preview is unavailable."}</span></div>;
  if (type === "sop_reference") {
    const sop = block.sop_reference;
    if (!sop && !block.sop_version_id) return <div className="crew-task-unavailable"><AlertTriangle size={16} /><span>Choose a published SOP to preview this block.</span></div>;
    return <button type="button" aria-label={mode === "preview" ? "Open SOP preview" : "Open SOP"} className="crew-task-sop-card" onClick={() => onOpenSop?.(sop || { sop_version_id: block.sop_version_id })} disabled={!onOpenSop && mode !== "preview"}>
      <FileText size={18} /><span><strong>{sop?.title || block.sop_title || "Published SOP"}</strong><small>{sop?.version ? `Version ${sop.version}` : block.sop_version ? `Version ${block.sop_version}` : "Pinned published version"}</small></span><em>{mode === "preview" ? "Open SOP preview" : "Open SOP"}</em>
    </button>;
  }
  if (type === "checklist_item") return <button type="button" aria-label={`${complete ? "Completed" : "Complete"} ${block.title}`} className={`crew-task-primary-action${complete ? " is-complete" : ""}`} disabled={disabled} onClick={() => submit("completed", { value: true })}><ClipboardCheck size={17} />{complete ? "Done" : "Mark done"}</button>;
  if (type === "confirmation") return <button type="button" aria-label={`${complete ? "Confirmed" : "Confirm"} ${block.title}`} className={`crew-task-primary-action${complete ? " is-complete" : ""}`} disabled={disabled} onClick={() => submit("completed", { value: true })}><CheckCircle2 size={17} />{complete ? "Confirmed" : "Confirm"}</button>;
  if (type === "yes_no") return <div className="crew-task-input-wrap"><div className="crew-task-choice-grid is-two">{["Yes", "No"].map((choice) => <button key={choice} type="button" aria-pressed={value === choice.toLowerCase()} disabled={disabled} onClick={() => setResponse({ value: choice.toLowerCase() })}>{choice}</button>)}</div><button type="button" className="crew-task-primary-action" disabled={disabled || !value} onClick={() => submit("completed")}>Submit</button></div>;
  if (type === "single_choice") {
    const options = block.config?.options || [];
    if (!options.length) return <div className="crew-task-unavailable"><AlertTriangle size={16} /><span>Add at least one option to preview this block.</span></div>;
    return <div className="crew-task-input-wrap"><div className="crew-task-choice-list" role="radiogroup">{options.map((option) => <button key={option} type="button" role="radio" aria-checked={value === option} disabled={disabled} onClick={() => setResponse({ value: option })}><i />{option}</button>)}</div><button type="button" className="crew-task-primary-action" disabled={disabled || !value} onClick={() => submit("completed")}>Submit</button></div>;
  }
  if (["number", "temperature"].includes(type)) {
    const unit = block.config?.unit || (type === "temperature" ? "°C" : "");
    return <div className="crew-task-input-wrap"><label><span>{type === "temperature" ? <Thermometer size={15} /> : "#"}</span><input aria-label={type === "temperature" ? "Temperature" : "Number"} type="number" min={block.config?.min ?? undefined} max={block.config?.max ?? undefined} value={value} disabled={disabled} onChange={(event) => setResponse({ value: event.target.value })} placeholder="Enter value" /><em>{unit}</em></label><RangeHint config={block.config} unit={unit} /><button type="button" className="crew-task-primary-action" disabled={disabled || String(value).trim() === ""} onClick={() => submit("completed")}>Submit</button></div>;
  }
  if (type === "short_text") return <div className="crew-task-input-wrap"><textarea aria-label="Response" value={value} disabled={disabled} onChange={(event) => setResponse({ value: event.target.value })} placeholder="Type your response" /><button type="button" className="crew-task-primary-action" disabled={disabled || !String(value).trim()} onClick={() => submit("completed")}>Submit</button></div>;
  if (type === "health_rating") return <div className="crew-task-health"><div className="crew-task-choice-grid is-health">{[["good", "Good"], ["needs_attention", "Needs Attention"], ["not_checked", "Not Checked"]].map(([choice, label]) => <button key={choice} type="button" aria-pressed={value === choice} disabled={disabled} onClick={() => setResponse({ value: choice })}>{choice === "good" ? <Check size={15} /> : choice === "needs_attention" ? <AlertTriangle size={15} /> : <HeartPulse size={15} />}{label}</button>)}</div>{value === "needs_attention" ? <textarea aria-label="Needs attention note" value={response.note || ""} disabled={disabled} onChange={(event) => setResponse({ ...response, note: event.target.value })} placeholder="Describe what needs attention" /> : null}<button type="button" className="crew-task-primary-action" disabled={disabled || !value || (value === "needs_attention" && !String(response.note || "").trim())} onClick={() => submit(value, response, value === "needs_attention" ? "needs_attention" : null, response.note)}>Save rating</button></div>;
  return null;
}

function RangeHint({ config, unit }) {
  if (config?.min === undefined && config?.max === undefined) return null;
  return <small className="crew-task-range">Expected {config?.min ?? "any"}–{config?.max ?? "any"}{unit}</small>;
}
