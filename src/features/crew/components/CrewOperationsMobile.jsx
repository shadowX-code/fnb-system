import useCrewTaskPresentationTime from "../hooks/useCrewTaskPresentationTime.js";
import useCrewTaskTitles from "../hooks/useCrewTaskTitles.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";
import { AlertTriangle, CheckCircle2, ChevronRight, ClipboardCheck, Clock3, HeartPulse, ListChecks, RotateCcw, Store } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import CrewTaskPriority, { CrewTaskHeading, CrewTaskMetadata } from "./CrewTaskPriority.jsx";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewMobileModal from "./CrewMobileModal.jsx";
import CrewSopDocument from "./CrewSopDocument.jsx";
import CrewTaskBlockRenderer, { isTaskBlockActionable, isTaskBlockComplete, normalizeTaskBlock } from "./CrewTaskBlockRenderer.jsx";
import { CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";
import { formatCrewDate, formatCrewTime, translateStatus } from "../utils/crewI18n.js";
import { activeTaskResponsibilities, formatTaskSchedule, historyTasks, taskPresentationStatus, taskMatchesStatus } from "../utils/taskSchedule.js";
import { applySopLocalization, applyTaskLocalization } from "../utils/localizedContent.js";

export default function CrewOperationsMobile({ token, data, loading, initialTarget, onRefresh, onBack }) {
  const { t, i18n } = useTranslation();
  const [detail, setDetail] = useState(null);
  const [detailLanguage, setDetailLanguage] = useState(null);
  const [legacyTask, setLegacyTask] = useState(null);
  const [activeSop, setActiveSop] = useState(null);
  const [activeSopLanguage, setActiveSopLanguage] = useState(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingBlockId, setSavingBlockId] = useState(null);
  const [redoOpen, setRedoOpen] = useState(false);
  const [redoSaving, setRedoSaving] = useState(false);
  const [error, setError] = useState("");
  const [allTaskData, setAllTaskData] = useState(null);
  const [historyTaskData, setHistoryTaskData] = useState(null);
  const [allTasksLoading, setAllTasksLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [taskView, setTaskView] = useState("active");
  const [activeFilter, setActiveFilter] = useState("all");
  const [historyFilter, setHistoryFilter] = useState("all");
  const [detailLoading, setDetailLoading] = useState(Boolean(initialTarget));
  const [detailContext, setDetailContext] = useState(initialTarget?.context || null);
  const [availabilityNow, refreshAvailability] = useCrewTaskPresentationTime([detail, legacyTask, ...((allTaskData || data)?.tasks || []), ...(historyTaskData?.tasks || [])]);
  const allTaskRequest = useRef(0);
  const historyTaskRequest = useRef(0);
  const listScrollY = useRef(0);

  useEffect(() => { setDetail(null); setDetailLanguage(null); setLegacyTask(null); setActiveSop(null); setActiveSopLanguage(null); setAllTaskData(null); setHistoryTaskData(null); setTaskView("active"); setActiveFilter("all"); setHistoryFilter("all"); setDetailLoading(Boolean(initialTarget)); setDetailContext(initialTarget?.context || null); }, [token]);
  async function loadAllTasks() {
    const request = ++allTaskRequest.current;
    setAllTasksLoading(true); setError("");
    try {
      const nextData = await crewService.operationsAllTasks(token);
      if (request === allTaskRequest.current) setAllTaskData(nextData);
    }
    catch (cause) { if (request === allTaskRequest.current) setError(cause.message); }
    finally { if (request === allTaskRequest.current) setAllTasksLoading(false); }
  }
  useEffect(() => { loadAllTasks(); }, [token]);
  async function loadHistoryTasks() {
    const request = ++historyTaskRequest.current;
    setHistoryLoading(true); setError("");
    try {
      const nextData = await crewService.operationsHistory(token);
      if (request === historyTaskRequest.current) setHistoryTaskData(nextData);
    } catch (cause) { if (request === historyTaskRequest.current) setError(cause.message); }
    finally { if (request === historyTaskRequest.current) setHistoryLoading(false); }
  }
  useEffect(() => { if (taskView === "history" && !historyTaskData) loadHistoryTasks(); }, [taskView, token]);
  useEffect(() => {
    if (!initialTarget) return;
    setDetailContext(initialTarget.context || { from: "home" });
    if (initialTarget.kind === "legacy_task") { setLegacyTask({ ...initialTarget.row, kind: "legacy_task" }); setDetailLoading(false); }
    else openTask(initialTarget.row, initialTarget.context || { from: "home" });
  }, [initialTarget]);

  async function openTask(row, context = { from: "list" }) {
    setDetailContext(context);
    setDetailLoading(true);
    setSaving(true); setError(""); refreshAvailability();
    try {
      const nextDetail = await crewService.operationDetail(token, row.id);
      const language = i18n.resolvedLanguage || i18n.language || "en";
      const localized = nextDetail?.template_id ? await crewService.localizedContentForCrew(token, "task", [nextDetail.template_id], language).catch(() => ({})) : {};
      setDetail(applyTaskLocalization(nextDetail, localized[nextDetail?.template_id] || {}));
      setDetailLanguage(language);
    }
    catch (cause) { setError(cause.message); }
    finally { setSaving(false); setDetailLoading(false); }
  }
  async function refreshDetail(current = detail) {
    if (!current) return;
    const nextDetail = await crewService.operationDetail(token, current.id);
    const language = i18n.resolvedLanguage || i18n.language || "en";
    const localized = nextDetail?.template_id ? await crewService.localizedContentForCrew(token, "task", [nextDetail.template_id], language).catch(() => ({})) : {};
    setDetail(applyTaskLocalization(nextDetail, localized[nextDetail?.template_id] || {}));
    setDetailLanguage(language);
    await onRefresh?.();
    await loadAllTasks();
  }
  async function submitBlock({ block, action, response, reason: exceptionReason, note: responseNote }) {
    setSavingBlockId(block.id); setError("");
    try {
      const saved = await crewService.updateTaskBlock(token, block.id, action, response, exceptionReason || null, responseNote || null);
      const optimisticDetail = applyTaskBlockResponse(detail, block.id, saved, response, exceptionReason, responseNote);
      setDetail(optimisticDetail);
      void refreshDetail(optimisticDetail).catch((cause) => setError(cause.message));
      return saved;
    } catch (cause) { setError(cause.message); throw cause; }
    finally { setSavingBlockId(null); }
  }
  async function resetTask() {
    if (!detail) return;
    setRedoSaving(true); setError("");
    try {
      await crewService.resetTask(token, detail.id);
      setRedoOpen(false);
      await refreshDetail(detail);
    } catch (cause) { setError(cause.message); }
    finally { setRedoSaving(false); }
  }
  async function submitLegacy(action) {
    if (!legacyTask) return;
    setSaving(true); setError("");
    try {
      await crewService.updateDailyTask(token, legacyTask.id, action, reason || null, note || null);
      setLegacyTask(null); setReason(""); setNote("");
      await onRefresh?.();
      await loadAllTasks();
    } catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }
  async function openSop(reference) {
    const id = reference?.sop_version_id || reference?.version_id || reference?.id;
    if (!id) return;
    setSaving(true); setError("");
    try {
      const nextSop = await crewService.sopVersion(token, id);
      const language = i18n.resolvedLanguage || i18n.language || "en";
      const localized = await crewService.localizedContentForCrew(token, "sop", [id], language).catch(() => ({}));
      setActiveSop(applySopLocalization(nextSop, localized[id] || {}));
      setActiveSopLanguage(language);
    }
    catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }

  useEffect(() => {
    const language = i18n.resolvedLanguage || i18n.language || "en";
    if (!detail?.id || detailLanguage === language) return undefined;
    let active = true;
    (async () => {
      try {
        const nextDetail = await crewService.operationDetail(token, detail.id);
        const localized = nextDetail?.template_id ? await crewService.localizedContentForCrew(token, "task", [nextDetail.template_id], language).catch(() => ({})) : {};
        if (active) {
          setDetail(applyTaskLocalization(nextDetail, localized[nextDetail?.template_id] || {}));
          setDetailLanguage(language);
        }
      } catch (cause) { if (active) setError(cause.message); }
    })();
    return () => { active = false; };
  }, [token, detail?.id, detailLanguage, i18n.resolvedLanguage, i18n.language]);

  useEffect(() => {
    const language = i18n.resolvedLanguage || i18n.language || "en";
    if (!activeSop?.id || activeSopLanguage === language) return undefined;
    let active = true;
    Promise.all([
      crewService.sopVersion(token, activeSop.id),
      crewService.localizedContentForCrew(token, "sop", [activeSop.id], language).catch(() => ({})),
    ]).then(([nextSop, localized]) => {
      if (active) {
        setActiveSop(applySopLocalization(nextSop, localized[activeSop.id] || {}));
        setActiveSopLanguage(language);
      }
    }).catch((cause) => active && setError(cause.message));
    return () => { active = false; };
  }, [token, activeSop?.id, activeSopLanguage, i18n.resolvedLanguage, i18n.language]);

  const localizedAllTasks = useCrewTaskTitles(token, (allTaskData || data)?.tasks || []);
  const localizedHistoryTasks = useCrewTaskTitles(token, historyTaskData?.tasks || []);

  function returnFromDetail() {
    if (detailContext?.from === "home") { onBack?.(detailContext); return; }
    setDetail(null); setDetailLoading(false); setDetailContext(null);
    requestAnimationFrame(() => window.scrollTo({ top: detailContext?.scrollY || 0 }));
  }

  function openFromList(task, source = taskView) {
    listScrollY.current = window.scrollY;
    const context = { from: "list", view: source, filter: historyFilter, scrollY: listScrollY.current };
    if (task.source === "legacy_daily") setLegacyTask({ ...task, kind: "legacy_task" });
    else openTask(task, context);
  }

  if (activeSop) return <SopTaskReader sop={activeSop} token={token} onBack={() => setActiveSop(null)} />;

  if (detailLoading && !detail) return <section className="crew-ops-mobile" aria-busy="true">
    <CrewMobileDetailHeader title={initialTarget?.row?.name || t("tasks.task")} onBack={returnFromDetail} variant="workflow" />
    <div className="crew-ops-loading">{t("common.loading")}</div>
    {error ? <div className="crew-v2-error">{error}</div> : null}
  </section>;

  if (detail) {
    const blocks = (detail.blocks || []).map(normalizeTaskBlock);
    const actionable = blocks.filter(isTaskBlockActionable);
    const completed = actionable.filter(isTaskBlockComplete).length;
    const unavailable = isCrewTaskUnavailable(detail, availabilityNow);
    const canRedo = !unavailable && detailContext?.view !== "history" && ["not_started", "in_progress"].includes(detail.status);
    return <section className="crew-ops-mobile">
      <CrewMobileDetailHeader title={detail.name} onBack={returnFromDetail} variant="workflow" />
      <CrewTaskPriority priority={detail.priority} />
      <TaskDetailSummary detail={detail} completed={completed} total={actionable.length} now={availabilityNow} canRedo={canRedo} onRedo={() => setRedoOpen(true)} />
      {unavailable ? <TaskAvailabilityNotice availableFrom={detail.available_from} /> : null}
      <div className="crew-ops-items">{blocks.map((block, index) => <CrewTaskBlockRenderer key={block.id || index} block={block} index={index} mode={detailContext?.view === "history" || ["completed", "completed_with_exceptions", "review_required"].includes(detail.status) ? "readonly" : "interactive"} allowException={detail.allow_exception} unavailable={unavailable} saving={savingBlockId === block.id} onSubmit={submitBlock} onOpenSop={openSop} />)}</div>
      {error ? <div className="crew-v2-error">{error}</div> : null}
      {redoOpen ? <CrewMobileModal title={t("tasks.redoTitle")} closeDisabled={redoSaving} onClose={() => !redoSaving && setRedoOpen(false)}><div className="crew-ops-redo-dialog"><p>{t("tasks.redoBody")}</p><div><button type="button" className="crew-mobile-secondary" disabled={redoSaving} onClick={() => setRedoOpen(false)}>{t("common.cancel")}</button><button type="button" className="crew-mobile-secondary crew-ops-redo-confirm" disabled={redoSaving} onClick={resetTask}><RotateCcw size={16} />{redoSaving ? t("common.saving") : t("tasks.redo")}</button></div></div></CrewMobileModal> : null}
    </section>;
  }

  const taskData = allTaskData || data || {};
  const activeGroups = activeTaskResponsibilities(localizedAllTasks, t, availabilityNow)
    .map(([label, tasks]) => [label, tasks.filter((task) => taskMatchesStatus(task, activeFilter, availabilityNow))]).filter(([, tasks]) => tasks.length);
  const historical = historyTasks(localizedHistoryTasks, historyFilter, new Date(availabilityNow));
  const filterOptions = [
    ["all", t("tasks.all")], ["upcoming", t("status.upcoming")], ["start_now", t("status.start_now")], ["in_progress", t("status.in_progress")], ["completed", t("tasks.completedFilter")], ["overdue", t("tasks.overdue")], ["exception", t("tasks.exception")],
  ];
  return <section className="crew-ops-mobile">
    <CrewMobileDetailHeader title={t("tasks.title")} onBack={onBack} variant="workflow" />
    <div className="crew-ops-context"><span><Store size={17} /><strong>{taskData?.outlet?.name || t("home.yourOutlet")}</strong></span><small>{(taskData?.attendance_context || data?.attendance_context)?.on_shift ? t("home.onShift") : t("tasks.outsideShift")}</small></div>
    <div className="crew-ui-tabs crew-ops-top-tabs" role="tablist" aria-label={t("tasks.title")}><button type="button" role="tab" aria-selected={taskView === "active"} className={taskView === "active" ? "is-active" : ""} onClick={() => setTaskView("active")}>{t("tasks.active")}</button><button type="button" role="tab" aria-selected={taskView === "history"} className={taskView === "history" ? "is-active" : ""} onClick={() => setTaskView("history")}>{t("tasks.history")}</button></div>
    <div className="crew-ops-filters" role="tablist" aria-label={t(taskView === "history" ? "tasks.history" : "tasks.active")}>{filterOptions.map(([value, label]) => { const selected = (taskView === "history" ? historyFilter : activeFilter) === value; return <button key={value} type="button" role="tab" aria-selected={selected} className={selected ? "is-active" : ""} onClick={() => taskView === "history" ? setHistoryFilter(value) : setActiveFilter(value)}>{label}</button>; })}</div>
    {taskView === "history" ? <>
      {historyLoading ? <div className="crew-ops-loading">{t("common.loading")}</div> : historical.length ? <section className="crew-ops-group">{historical.map((task) => <TaskRow key={`${task.source}-${task.id}`} task={task} t={t} now={availabilityNow} history onOpen={() => openFromList(task, "history")} />)}</section> : <section className="crew-ops-group"><Empty text={t("tasks.noHistory")} /></section>}
    </> : (loading && !allTaskData) || allTasksLoading ? <div className="crew-ops-loading">{t("common.loading")}</div> : activeGroups.length ? activeGroups.map(([label, groupTasks]) => <section className="crew-ops-group" key={label}><CrewSectionHeader density="operational" title={label} trailing={<span className="crew-ui-count">{groupTasks.length}</span>} />{groupTasks.map((task) => <TaskRow key={`${task.source}-${task.id}`} task={task} t={t} now={availabilityNow} onOpen={() => openFromList(task, "active")} />)}</section>) : <section className="crew-ops-group"><Empty text={t("tasks.noActiveTasks")} /></section>}
    {error ? <div className="crew-v2-error">{error}</div> : null}
    {legacyTask ? <LegacyTaskModal item={legacyTask} now={availabilityNow} reason={reason} setReason={setReason} note={note} setNote={setNote} saving={saving} onClose={() => setLegacyTask(null)} onSubmit={submitLegacy} /> : null}
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
    <div className="crew-task-preview-nav"><CrewMobileDetailHeader title={task.name || t("tasks.untitled")} onBack={onBack || (() => {})} variant="workflow" /></div>
    <div className="crew-ops-detail-head"><strong>{t("tasks.preview")}</strong><small>{t("tasks.completedCount", { completed, total: actionable.length })}</small><div className="crew-task-preview-progress"><span style={{ width: `${actionable.length ? (completed / actionable.length) * 100 : 100}%` }} /></div></div>
    {previewComplete ? <TaskCompletionState status={task.manager_review_required ? "review_required" : "completed"} completed={completed} total={actionable.length} /> : null}
    <div className="crew-ops-items">{blocks.map((block, index) => <CrewTaskBlockRenderer key={block.id || index} block={{ ...block, status: previewStatuses[block.id] || "pending" }} index={index} mode="preview" allowException={task.allow_exception} onPreviewChange={previewSubmit} onOpenSop={(sop) => setSopMessage(t("tasks.sopReadOnly", { title: sop?.title || t("tasks.publishedSop") }))} />)}</div>
    {sopMessage ? <p className="crew-task-preview-only">{sopMessage}</p> : null}
    <p className="crew-task-preview-only">{t("tasks.previewOnly")}</p>
  </section>;
}

export function isCrewTaskUnavailable(task, now = Date.now()) {
  const availableAt = Date.parse(task?.available_from || "");
  return Number.isFinite(availableAt) && availableAt > now;
}

function TaskAvailabilityNotice({ availableFrom }) {
  const { t } = useTranslation();
  const time = availableFrom ? formatCrewTime(availableFrom).toLowerCase() : null;
  return <section className="crew-ui-note crew-ui-note--warning crew-ops-availability-notice" role="status">
    <Clock3 size={17} aria-hidden="true" />
    <span><strong>{time ? t("tasks.availableAt", { time }) : t("tasks.notAvailableYet")}</strong><small>{t("tasks.availableWhenScheduled")}</small></span>
  </section>;
}

function TaskCompletionState({ status, completed, total, completedAt }) {
  const { t } = useTranslation();
  const review = status === "review_required";
  const time = completedAt ? formatCrewTime(completedAt).toLowerCase() : null;
  return <section className="crew-task-completion-state" aria-live="polite"><CheckCircle2 size={21} /><span><strong>{review ? t("tasks.submittedReview") : t("tasks.completed")}</strong><small>{t("tasks.completedCount", { completed, total })}{time ? ` · ${t("tasks.completedAt", { time })}` : ""}</small></span></section>;
}

function TaskDetailSummary({ detail, completed, total, now, canRedo, onRedo }) {
  const { t } = useTranslation();
  const isFinal = ["completed", "completed_with_exceptions", "review_required"].includes(detail.status);
  const presentationStatus = taskPresentationStatus({ ...detail, completed_count: completed }, now);
  const singleComplete = isFinal && total === 1 && completed === 1;
  const assignment = assignmentLabel(detail.assignment, t);
  const completion = detail.completion_audit;
  const contributors = detail.completion_contributors;
  const completedBy = Array.isArray(contributors) ? contributors.map((person) => person.employee_name).filter(Boolean).join(", ") : completion?.employee_name;
  return <section className="crew-ops-detail-summary" aria-label={t("tasks.summary")}>
    <div className="crew-ops-detail-summary-status"><CrewStatusBadge tone={taskStatusTone(presentationStatus)}>{translateStatus(presentationStatus, t)}</CrewStatusBadge>{canRedo ? <button type="button" className="crew-mobile-ghost crew-ops-redo" onClick={onRedo}><RotateCcw size={15} />{t("tasks.redo")}</button> : null}</div>
    {assignment ? <DetailMeta label={t("tasks.assignedTo")} value={assignment} /> : null}
    {isFinal && completedBy ? <DetailMeta label={t("tasks.completedBy")} value={completedBy} supporting={formatTaskAuditDate(detail.completed_at || completion?.completed_at)} /> : null}
    {!singleComplete ? <><small>{t("tasks.completedCount", { completed, total })}</small><div className="crew-task-preview-progress"><span style={{ width: `${total ? (completed / total) * 100 : 100}%` }} /></div></> : null}
  </section>;
}

function DetailMeta({ label, value, supporting }) {
  return <div className="crew-ops-detail-meta"><span>{label}</span><strong>{value}</strong>{supporting ? <small>{supporting}</small> : null}</div>;
}

function assignmentLabel(assignment, t) {
  if (!assignment) return null;
  if (assignment.kind === "individual") return assignment.is_current_employee ? t("tasks.you") : assignment.employee_name || null;
  if (assignment.kind === "position") return assignment.label ? t("tasks.positionTeam", { label: assignment.label }) : t("tasks.sharedTask");
  if (assignment.kind === "group") return assignment.label ? t("tasks.groupTeam", { label: assignment.label }) : t("tasks.sharedTask");
  return assignment.label ? t("tasks.outletTeam", { label: assignment.label }) : t("tasks.sharedTask");
}

function formatTaskAuditDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${formatCrewDate(date, { day: "numeric", month: "short", year: "numeric" })} · ${formatCrewTime(date).toLowerCase()}`;
}

function applyTaskBlockResponse(detail, blockId, saved, response, exceptionReason, note) {
  if (!detail || !saved?.status) return detail;
  return {
    ...detail,
    status: saved.task_status || detail.status,
    completed_at: saved.task_completed_at || detail.completed_at,
    blocks: (detail.blocks || []).map((block) => block.id === blockId ? {
      ...block,
      status: saved.status,
      response: response || block.response,
      exception_reason: saved.status === "exception" ? exceptionReason || null : block.exception_reason,
      note: note || block.note,
    } : block),
  };
}

function SopTaskReader({ sop, token, onBack }) {
  const { t } = useTranslation();
  return <section className="crew-ops-mobile crew-learning-reader"><CrewMobileDetailHeader title={sop.title || t("learn.readerFallback")} onBack={onBack} /><div className="crew-ops-detail-head"><span>{sop.category || t("learn.readerFallback")}</span><strong>{t("learn.version", { version: sop.version })}</strong><small>{t("learn.referencedTask")}</small></div><CrewSopDocument sections={sop.sections || []} token={token} sopVersionId={sop.id} className="is-mobile" /></section>;
}

function LegacyTaskModal({ item, now, reason, setReason, note, setNote, saving, onClose, onSubmit }) {
  const { t } = useTranslation();
  const reasons = ["equipment_issue", "stock_unavailable", "area_unavailable", "manager_instruction", "other"];
  return <CrewBottomSheet title={item.name || item.title} description={item.description || t("tasks.legacyInstruction")} onClose={onClose} closeDisabled={saving} contentClassName="crew-ops-legacy-content"><CrewStatusBadge tone={taskStatusTone(taskPresentationStatus(item, now))}>{translateStatus(taskPresentationStatus(item, now), t)}</CrewStatusBadge><button className="crew-mobile-primary" disabled={saving} onClick={() => onSubmit("completed")}>{t("status.completed")}</button><button className="crew-ops-choice crew-mobile-secondary is-warning" type="button" onClick={() => setReason(reason || "equipment_issue")}><AlertTriangle size={18} /> {t("tasks.recordException")}</button>{reason ? <><label className="crew-ui-form-field">{t("tasks.chooseReason")}<select className="crew-ui-field" value={reason} onChange={(event) => setReason(event.target.value)}>{reasons.map((value) => <option key={value} value={value}>{t(`tasks.reasons.${value}`)}</option>)}</select></label><label className="crew-ui-form-field">{t("tasks.note")}<textarea className="crew-ui-field" value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="crew-mobile-primary" disabled={saving} onClick={() => onSubmit("exception")}>{t("tasks.submitException")}</button></> : null}</CrewBottomSheet>;
}

function Empty({ text }) { return <div className="crew-ui-functional-surface crew-ops-empty"><ClipboardCheck size={22} /><p>{text}</p></div>; }

function taskStatusTone(status) {
  if (["completed", "completed_with_exceptions"].includes(status)) return "success";
  if (["exception", "needs_attention", "review_required", "overdue"].includes(status)) return "warning";
  return "neutral";
}

function TaskRow({ task, t, now, history = false, onOpen }) {
  const status = taskPresentationStatus(task, now);
  const hasProgress = Number(task.block_count || 0) > 0;
  const progress = hasProgress ? t("tasks.completedCount", { completed: task.completed_count || 0, total: task.block_count }) : null;
  const historyContext = [
    task.business_date ? formatCrewDate(new Date(`${task.business_date}T00:00:00+08:00`), { day: "numeric", month: "short" }) : null,
    task.completed_at ? `${translateStatus(status, t)} ${formatCrewTime(task.completed_at).toLowerCase()}` : translateStatus(status, t),
  ].filter(Boolean).join(" · ");
  const tone = taskStatusTone(status);
  return <button type="button" className={`crew-ops-task is-${status}`} onClick={onOpen}>
    <span className={`crew-ui-icon-container crew-ui-icon-container--compact${tone === "success" ? " is-success" : tone === "warning" ? " is-warning" : ""}`}>{task.task_type === "health_check" ? <HeartPulse size={17} /> : task.task_type === "checklist" ? <ClipboardCheck size={17} /> : <ListChecks size={17} />}</span>
    <span><CrewTaskHeading title={task.name} />
      {history ? <small>{[historyContext, progress].filter(Boolean).join(" · ") || task.description || String(task.task_type).replaceAll("_", " ")}</small> : hasProgress ? <small>{progress}</small> : task.description ? <small>{task.description}</small> : null}
      {!history ? <small className="crew-ops-schedule">{formatTaskSchedule(task, t)}</small> : null}
    </span>
    <CrewTaskMetadata priority={task.priority} tone={tone}>{translateStatus(status, t)}</CrewTaskMetadata><ChevronRight aria-hidden="true" size={17} />
  </button>;
}
