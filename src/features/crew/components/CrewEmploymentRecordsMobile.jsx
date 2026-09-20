import { AlertTriangle, ChevronRight, FileCheck2, Files } from "lucide-react";
import { useTranslation } from "react-i18next";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewMobilePage, CrewPageSection } from "./CrewMobileUI.jsx";
import "./CrewEmploymentDocumentsMobile.css";

export default function CrewEmploymentRecordsMobile({ onBack, navigate, disciplinary }) {
  const { t } = useTranslation();
  const rows = [
    { id: "employment-documents", icon: Files, title: t("employmentRecords.contracts"), body: t("employmentRecords.contractsBody") },
    { id: "compliance", icon: FileCheck2, title: t("employmentRecords.compliance"), body: t("employmentRecords.complianceBody") },
    { id: "disciplinary", icon: AlertTriangle, title: t("employmentRecords.warnings"), body: t("employmentRecords.warningsBody"), count: Math.max(0, Number(disciplinary?.unread_count) || 0) },
  ];
  return <CrewMobilePage className="crew-employment-records-page"><CrewMobileDetailHeader title={t("employmentRecords.title")} onBack={onBack} /><p className="crew-employment-records-intro">{t("employmentRecords.intro")}</p><CrewPageSection><div className="crew-employment-records-list">{rows.map(({ id, icon: Icon, title, body, count }) => <button type="button" key={id} onClick={() => navigate(id)}><span className="crew-ui-icon-container"><Icon size={20} /></span><span><strong>{title}</strong><small>{body}</small></span><span className="crew-employment-records-end">{count > 0 ? <span className="crew-ui-count">{count}</span> : null}<ChevronRight size={19} /></span></button>)}</div></CrewPageSection></CrewMobilePage>;
}
