import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";

export default function CrewMobileDetailHeader({ title, onBack, action = null, className = "" }) {
  const { t } = useTranslation();
  return (
    <header className={`crew-v2-page-header crew-mobile-detail-header ${className}`.trim()}>
      <div>
        <button type="button" onClick={onBack} aria-label={t("common.back")}>
          <ArrowLeft size={19} />
        </button>
        <h1 className="crew-type-detail-title" title={title}>{title}</h1>
      </div>
      {action ? <span className="crew-mobile-detail-header-action">{action}</span> : null}
    </header>
  );
}
