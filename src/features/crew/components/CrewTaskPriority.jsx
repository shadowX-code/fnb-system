import { useTranslation } from "react-i18next";
import { CrewStatusBadge } from "./CrewMobileUI.jsx";
import "./CrewTaskPriority.css";

export function CrewTaskHeading({ title, priority }) {
  return <span className="crew-task-heading"><strong className="crew-list-dense-primary" title={title}>{title}</strong><CrewTaskPriority priority={priority} /></span>;
}

export default function CrewTaskPriority({ priority }) {
  const { t } = useTranslation();
  if (!["important", "critical"].includes(priority)) return null;
  return <CrewStatusBadge tone={priority === "critical" ? "danger" : "warning"}>{t(`tasks.priority.${priority}`)}</CrewStatusBadge>;
}
