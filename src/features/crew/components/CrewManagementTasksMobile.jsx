import { useEffect, useState } from "react";
import { ClipboardCheck, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { crewService } from "../../../services/crewService.js";
import useCrewTaskPresentationTime from "../hooks/useCrewTaskPresentationTime.js";
import useCrewTaskTitles from "../hooks/useCrewTaskTitles.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewEmptyState, CrewMobilePage, CrewStatusBadge } from "./CrewMobileUI.jsx";
import CrewChoicePicker from "./CrewChoicePicker.jsx";
import CrewTaskBlockRenderer, { isTaskBlockActionable, isTaskBlockComplete, normalizeTaskBlock } from "./CrewTaskBlockRenderer.jsx";
import { TaskDetailSummary } from "./CrewOperationsMobile.jsx";
import { applyTaskLocalization } from "../utils/localizedContent.js";
import { translateStatus } from "../utils/crewI18n.js";
import { taskPresentationStatus } from "../utils/taskSchedule.js";
import { formatTime } from "../utils/crewMobile.js";

export default function CrewManagementTasksMobile({ token, outletId, data, initialTarget, onBack }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || "en";
  const tasks = useCrewTaskTitles(token, data?.tasks || []);
  const [target, setTarget] = useState(initialTarget?.row || null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [employeeId, setEmployeeId] = useState(null);
  const [now] = useCrewTaskPresentationTime([...tasks, detail]);
  useEffect(() => { if (initialTarget?.row) setTarget(initialTarget.row); }, [initialTarget]);
  useEffect(() => {
    let current = true;
    setDetail(null); setError(""); setEmployeeId(null);
    if (target) crewService.managementTaskDetail(token, outletId, target.id, target.source || "instance")
      .then(async (value) => {
        const localized = value.template_id ? (await crewService.localizedContentForCrew(token, "task", [value.template_id], language))[value.template_id] || {} : {};
        const translated = applyTaskLocalization(value, localized);
        if (current) setDetail({ ...translated, executions: (value.executions || []).map((execution) => ({ ...execution, detail: applyTaskLocalization(execution.detail, localized) })) });
      })
      .catch(() => { if (current) setError(t("tasks.detailUnavailable")); });
    return () => { current = false; };
  }, [token, outletId, target, retry, t, language]);
  if (target) {
    const executions = detail?.executions || [];
    const execution = executions.find((row) => row.employee_id === employeeId) || executions[0];
    const presented = execution?.detail || detail;
    const blocks = (presented?.blocks || []).map(normalizeTaskBlock);
    const actionable = blocks.filter(isTaskBlockActionable);
    return <section className="crew-ops-mobile"><CrewMobileDetailHeader title={presented?.name || target.name || t("tasks.title")} onBack={() => setTarget(null)} />
      {!detail && !error ? <div role="status">{t("common.loading")}</div> : null}
      {error ? <div role="alert" className="crew-v2-error"><p>{error}</p><button type="button" className="crew-mobile-secondary" onClick={() => setRetry((value) => value + 1)}>{t("common.retry")}</button></div> : null}
      {presented && <><p className="crew-list-secondary">{t("tasks.readOnly")}</p>
        {executions.length > 0 && <CrewChoicePicker label={t("tasks.assignedCrew")} value={execution.employee_id} options={executions.map((row) => ({ value: row.employee_id, label: row.employee_name }))} onChange={setEmployeeId} />}
        <TaskDetailSummary detail={presented} completed={actionable.filter(isTaskBlockComplete).length} total={actionable.length} now={now} canRedo={false} />
        {presented.description && <p>{presented.description}</p>}
        {presented.note && <p>{presented.note}</p>}
        {presented.completion_actor && <small>{t("tasks.completedBy")} {presented.completion_actor}</small>}
        <div className="crew-ops-items">{blocks.map((block, index) => <section key={`${execution?.employee_id || "team"}-${block.id}`}>
          <CrewTaskBlockRenderer block={block} index={index} mode="readonly" />
          {block.response_actor && <small className="crew-list-secondary">{block.response_actor.employee_name}{block.completed_at ? ` · ${formatTime(block.completed_at)}` : ""}</small>}
        </section>)}</div>
      </>}
    </section>;
  }
  return <CrewMobilePage className="crew-management-tasks">
    <CrewMobileDetailHeader title={t("tasks.title")} onBack={onBack} />
    <div className="crew-home-list">
      {tasks.map((task) => <button type="button" onClick={() => setTarget(task)} className="crew-home-task" key={`${task.source}-${task.id}`}>
        <i className="crew-ui-icon-container crew-ui-icon-container--compact"><ClipboardCheck size={18} /></i>
        <span className="crew-home-task-copy"><strong>{task.name}</strong>
          {task.block_count > 0 && <small>{t("tasks.completedCount", { completed: task.completed_count || 0, total: task.block_count })}</small>}
          {task.due_at && <small>{t("tasks.dueLabel")} {formatTime(task.due_at)}</small>}
        </span>
        <CrewStatusBadge tone={taskPresentationStatus(task, now) === "overdue" ? "danger" : task.status === "completed" ? "success" : "neutral"}>{translateStatus(taskPresentationStatus(task, now), t)}</CrewStatusBadge><ChevronRight size={17} />
      </button>)}
      {!tasks.length && <CrewEmptyState title={t("tasks.noOutletTasks")} />}
    </div>
  </CrewMobilePage>;
}
