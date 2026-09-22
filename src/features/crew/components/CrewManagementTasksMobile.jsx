import { ClipboardCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewEmptyState, CrewMobilePage, CrewStatusBadge } from "./CrewMobileUI.jsx";
import { translateStatus } from "../utils/crewI18n.js";
import { formatTime } from "../utils/crewMobile.js";

export default function CrewManagementTasksMobile({ data, onBack }) {
  const { t } = useTranslation();
  return <CrewMobilePage className="crew-management-tasks">
    <CrewMobileDetailHeader title={t("tasks.title")} onBack={onBack} />
    <div className="crew-home-list">
      {(data?.tasks || []).map((task) => <div className="crew-home-task" key={`${task.source}-${task.id}`}>
        <i className="crew-ui-icon-container crew-ui-icon-container--compact"><ClipboardCheck size={18} /></i>
        <span className="crew-home-task-copy"><strong>{task.name}</strong>
          {task.due_at ? <small>{t("tasks.dueLabel")} {formatTime(task.due_at)}</small> : null}
        </span>
        <CrewStatusBadge tone={task.status === "overdue" ? "danger" : task.status === "completed" ? "success" : "neutral"}>
          {translateStatus(task.status, t)}
        </CrewStatusBadge>
      </div>)}
      {!data?.tasks?.length ? <CrewEmptyState title={t("home.noTasks")} /> : null}
    </div>
  </CrewMobilePage>;
}
