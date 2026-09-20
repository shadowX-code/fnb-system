import { useEffect, useRef, useState } from "react";
import { Download, Eye, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { employmentDocumentService } from "../../../services/employmentDocumentService.js";
import { formatCrewDate, formatCrewOperationalDateTime } from "../utils/crewI18n.js";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import CrewMobileModal from "./CrewMobileModal.jsx";
import { CrewEmptyState, CrewMobilePage, CrewPageSection, CrewStatusBadge } from "./CrewMobileUI.jsx";
import "./CrewEmploymentDocumentsMobile.css";

const tone = { sent: "warning", viewed: "info", completed: "success", withdrawn: "neutral", superseded: "neutral" };
const dateOnly = (value) => value ? formatCrewDate(`${value}T12:00:00+08:00`, { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function CrewEmploymentDocumentsMobile({ token, onBack }) {
  const { t } = useTranslation();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [ackOpen, setAckOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const completionRequest = useRef(null);
  async function load() { setLoading(true); setError(""); try { setDocuments((await employmentDocumentService.crewList(token)).documents || []); } catch (cause) { setError(cause.message || t("employmentDocuments.loadError")); } finally { setLoading(false); } }
  useEffect(() => { load(); }, [token]);
  async function openDocument(id) { setDetailLoading(true); setError(""); try { setDetail(await employmentDocumentService.crewOpen(token, id)); await load(); } catch (cause) { setError(cause.message || t("employmentDocuments.loadError")); } finally { setDetailLoading(false); } }
  async function acknowledge() {
    if (!detail) return;
    if (!completionRequest.current) completionRequest.current = crypto.randomUUID();
    setBusy(true); setError("");
    try { await employmentDocumentService.crewComplete(token, detail.id, completionRequest.current); completionRequest.current = null; setAckOpen(false); await openDocument(detail.id); }
    catch (cause) { setError(cause.message || t("employmentDocuments.completeError")); }
    finally { setBusy(false); }
  }
  const canAcknowledge = detail && ["sent", "viewed"].includes(detail.status);
  return <CrewMobilePage className="crew-employment-documents-page"><CrewMobileDetailHeader title={t("employmentRecords.contracts")} onBack={onBack} /><p className="crew-employment-records-intro">{t("employmentDocuments.intro")}</p><CrewPageSection>
    {loading ? <div className="crew-v2-state" role="status">{t("common.loading")}</div> : null}
    {error && !detail ? <div className="crew-v2-error" role="alert">{error}<button type="button" onClick={load}>{t("common.retry")}</button></div> : null}
    {!loading && !documents.length ? <CrewEmptyState title={t("employmentDocuments.empty")} body={t("employmentDocuments.emptyBody")} /> : null}
    <div className="crew-employment-document-list">{documents.map((item) => <article className="crew-ui-functional-surface" key={item.id}><header><span className="crew-ui-icon-container"><FileText size={20} /></span><div><small>{t("employmentDocuments.contract")}</small><h2>{item.title}</h2><p>{t("employmentDocuments.effective", { date: dateOnly(item.effective_date) })}</p></div><CrewStatusBadge tone={tone[item.status]}>{t(`employmentDocuments.status.${item.status}`)}</CrewStatusBadge></header><button className="crew-mobile-secondary" type="button" disabled={detailLoading} onClick={() => openDocument(item.id)}><Eye size={17} />{t("employmentDocuments.view")}</button></article>)}</div>
  </CrewPageSection>
  {detail ? <CrewBottomSheet title={detail.title} description={`${t("employmentDocuments.contract")} · ${t("employmentDocuments.effective", { date: dateOnly(detail.effective_date) })}`} onClose={() => { setDetail(null); setError(""); }} className="crew-employment-document-sheet" footer={<><button className="crew-mobile-secondary" type="button" onClick={() => setDetail(null)}>{t("common.close")}</button>{canAcknowledge ? <button className="crew-mobile-primary" type="button" onClick={() => setAckOpen(true)}>{t("employmentDocuments.acknowledge")}</button> : null}</>}><div className="crew-employment-document-detail"><CrewStatusBadge tone={tone[detail.status]}>{t(`employmentDocuments.status.${detail.status}`)}</CrewStatusBadge><dl><div><dt>{t("employmentDocuments.legalEmployer")}</dt><dd>{detail.legal_company_name_snapshot}</dd></div><div><dt>{t("employmentDocuments.registration")}</dt><dd>{detail.company_registration_no_snapshot}</dd></div><div><dt>{t("employmentDocuments.sent")}</dt><dd>{formatCrewOperationalDateTime(detail.sent_at)}</dd></div></dl>{detail.document_url ? <iframe className="crew-employment-document-pdf" title={detail.title} src={detail.document_url} /> : null}{detail.download_url ? <a className="crew-mobile-secondary crew-employment-document-download" href={detail.download_url}><Download size={17} />{t("employmentDocuments.download")}</a> : null}{detail.completed_at ? <p className="crew-employment-document-completed">{t("employmentDocuments.completedAt", { date: formatCrewOperationalDateTime(detail.completed_at) })}</p> : null}{detail.withdrawal_reason ? <p className="crew-employment-document-notice">{detail.withdrawal_reason}</p> : null}{error ? <div className="crew-v2-error" role="alert">{error}</div> : null}</div></CrewBottomSheet> : null}
  {ackOpen && detail ? <CrewMobileModal title={t("employmentDocuments.ackTitle")} description={detail.consent_copy} onClose={() => setAckOpen(false)} closeDisabled={busy} footer={<><button className="crew-mobile-secondary" type="button" disabled={busy} onClick={() => setAckOpen(false)}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" disabled={busy} onClick={acknowledge}>{busy ? t("common.saving") : t("employmentDocuments.ackAction")}</button></>} /> : null}
  </CrewMobilePage>;
}
