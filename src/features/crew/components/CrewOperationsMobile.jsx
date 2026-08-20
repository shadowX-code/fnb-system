import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";
import { AlertTriangle, CheckCircle2, ClipboardCheck, HeartPulse, ListChecks, Store } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import CrewSopDocument from "./CrewSopDocument.jsx";
import CrewTaskBlockRenderer, { isTaskBlockActionable, isTaskBlockComplete, normalizeTaskBlock } from "./CrewTaskBlockRenderer.jsx";
import { formatCrewTime, translateStatus } from "../utils/crewI18n.js";

export default function CrewOperationsMobile({ token, data, loading, initialTarget, onRefresh, onBack }) {
  const { t } = useTranslation();
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
    } catch (cause) { setError(cause.message); throw cause; }
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
    const completed = actionable.filter(isTaskBlockComplete).length;
    const taskComplete = ["completed", "completed_with_exceptions", "review_required"].includes(detail.status);
    return <section className="crew-ops-mobile">
      <CrewMobileDetailHeader title={detail.name} onBack={() => setDetail(null)} />
      <div className="crew-ops-detail-head"><span>{String(detail.task_type || "task").replaceAll("_", " ")}</span><strong>{translateStatus(detail.status, t)}</strong><small>{t("tasks.completedCount", { completed, total: actionable.length })}</small><div className="crew-task-preview-progress"><span style={{ width: `${actionable.length ? (completed / actionable.length) * 100 : 100}%` }} /></div></div>
      {taskComplete ? <TaskCompletionState status={detail.status} completed={completed} total={actionable.length} completedAt={detail.completed_at} /> : null}
      <div className="crew-ops-items">{blocks.map((block, index) => <CrewTaskBlockRenderer key={block.id || index} block={block} index={index} mode="interactive" allowException={detail.allow_exception} saving={savingBlockId === block.id} onSubmit={submitBlock} onOpenSop={openSop} />)}</div>
      {error ? <div className="crew-v2-error">{error}</div> : null}
    </section>;
  }

  const tasks = data?.tasks || [];
  return <section className="crew-ops-mobile">
    <CrewMobileDetailHeader title={t("tasks.title")} onBack={onBack} />
    <div className="crew-ops-context"><span><Store size={17} /><strong>{data?.outlet?.name || t("home.yourOutlet")}</strong></span><small>{data?.attendance_context?.on_shift ? t("home.onShift") : t("tasks.outsideShift")}</small></div>
    {loading ? <div className="crew-ops-loading">{t("common.loading")}</div> : <section className="crew-ops-group"><div className="crew-v2-section-title"><h2>{t("tasks.task")}</h2><span>{tasks.length}</span></div>{tasks.length ? tasks.map((task) => <button key={`${task.source}-${task.id}`} type="button" className={`crew-ops-task is-${task.status}`} onClick={() => task.source === "legacy_daily" ? setLegacyTask({ ...task, kind: "legacy_task" }) : openTask(task)}><span>{task.task_type === "health_check" ? <HeartPulse size={17} /> : task.task_type === "checklist" ? <ClipboardCheck size={17} /> : <ListChecks size={17} />}</span><span><strong>{task.name}</strong><small>{task.block_count ? t("tasks.completedCount", { completed: task.completed_count || 0, total: task.block_count }) : task.description || String(task.task_type).replaceAll("_", " ")}</small></span><em>{translateStatus(task.status, t)}</em></button>) : <Empty text={t("tasks.noTasks")} />}</section>}
    {error ? <div className="crew-v2-error">{error}</div> : null}
    {legacyTask ? <LegacyTaskModal item={legacyTask} reason={reason} setReason={setReason} note={note} setNote={setNote} saving={saving} onClose={() => setLegacyTask(null)} onSubmit={submitLegacy} /> : null}
  </section>;
}

export function CrewTaskPreview({ task, onBack }) {
  const { t } = useTranslation();
  const blocks = useMemo(() => (task.blocks || []).map(normalizeTaskBlock), [task.blocks]);
  const actionable = blocks.filter(isTaskBlockActionable);
  const required = actionable.filter((block) => block.required !== false);
  const [previewStatuses, setPreviewStatuses] = useState({});
  const [sopMessage, setSopMessage] = useState("");
  useEffect(() => { setPreviewStatuses({}); setSopMessage(""); }, [task.id]);
  const completed = actionable.filter((block) => isTaskBlockComplete({ ...block, status: previewStatuses[block.id] || "pending" })).length;
  const previewComplete = required.length > 0 && required.every((block) => isTaskBlockComplete({ ...block, status: previewStatuses[block.id] || "pending" }));
  function previewSubmit({ block, action }) { setPreviewStatuses((statuses) => ({ ...statuses, [block.id]: action })); }
  return <section className="crew-ops-mobile crew-task-preview" aria-label={t("tasks.crewPreview")}>
    <div className="crew-task-preview-nav"><CrewMobileDetailHeader title={task.name || t("tasks.untitled")} onBack={onBack || (() => {})} /></div>
    <div className="crew-ops-detail-head"><span>{String(task.task_type || "task").replaceAll("_", " ")}</span><strong>{t("tasks.preview")}</strong><small>{t("tasks.completedCount", { completed, total: actionable.length })}</small><div className="crew-task-preview-progress"><span style={{ width: `${actionable.length ? (completed / actionable.length) * 100 : 100}%` }} /></div></div>
    {previewComplete ? <TaskCompletionState status={task.manager_review_required ? "review_required" : "completed"} completed={completed} total={actionable.length} /> : null}
    <div className="crew-ops-items">{blocks.map((block, index) => <CrewTaskBlockRenderer key={block.id || index} block={{ ...block, status: previewStatuses[block.id] || "pending" }} index={index} mode="preview" allowException={task.allow_exception} onPreviewChange={previewSubmit} onOpenSop={(sop) => setSopMessage(t("tasks.sopReadOnly", { title: sop?.title || t("tasks.publishedSop") }))} />)}</div>
    {sopMessage ? <p className="crew-task-preview-only">{sopMessage}</p> : null}
    <p className="crew-task-preview-only">{t("tasks.previewOnly")}</p>
  </section>;
}

function TaskCompletionState({ status, completed, total, completedAt }) {
  const { t } = useTranslation();
  const review = status === "review_required";
  const time = completedAt ? formatCrewTime(completedAt).toLowerCase() : null;
  return <section className="crew-task-completion-state" aria-live="polite"><CheckCircle2 size={21} /><span><strong>{review ? t("tasks.submittedReview") : t("tasks.completed")}</strong><small>{t("tasks.completedCount", { completed, total })}{time ? ` · ${t("tasks.completedAt", { time })}` : ""}</small></span></section>;
}

function SopTaskReader({ sop, token, onBack }) {
  const { t } = useTranslation();
  return <section className="crew-ops-mobile crew-learning-reader"><CrewMobileDetailHeader title={sop.title || t("learn.readerFallback")} onBack={onBack} /><div className="crew-ops-detail-head"><span>{sop.category || t("learn.readerFallback")}</span><strong>{t("learn.version", { version: sop.version })}</strong><small>{t("learn.referencedTask")}</small></div><CrewSopDocument sections={sop.sections || []} token={token} sopVersionId={sop.id} className="is-mobile" /></section>;
}

function LegacyTaskModal({ item, reason, setReason, note, setNote, saving, onClose, onSubmit }) {
  const { t } = useTranslation();
  const reasons = ["equipment_issue", "stock_unavailable", "area_unavailable", "manager_instruction", "other"];
  return <div className="crew-ops-sheet-backdrop"><section className="crew-ops-sheet"><div><h2>{item.name || item.title}</h2><button onClick={onClose} aria-label={t("common.close")}>×</button></div><p>{item.description || t("tasks.legacyInstruction")}</p><button className="crew-v2-primary" disabled={saving} onClick={() => onSubmit("completed")}>{t("status.completed")}</button><button className="crew-ops-choice is-warning" onClick={() => setReason(reason || "equipment_issue")}><AlertTriangle size={18} /> {t("tasks.recordException")}</button>{reason ? <><label>{t("tasks.chooseReason")}<select value={reason} onChange={(event) => setReason(event.target.value)}>{reasons.map((value) => <option key={value} value={value}>{t(`tasks.reasons.${value}`)}</option>)}</select></label><label>{t("tasks.note")}<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="crew-v2-primary" disabled={saving} onClick={() => onSubmit("exception")}>{t("tasks.submitException")}</button></> : null}</section></div>;
}

function Empty({ text }) { return <div className="crew-ops-empty"><ClipboardCheck size={22} /><p>{text}</p></div>; }
