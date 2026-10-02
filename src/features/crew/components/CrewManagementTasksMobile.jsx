import useCrewTaskPresentationTime from "../hooks/useCrewTaskPresentationTime.js";
import { ClipboardCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewEmptyState, CrewMobilePage, CrewStatusBadge } from "./CrewMobileUI.jsx";
import { translateStatus } from "../utils/crewI18n.js";
import { taskPresentationStatus } from "../utils/taskSchedule.js";
import { formatTime } from "../utils/crewMobile.js";

export default function CrewManagementTasksMobile({ data, onBack }) {
  const { t } = useTranslation();
  const [now] = useCrewTaskPresentationTime(data?.tasks || []);
  return <CrewMobilePage className="crew-management-tasks">
    <CrewMobileDetailHeader title={t("tasks.title")} onBack={onBack} />
    <div className="crew-home-list">
      {(data?.tasks || []).map((task) => <div className="crew-home-task" key={`${task.source}-${task.id}`}>
        <i className="crew-ui-icon-container crew-ui-icon-container--compact"><ClipboardCheck size={18} /></i>
        <span className="crew-home-task-copy"><strong>{task.name}</strong>
          {task.due_at ? <small>{t("tasks.dueLabel")} {formatTime(task.due_at)}</small> : null}
        </span>
        <CrewStatusBadge tone={taskPresentationStatus(task, now) === "overdue" ? "danger" : task.status === "completed" ? "success" : "neutral"}>
          {translateStatus(taskPresentationStatus(task, now), t)}
        </CrewStatusBadge>
      </div>)}
      {!data?.tasks?.length ? <CrewEmptyState title={t("tasks.noOutletTasks")} /> : null}
    </div>
  </CrewMobilePage>;
}
