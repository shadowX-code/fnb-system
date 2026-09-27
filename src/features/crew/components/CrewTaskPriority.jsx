import { useTranslation } from "react-i18next";
import { CrewStatusBadge } from "./CrewMobileUI.jsx";

export default function CrewTaskPriority({ priority }) {
  const { t } = useTranslation();
  if (!["important", "critical"].includes(priority)) return null;
  return <CrewStatusBadge tone={priority === "critical" ? "danger" : "warning"}>{t(`tasks.priority.${priority}`)}</CrewStatusBadge>;
}
