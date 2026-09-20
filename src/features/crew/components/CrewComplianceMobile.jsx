import { useEffect, useState } from "react";
import { CheckCircle2, Eye, FileCheck2, RotateCcw, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { employeeComplianceService } from "../../../services/employeeComplianceService.js";
import { optimizeImageBlob } from "../../../utils/imageUpload.js";
import { formatCrewDate, formatCrewOperationalDateTime } from "../utils/crewI18n.js";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewDatePicker from "./CrewDatePicker.jsx";
import CrewEvidencePhotoPicker from "./CrewEvidencePhotoPicker.jsx";
import CrewImageViewer from "./CrewImageViewer.jsx";
import { CrewEmptyState, CrewMobilePage, CrewStatusBadge } from "./CrewMobileUI.jsx";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import "./CrewComplianceMobile.css";

const statusTone = { verified: "success", expiring_soon: "warning", expired: "danger", rejected: "danger", pending_verification: "warning", missing: "neutral" };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const displayDate = (value) => formatCrewDate(value ? `${value}T12:00:00+08:00` : null, { day: "2-digit", month: "short", year: "numeric" });
const submissionIdFor = (item) => item.status === "pending_verification"
  ? item.pending_submission_id
  : item.status === "rejected"
    ? item.rejected_submission_id
    : item.effective_submission_id;

export default function CrewComplianceMobile({ token, onBack }) {
  const { t } = useTranslation();
  const [requirements, setRequirements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [formItem, setFormItem] = useState(null);
  const [detailItem, setDetailItem] = useState(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [expiryDate, setExpiryDate] = useState(today());
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState("");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  async function load() {
    setLoading(true); setPageError("");
    try { setRequirements((await employeeComplianceService.crewOverview(token)).requirements || []); }
    catch (cause) { setPageError(cause.message || t("compliance.loadError")); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [token]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => {
    const submissionId = detailItem ? submissionIdFor(detailItem) : null;
    if (!submissionId) return;
    let active = true;
    setEvidenceLoading(true); setEvidenceError(""); setEvidenceUrl("");
    employeeComplianceService.crewEvidenceUrl(token, submissionId)
      .then((url) => { if (active) setEvidenceUrl(url); })
      .catch(() => { if (active) setEvidenceError(t("compliance.evidenceError")); })
      .finally(() => { if (active) setEvidenceLoading(false); });
    return () => { active = false; };
  }, [detailItem, token, t]);

  async function choosePhoto(nextFile) {
    setPreparing(true); setFormError("");
    try {
      const prepared = await optimizeImageBlob(nextFile, { maxLongSide: 2000, quality: 0.88 });
      const next = new File([prepared.blob], "compliance-evidence.webp", { type: prepared.contentType });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setFile(next); setPreviewUrl(URL.createObjectURL(next)); setRequestId(crypto.randomUUID());
    } catch { setFormError(t("compliance.photoError")); }
    finally { setPreparing(false); }
  }

  function openForm(item) {
    const currentExpiry = item.effective_expiry_date && item.effective_expiry_date >= today() ? item.effective_expiry_date : today();
    setFormItem(item); setExpiryDate(currentExpiry); setFormError(""); setFile(null); setPreviewUrl(""); setRequestId(crypto.randomUUID());
  }

  function closeForm() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFormItem(null); setFile(null); setPreviewUrl(""); setFormError(""); setRequestId(crypto.randomUUID());
  }

  function closeDetail() {
    setDetailItem(null); setEvidenceUrl(""); setEvidenceError(""); setViewerOpen(false);
  }

  async function submit() {
    if (!file) { setFormError(t("compliance.photoRequired")); return; }
    if (formItem.requires_expiry && (!expiryDate || expiryDate < today())) { setFormError(t("compliance.expiryRequired")); return; }
    setSubmitting(true); setFormError("");
    try {
      await employeeComplianceService.submit({ token, requirementCode: formItem.requirement_code, expiryDate: formItem.requires_expiry ? expiryDate : null, requestId, file });
      closeForm(); await load();
    } catch { setFormError(t("compliance.submitError")); }
    finally { setSubmitting(false); }
  }

  return <CrewMobilePage className="crew-compliance-page">
    <CrewMobileDetailHeader title={t("compliance.title")} onBack={onBack} />
    <p className="crew-compliance-intro">{t("compliance.intro")}</p>
    {loading ? <div className="crew-v2-state" role="status">{t("common.loading")}</div> : null}
    {pageError ? <div className="crew-v2-error" role="alert">{pageError}<button type="button" onClick={load}>{t("common.retry")}</button></div> : null}
    {!loading && !requirements.length ? <CrewEmptyState title={t("compliance.empty")} /> : null}
    <div className="crew-compliance-list">{requirements.map((item) => {
      const status = item.status || "missing";
      const submissionId = submissionIdFor(item);
      const viewOnly = status === "pending_verification" || status === "verified";
      const actionLabel = status === "missing" ? t("compliance.addDocument")
        : status === "pending_verification" ? t("compliance.viewSubmission")
          : status === "verified" ? t("compliance.view")
            : status === "rejected" ? t("compliance.resubmit") : t("compliance.renew");
      const actionIcon = viewOnly ? <Eye size={17} /> : status === "rejected" ? <RotateCcw size={17} /> : <Upload size={17} />;
      const action = viewOnly ? () => setDetailItem(item) : () => openForm(item);
      return <article className={`crew-ui-functional-surface crew-compliance-card is-${status}`} key={item.requirement_code}>
        <header>
          <span className="crew-ui-icon-container"><FileCheck2 size={20} /></span>
          <div><h2>{item.requirement_name}</h2><p>{item.requires_expiry ? t("compliance.photoExpiry") : t("compliance.photoOnly")}</p></div>
          <div className="crew-compliance-status"><CrewStatusBadge tone={statusTone[status]}>{t(`compliance.status.${status}`)}</CrewStatusBadge>{submissionId && !viewOnly ? <button type="button" onClick={() => setDetailItem(item)} aria-label={t("compliance.viewDocument", { name: item.requirement_name })}><Eye size={17} /></button> : null}</div>
        </header>
        {status === "pending_verification" && item.pending_submitted_at ? <p className="crew-compliance-meta">{t("compliance.submitted", { date: formatCrewOperationalDateTime(item.pending_submitted_at) })}</p> : null}
        {["verified", "expiring_soon", "expired"].includes(status) ? <p className={`crew-compliance-expiry${status !== "verified" ? " is-emphasized" : ""}`}>{item.effective_expiry_date ? t("compliance.expires", { date: displayDate(item.effective_expiry_date) }) : t("compliance.noExpiry")}</p> : null}
        {item.rejection_reason ? <div className="crew-compliance-rejection"><strong>{t("compliance.rejectedReason")}</strong><span>{item.rejection_reason}</span></div> : null}
        {item.replacement_pending ? <div className="crew-compliance-effective"><CheckCircle2 size={17} /><span>{t("compliance.effectiveWhilePending")}</span></div> : null}
        <button className={viewOnly ? "crew-mobile-secondary" : "crew-mobile-primary"} type="button" onClick={action}>{actionIcon}{actionLabel}</button>
      </article>;
    })}</div>

    {formItem ? <CrewBottomSheet title={formItem.requirement_name} description={formItem.effective_submission_id ? t("compliance.replaceHelp") : t("compliance.submitHelp")} onClose={closeForm} closeDisabled={submitting} className="crew-compliance-sheet" footer={<><button className="crew-mobile-secondary" type="button" disabled={submitting} onClick={closeForm}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" disabled={submitting || preparing || !file || (formItem.requires_expiry && (!expiryDate || expiryDate < today()))} onClick={submit}>{submitting ? t("common.saving") : t("compliance.submitForReview")}</button></>}>
      <div className="crew-compliance-form">
        <CrewEvidencePhotoPicker label={t("compliance.evidencePhoto")} optional={false} previewUrl={previewUrl} previewAlt={t("compliance.evidencePreview")} onChoose={choosePhoto} onRemove={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setFile(null); setPreviewUrl(""); setRequestId(crypto.randomUUID()); }} busy={preparing} busyLabel={t("compliance.preparingPhoto")} />
        {formItem.requires_expiry ? <CrewDatePicker label={t("compliance.expiryDate")} value={expiryDate} min={today()} onChange={setExpiryDate} /> : null}
        {formItem.effective_submission_id ? <div className="crew-compliance-effective"><CheckCircle2 size={17} /><span>{t("compliance.currentRemainsEffective")}</span></div> : null}
        {formError ? <div className="crew-v2-error" role="alert">{formError}</div> : null}
      </div>
    </CrewBottomSheet> : null}

    {detailItem ? <CrewBottomSheet title={detailItem.requirement_name} description={t(`compliance.status.${detailItem.status || "missing"}`)} onClose={closeDetail} className="crew-compliance-sheet" footer={<><button className="crew-mobile-secondary" type="button" onClick={closeDetail}>{t("common.close")}</button>{["verified", "expiring_soon"].includes(detailItem.status) ? <button className="crew-mobile-primary" type="button" onClick={() => { const item = detailItem; closeDetail(); openForm(item); }}>{detailItem.status === "expiring_soon" ? t("compliance.renew") : t("compliance.replace")}</button> : null}</>}>
      <div className="crew-compliance-detail">
        <CrewStatusBadge tone={statusTone[detailItem.status || "missing"]}>{t(`compliance.status.${detailItem.status || "missing"}`)}</CrewStatusBadge>
        <dl>
          {detailItem.pending_submitted_at && detailItem.status === "pending_verification" ? <div><dt>{t("compliance.submittedLabel")}</dt><dd>{formatCrewOperationalDateTime(detailItem.pending_submitted_at)}</dd></div> : null}
          {detailItem.verified_at && ["verified", "expiring_soon", "expired"].includes(detailItem.status) ? <div><dt>{t("compliance.verifiedLabel")}</dt><dd>{formatCrewOperationalDateTime(detailItem.verified_at)}</dd></div> : null}
          {detailItem.rejected_at && detailItem.status === "rejected" ? <div><dt>{t("compliance.reviewedLabel")}</dt><dd>{formatCrewOperationalDateTime(detailItem.rejected_at)}</dd></div> : null}
          {detailItem.requires_expiry ? <div><dt>{t("compliance.expiryDate")}</dt><dd>{displayDate(detailItem.pending_expiry_date || detailItem.rejected_expiry_date || detailItem.effective_expiry_date)}</dd></div> : null}
        </dl>
        {detailItem.rejection_reason ? <div className="crew-compliance-rejection"><strong>{t("compliance.rejectedReason")}</strong><span>{detailItem.rejection_reason}</span></div> : null}
        {detailItem.replacement_pending ? <div className="crew-compliance-effective"><CheckCircle2 size={17} /><span>{t("compliance.effectiveWhilePending")}</span></div> : null}
        {evidenceLoading ? <div className="crew-v2-state" role="status">{t("compliance.loadingEvidence")}</div> : null}
        {evidenceUrl ? <button type="button" className="crew-compliance-evidence" onClick={() => setViewerOpen(true)}><img src={evidenceUrl} alt={t("compliance.evidencePreview")} /><span><Eye size={16} />{t("compliance.openEvidence")}</span></button> : null}
        {evidenceError ? <div className="crew-v2-error" role="alert">{evidenceError}</div> : null}
      </div>
    </CrewBottomSheet> : null}
    {viewerOpen && evidenceUrl ? <CrewImageViewer src={evidenceUrl} alt={t("compliance.evidencePreview")} title={t("compliance.evidencePhoto")} onClose={() => setViewerOpen(false)} /> : null}
  </CrewMobilePage>;
}
