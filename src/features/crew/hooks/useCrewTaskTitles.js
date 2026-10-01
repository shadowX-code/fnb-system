import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { crewService } from "../../../services/crewService.js";
import { applyTaskTitleLocalization } from "../utils/localizedContent.js";

export default function useCrewTaskTitles(token, tasks = []) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || "en";
  const versionKey = [...new Set(tasks.map((task) => task.template_id).filter(Boolean))].sort().join(",");
  const [resolved, setResolved] = useState(null);
  useEffect(() => {
    let active = true;
    if (!token || !versionKey) return undefined;
    const ids = versionKey.split(",");
    (async () => {
      const localized = {};
      for (let offset = 0; offset < ids.length; offset += 100) {
        Object.assign(localized, await crewService.localizedContentForCrew(token, "task", ids.slice(offset, offset + 100), language));
      }
      if (active) setResolved({ token, language, versionKey, localized });
    })().catch(() => { if (active) setResolved(null); });
    return () => { active = false; };
  }, [token, language, versionKey]);
  const localizations = resolved?.token === token && resolved?.language === language && resolved?.versionKey === versionKey ? resolved.localized : {};
  return useMemo(() => tasks.map((task) => applyTaskTitleLocalization(task, localizations[task.template_id] || {})), [tasks, localizations]);
}
