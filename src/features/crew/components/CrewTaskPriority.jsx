import { useTranslation } from "react-i18next";
import { CrewStatusBadge } from "./CrewMobileUI.jsx";
import "./CrewTaskPriority.css";

export function CrewTaskHeading({ title }) {
  return <span className="crew-task-heading"><strong className="crew-list-dense-primary">{title}</strong></span>;
}

export function CrewTaskMetadata({ priority, tone, children }) {
  return <span className="crew-task-metadata"><CrewTaskPriority priority={priority} /><CrewStatusBadge tone={tone}>{children}</CrewStatusBadge></span>;
}

export default function CrewTaskPriority({ priority }) {
  const { t } = useTranslation();
  if (!["important", "critical"].includes(priority)) return null;
  return <span className={`crew-task-priority is-${priority}`}><i aria-hidden="true" />{t(`tasks.priority.${priority}`)}</span>;
}
