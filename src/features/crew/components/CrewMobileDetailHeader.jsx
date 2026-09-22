import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";

export default function CrewMobileDetailHeader({ title, subtitle = null, onBack, action = null, variant = "detail", className = "" }) {
  const { t } = useTranslation();
  return (
    <header className={`crew-v2-page-header crew-mobile-detail-header is-${variant} ${className}`.trim()}>
      <div>
        <button type="button" onClick={onBack} aria-label={t("common.back")}>
          <ArrowLeft size={19} />
        </button>
        <span className="crew-mobile-detail-copy"><h1 className="crew-type-detail-title" title={title}>{title}</h1>{subtitle ? <p className="crew-type-secondary">{subtitle}</p> : null}</span>
      </div>
      {action ? <span className="crew-mobile-detail-header-action">{action}</span> : null}
    </header>
  );
}
