import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck, HeartPulse, ListChecks, Store } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import CrewSopDocument from "./CrewSopDocument.jsx";
import CrewTaskBlockRenderer, { isTaskBlockActionable, normalizeTaskBlock } from "./CrewTaskBlockRenderer.jsx";

const REASONS = [["equipment_issue", "Equipment issue"], ["stock_unavailable", "Stock unavailable"], ["area_unavailable", "Area unavailable"], ["manager_instruction", "Manager instruction"], ["other", "Other"]];
const label = (value) => ({ not_started: "Not Started", in_progress: "In Progress", completed: "Completed", completed_with_exceptions: "Completed · Exceptions", review_required: "Review Required", overdue: "Overdue", pending: "Pending", exception: "Exception", good: "Good", needs_attention: "Needs Attention", not_checked: "Not Checked" }[value] || value);

export default function CrewOperationsMobile({ token, data, loading, initialTarget, onRefresh, onBack }) {
  const [detail, setDetail] = useState(null);
  const [legacyTask, setLegacyTask] = useState(null);
  const [activeSop, setActiveSop] = useState(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingBlockId, setSavingBlockId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { setDetail(null); setLegacyTask(null); setActiveSop(null); }, [token]);
  useEffect(() => {
    if (!initialTarget) return;
    if (initialTarget.kind === "legacy_task") setLegacyTask({ ...initialTarget.row, kind: "legacy_task" });
    else openTask(initialTarget.row);
  }, [initialTarget]);

  async function openTask(row) {
    setSaving(true); setError("");
    try { setDetail(await crewService.operationDetail(token, row.id)); }
    catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }
  async function refreshDetail(current = detail) {
    if (!current) return;
    setDetail(await crewService.operationDetail(token, current.id));
    await onRefresh?.();
  }
  async function submitBlock({ block, action, response, reason: exceptionReason, note: responseNote }) {
    setSavingBlockId(block.id); setError("");
    try {
      await crewService.updateTaskBlock(token, block.id, action, response, exceptionReason || null, responseNote || null);
      await refreshDetail();
    } catch (cause) { setError(cause.message); }
    finally { setSavingBlockId(null); }
  }
  async function submitLegacy(action) {
    if (!legacyTask) return;
    setSaving(true); setError("");
    try {
      await crewService.updateDailyTask(token, legacyTask.id, action, reason || null, note || null);
      setLegacyTask(null); setReason(""); setNote("");
      await onRefresh?.();
    } catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }
  async function finish() {
    setSaving(true); setError("");
    try { await crewService.completeOperationChecklist(token, detail.id); await refreshDetail(); }
    catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }
  async function openSop(reference) {
    const id = reference?.sop_version_id || reference?.version_id || reference?.id;
    if (!id) return;
    setSaving(true); setError("");
    try { setActiveSop(await crewService.sopVersion(token, id)); }
    catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }

  if (activeSop) return <SopTaskReader sop={activeSop} token={token} onBack={() => setActiveSop(null)} />;

  if (detail) {
    const blocks = (detail.blocks || []).map(normalizeTaskBlock);
    const actionable = blocks.filter(isTaskBlockActionable);
    const completed = actionable.filter((item) => !["pending", "not_started", "not_checked"].includes(item.status)).length;
    const taskComplete = ["completed", "completed_with_exceptions"].includes(detail.status);
    return <section className="crew-ops-mobile">
      <CrewMobileDetailHeader title={detail.name} onBack={() => setDetail(null)} />
      <div className="crew-ops-detail-head"><span>{String(detail.task_type || "task").replaceAll("_", " ")}</span><strong>{label(detail.status)}</strong><small>{completed} of {actionable.length} completed</small><div className="crew-task-preview-progress"><span style={{ width: `${actionable.length ? (completed / actionable.length) * 100 : 100}%` }} /></div></div>
      <div className="crew-ops-items">{blocks.map((block, index) => <CrewTaskBlockRenderer key={block.id || index} block={block} index={index} mode="interactive" allowException={detail.allow_exception} saving={savingBlockId === block.id} onSubmit={submitBlock} onOpenSop={openSop} />)}</div>
      {error ? <div className="crew-v2-error">{error}</div> : null}
      <div className="crew-ops-sticky"><button className="crew-v2-primary" disabled={saving || taskComplete} onClick={finish}>{saving ? "Saving…" : taskComplete ? "Task Completed" : "Complete Task"}</button></div>
    </section>;
  }

  const tasks = data?.tasks || [];
  return <section className="crew-ops-mobile">
    <CrewMobileDetailHeader title="Today’s Tasks" onBack={onBack} />
    <div className="crew-ops-context"><span><Store size={17} /><strong>{data?.outlet?.name || "Your outlet"}</strong></span><small>{data?.attendance_context?.on_shift ? "On Shift" : "Tasks remain available for review outside your shift"}</small></div>
    {loading ? <div className="crew-ops-loading">Loading today’s tasks…</div> : <section className="crew-ops-group"><div className="crew-v2-section-title"><h2>Tasks</h2><span>{tasks.length}</span></div>{tasks.length ? tasks.map((task) => <button key={`${task.source}-${task.id}`} type="button" className={`crew-ops-task is-${task.status}`} onClick={() => task.source === "legacy_daily" ? setLegacyTask({ ...task, kind: "legacy_task" }) : openTask(task)}><span>{task.task_type === "health_check" ? <HeartPulse size={17} /> : task.task_type === "checklist" ? <ClipboardCheck size={17} /> : <ListChecks size={17} />}</span><span><strong>{task.name}</strong><small>{task.block_count ? `${task.completed_count || 0} / ${task.block_count} completed` : task.description || String(task.task_type).replaceAll("_", " ")}</small></span><em>{label(task.status)}</em></button>) : <Empty text="No Tasks apply to you today." />}</section>}
    {error ? <div className="crew-v2-error">{error}</div> : null}
    {legacyTask ? <LegacyTaskModal item={legacyTask} reason={reason} setReason={setReason} note={note} setNote={setNote} saving={saving} onClose={() => setLegacyTask(null)} onSubmit={submitLegacy} /> : null}
  </section>;
}

export function CrewTaskPreview({ task, onBack }) {
  const blocks = useMemo(() => (task.blocks || []).map(normalizeTaskBlock), [task.blocks]);
  const actionable = blocks.filter(isTaskBlockActionable);
  const [completedIds, setCompletedIds] = useState([]);
  const [sopMessage, setSopMessage] = useState("");
  const completed = completedIds.length;
  function previewSubmit({ block }) { setCompletedIds((ids) => ids.includes(block.id) ? ids : [...ids, block.id]); }
  return <section className="crew-ops-mobile crew-task-preview" aria-label="Crew Task preview">
    <div className="crew-task-preview-nav"><CrewMobileDetailHeader title={task.name || "Untitled Task"} onBack={onBack || (() => {})} /></div>
    <div className="crew-ops-detail-head"><span>{String(task.task_type || "task").replaceAll("_", " ")}</span><strong>Preview</strong><small>{completed} of {actionable.length} completed</small><div className="crew-task-preview-progress"><span style={{ width: `${actionable.length ? (completed / actionable.length) * 100 : 100}%` }} /></div></div>
    <div className="crew-ops-items">{blocks.map((block, index) => <CrewTaskBlockRenderer key={block.id || index} block={{ ...block, status: completedIds.includes(block.id) ? "completed" : "pending" }} index={index} mode="preview" allowException={task.allow_exception} onPreviewChange={previewSubmit} onOpenSop={(sop) => setSopMessage(`${sop?.title || "Published SOP"} opens read-only for Crew.`)} />)}</div>
    {sopMessage ? <p className="crew-task-preview-only">{sopMessage}</p> : null}
    <div className="crew-task-preview-complete"><button type="button" className="crew-v2-primary" onClick={() => setCompletedIds(actionable.map((block) => block.id))}>Complete Task</button><p className="crew-task-preview-only">Preview only · No execution or evidence will be saved.</p></div>
  </section>;
}

function SopTaskReader({ sop, token, onBack }) {
  return <section className="crew-ops-mobile crew-learning-reader"><CrewMobileDetailHeader title={sop.title || "SOP"} onBack={onBack} /><div className="crew-ops-detail-head"><span>{sop.category || "SOP"}</span><strong>Published v{sop.version}</strong><small>Referenced by this Task</small></div><CrewSopDocument sections={sop.sections || []} token={token} sopVersionId={sop.id} className="is-mobile" /></section>;
}

function LegacyTaskModal({ item, reason, setReason, note, setNote, saving, onClose, onSubmit }) {
  return <div className="crew-ops-sheet-backdrop"><section className="crew-ops-sheet"><div><h2>{item.name || item.title}</h2><button onClick={onClose}>×</button></div><p>{item.description || "Complete this Task, or record an exception when permitted."}</p><button className="crew-v2-primary" disabled={saving} onClick={() => onSubmit("completed")}>Complete</button><button className="crew-ops-choice is-warning" onClick={() => setReason(reason || "equipment_issue")}><AlertTriangle size={18} /> Record Exception</button>{reason ? <><label>Reason<select value={reason} onChange={(event) => setReason(event.target.value)}>{REASONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label>Note<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="crew-v2-primary" disabled={saving} onClick={() => onSubmit("exception")}>Submit Exception</button></> : null}</section></div>;
}

function Empty({ text }) { return <div className="crew-ops-empty"><ClipboardCheck size={22} /><p>{text}</p></div>; }
