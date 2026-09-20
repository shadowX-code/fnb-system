import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileCheck2, RotateCcw, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { employeeComplianceService } from "../../../services/employeeComplianceService.js";
import { optimizeImageBlob } from "../../../utils/imageUpload.js";
import CrewDatePicker from "./CrewDatePicker.jsx";
import CrewEvidencePhotoPicker from "./CrewEvidencePhotoPicker.jsx";
import { CrewEmptyState, CrewMobilePage, CrewStatusBadge } from "./CrewMobileUI.jsx";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import CrewMobileModal from "./CrewMobileModal.jsx";
import "./CrewComplianceMobile.css";

const statusTone = { verified: "success", expiring_soon: "warning", expired: "danger", rejected: "danger", pending_verification: "warning", missing: "neutral" };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default function CrewComplianceMobile({ token, onBack }) {
  const { t } = useTranslation();
  const [requirements, setRequirements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [expiryDate, setExpiryDate] = useState(today());
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  async function load() {
    setLoading(true); setError("");
    try { setRequirements((await employeeComplianceService.crewOverview(token)).requirements || []); }
    catch (cause) { setError(cause.message || t("compliance.loadError")); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [token]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function choosePhoto(nextFile) {
    setPreparing(true); setError("");
    try {
      const prepared = await optimizeImageBlob(nextFile, { maxLongSide: 2000, quality: 0.88 });
      const next = new File([prepared.blob], "compliance-evidence.webp", { type: prepared.contentType });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setFile(next); setPreviewUrl(URL.createObjectURL(next)); setRequestId(crypto.randomUUID());
    } catch { setError(t("compliance.photoError")); }
    finally { setPreparing(false); }
  }
  function closeForm() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelected(null); setFile(null); setPreviewUrl(""); setError(""); setRequestId(crypto.randomUUID());
  }
  async function submit() {
    if (!file) { setError(t("compliance.photoRequired")); return; }
    if (selected.requires_expiry && !expiryDate) { setError(t("compliance.expiryRequired")); return; }
    setSubmitting(true); setError("");
    try {
      await employeeComplianceService.submit({ token, requirementCode: selected.requirement_code, expiryDate: selected.requires_expiry ? expiryDate : null, requestId, file });
      closeForm(); await load();
    } catch (cause) { setError(cause.message || t("compliance.submitError")); }
    finally { setSubmitting(false); }
  }
  const ordered = useMemo(() => [...requirements], [requirements]);

  return <CrewMobilePage className="crew-compliance-page">
    <CrewMobileDetailHeader title={t("compliance.title")} onBack={onBack} />
    <p className="crew-compliance-intro">{t("compliance.intro")}</p>
    {loading ? <div className="crew-v2-state" role="status">{t("common.loading")}</div> : null}
    {error && !selected ? <div className="crew-v2-error" role="alert">{error}<button type="button" onClick={load}>{t("common.retry")}</button></div> : null}
    {!loading && !ordered.length ? <CrewEmptyState title={t("compliance.empty")} /> : null}
    <div className="crew-compliance-list">{ordered.map((item) => {
      const status = item.status || "missing";
      const canSubmit = ["missing", "expired", "rejected", "verified", "expiring_soon"].includes(status);
      return <article className="crew-ui-functional-surface crew-compliance-card" key={item.requirement_code}>
        <header><span className="crew-ui-icon-container"><FileCheck2 size={20} /></span><div><h2>{item.requirement_name}</h2><p>{item.requires_expiry ? t("compliance.photoExpiry") : t("compliance.photoOnly")}</p></div><CrewStatusBadge tone={statusTone[status]}>{t(`compliance.status.${status}`)}</CrewStatusBadge></header>
        {item.effective_expiry_date ? <p className="crew-compliance-expiry">{t("compliance.expires", { date: new Date(`${item.effective_expiry_date}T12:00:00+08:00`).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" }) })}</p> : null}
        {item.rejection_reason ? <div className="crew-compliance-rejection"><strong>{t("compliance.rejectedReason")}</strong><span>{item.rejection_reason}</span></div> : null}
        {item.replacement_pending ? <div className="crew-compliance-effective"><CheckCircle2 size={17} /><span>{t("compliance.effectiveWhilePending")}</span></div> : null}
        {status === "pending_verification" && !item.replacement_pending ? <p className="crew-compliance-note">{t("compliance.pendingCopy")}</p> : null}
        {canSubmit ? <button className={status === "rejected" ? "crew-mobile-primary" : "crew-mobile-secondary"} type="button" onClick={() => { setSelected(item); setExpiryDate(item.effective_expiry_date || today()); }}>
          {status === "rejected" ? <RotateCcw size={17} /> : <Upload size={17} />}{status === "rejected" ? t("compliance.resubmit") : item.effective_submission_id ? t("compliance.replace") : t("compliance.submit")}
        </button> : null}
      </article>;
    })}</div>
    {selected ? <CrewMobileModal title={selected.requirement_name} description={selected.effective_submission_id ? t("compliance.replaceHelp") : t("compliance.submitHelp")} onClose={closeForm} footer={<><button className="crew-mobile-ghost" type="button" disabled={submitting} onClick={closeForm}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" disabled={submitting || preparing || !file} onClick={submit}>{submitting ? t("common.saving") : t("compliance.sendForReview")}</button></>}>
      <div className="crew-compliance-form">
        <CrewEvidencePhotoPicker label={t("compliance.evidencePhoto")} optional={false} previewUrl={previewUrl} previewAlt={t("compliance.evidencePreview")} onChoose={choosePhoto} onRemove={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setFile(null); setPreviewUrl(""); setRequestId(crypto.randomUUID()); }} busy={preparing} busyLabel={t("compliance.preparingPhoto")} />
        {selected.requires_expiry ? <CrewDatePicker label={t("compliance.expiryDate")} value={expiryDate} min={today()} onChange={setExpiryDate} /> : null}
        {selected.effective_submission_id ? <div className="crew-compliance-effective"><CheckCircle2 size={17} /><span>{t("compliance.currentRemainsEffective")}</span></div> : null}
        {error ? <div className="crew-v2-error" role="alert">{error}</div> : null}
      </div>
    </CrewMobileModal> : null}
  </CrewMobilePage>;
}
