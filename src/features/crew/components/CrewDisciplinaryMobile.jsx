import { useEffect, useState } from "react";
import { Eye, FileWarning, MessageSquareText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { employeeDisciplinaryService } from "../../../services/employeeDisciplinaryService.js";
import { formatCrewDate, formatCrewOperationalDateTime } from "../utils/crewI18n.js";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewImageViewer from "./CrewImageViewer.jsx";
import CrewMobileModal from "./CrewMobileModal.jsx";
import { CrewEmptyState, CrewMobilePage, CrewPageSection, CrewStatusBadge } from "./CrewMobileUI.jsx";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import "./CrewDisciplinaryMobile.css";

const tone = { issued: "warning", delivered: "warning", viewed: "info", acknowledged: "success", not_acknowledged: "warning", withdrawn: "neutral", superseded: "neutral" };
const typeKey = { first_written_warning: "first", final_written_warning: "final" };
const dateOnly = (value) => value ? formatCrewDate(`${value}T12:00:00+08:00`, { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function CrewDisciplinaryMobile({ token, onBack }) {
  const { t } = useTranslation();
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [evidence, setEvidence] = useState(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [responseOpen, setResponseOpen] = useState(false);
  const [response, setResponse] = useState("");
  const [ackOpen, setAckOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try { setWarnings((await employeeDisciplinaryService.crewOverview(token)).warnings || []); }
    catch (cause) { setError(cause.message || t("disciplinary.loadError")); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [token]);

  async function openDetail(id) {
    setDetailLoading(true); setActionError(""); setEvidence(null);
    try {
      const next = await employeeDisciplinaryService.crewDetail(token, id);
      setDetail(next);
      if (next.has_evidence) employeeDisciplinaryService.crewEvidence(token, id).then(setEvidence).catch(() => setActionError(t("disciplinary.evidenceError")));
      await load();
    } catch (cause) { setError(cause.message || t("disciplinary.loadError")); }
    finally { setDetailLoading(false); }
  }
  async function submitResponse() {
    if (!response.trim()) return;
    setBusy(true); setActionError("");
    try { await employeeDisciplinaryService.crewRespond(token, detail.id, response); setResponseOpen(false); setResponse(""); await openDetail(detail.id); }
    catch (cause) { setActionError(cause.message || t("disciplinary.responseError")); }
    finally { setBusy(false); }
  }
  async function acknowledge() {
    setBusy(true); setActionError("");
    try { await employeeDisciplinaryService.crewAcknowledge(token, detail.id); setAckOpen(false); await openDetail(detail.id); }
    catch (cause) { setActionError(cause.message || t("disciplinary.ackError")); }
    finally { setBusy(false); }
  }
  const closeDetail = () => { setDetail(null); setEvidence(null); setViewerOpen(false); setActionError(""); };
  const canAct = detail && ["delivered", "viewed"].includes(detail.status);

  return <CrewMobilePage className="crew-disciplinary-page">
    <CrewMobileDetailHeader title={t("disciplinary.title")} onBack={onBack} />
    <p className="crew-disciplinary-intro">{t("disciplinary.intro")}</p>
    <CrewPageSection>
      {loading ? <div className="crew-v2-state" role="status">{t("common.loading")}</div> : null}
      {error ? <div className="crew-v2-error" role="alert">{error}<button type="button" onClick={load}>{t("common.retry")}</button></div> : null}
      {!loading && !warnings.length ? <CrewEmptyState title={t("disciplinary.empty")} body={t("disciplinary.emptyBody")} /> : null}
      <div className="crew-disciplinary-list">{warnings.map((item) => <article className="crew-ui-functional-surface crew-disciplinary-card" key={item.id}>
        <header><span className="crew-ui-icon-container"><FileWarning size={20} /></span><div><small>{t(`disciplinary.type.${typeKey[item.warning_type]}`)}</small><h2>{item.subject}</h2><p>{t("disciplinary.issued", { date: dateOnly(item.issued_date) })}</p></div><CrewStatusBadge tone={tone[item.status]}>{t(`disciplinary.status.${item.status}`)}</CrewStatusBadge></header>
        <button className="crew-mobile-secondary" type="button" disabled={detailLoading} onClick={() => openDetail(item.id)}><Eye size={17} />{item.viewed_at ? t("disciplinary.view") : t("disciplinary.review")}</button>
      </article>)}</div>
    </CrewPageSection>

    {detail ? <CrewBottomSheet title={detail.subject} description={t(`disciplinary.type.${typeKey[detail.warning_type]}`)} onClose={closeDetail} className="crew-disciplinary-sheet" footer={<><button className="crew-mobile-secondary" type="button" onClick={closeDetail}>{t("common.close")}</button>{canAct ? <button className="crew-mobile-primary" type="button" onClick={() => setAckOpen(true)}>{t("disciplinary.acknowledge")}</button> : null}</>}>
      <div className="crew-disciplinary-detail">
        <CrewStatusBadge tone={tone[detail.status]}>{t(`disciplinary.status.${detail.status}`)}</CrewStatusBadge>
        <dl><div><dt>{t("disciplinary.incidentDate")}</dt><dd>{dateOnly(detail.incident_date)}</dd></div><div><dt>{t("disciplinary.issuedDate")}</dt><dd>{dateOnly(detail.issued_date)}</dd></div>{detail.outlet_name_snapshot ? <div><dt>{t("common.outlet")}</dt><dd>{detail.outlet_name_snapshot}</dd></div> : null}</dl>
        <section><h3>{t("disciplinary.details")}</h3><p>{detail.warning_details}</p></section>
        <section><h3>{t("disciplinary.requiredAction")}</h3><p>{detail.required_action}</p></section>
        {detail.withdrawal_reason ? <div className="crew-disciplinary-notice">{detail.withdrawal_reason}</div> : null}
        {detail.response ? <section className="crew-disciplinary-response"><h3>{t("disciplinary.yourResponse")}</h3><p>{detail.response.text}</p><small>{formatCrewOperationalDateTime(detail.response.submitted_at)}</small></section> : canAct ? <button className="crew-mobile-secondary" type="button" onClick={() => { setResponseOpen(true); setActionError(""); }}><MessageSquareText size={17} />{t("disciplinary.addResponse")}</button> : null}
        {evidence?.evidence_url ? evidence.mime_type === "application/pdf" ? <iframe className="crew-disciplinary-pdf" title={t("disciplinary.evidence")} src={evidence.evidence_url} /> : <button className="crew-disciplinary-evidence" type="button" onClick={() => setViewerOpen(true)}><img src={evidence.evidence_url} alt={t("disciplinary.evidence")} /><span><Eye size={16} />{t("disciplinary.viewEvidence")}</span></button> : null}
        {detail.acknowledged_at ? <p className="crew-disciplinary-confirmed">{t("disciplinary.acknowledgedAt", { date: formatCrewOperationalDateTime(detail.acknowledged_at) })}</p> : null}
        {actionError ? <div className="crew-v2-error" role="alert">{actionError}</div> : null}
      </div>
    </CrewBottomSheet> : null}
    {responseOpen ? <CrewBottomSheet title={t("disciplinary.addResponse")} description={t("disciplinary.responseHelp")} onClose={() => setResponseOpen(false)} footer={<><button className="crew-mobile-secondary" type="button" disabled={busy} onClick={() => setResponseOpen(false)}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" disabled={busy || !response.trim()} onClick={submitResponse}>{busy ? t("common.saving") : t("disciplinary.submitResponse")}</button></>}><label className="crew-disciplinary-response-field">{t("disciplinary.responseLabel")}<textarea value={response} onChange={(event) => setResponse(event.target.value)} maxLength={3000} /></label>{actionError ? <div className="crew-v2-error" role="alert">{actionError}</div> : null}</CrewBottomSheet> : null}
    {ackOpen ? <CrewMobileModal title={t("disciplinary.acknowledgeTitle")} description={t("disciplinary.acknowledgeCopy")} onClose={() => setAckOpen(false)} closeDisabled={busy} footer={<><button className="crew-mobile-secondary" type="button" disabled={busy} onClick={() => setAckOpen(false)}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" disabled={busy} onClick={acknowledge}>{busy ? t("common.saving") : t("disciplinary.acknowledgeReceipt")}</button></>} /> : null}
    {viewerOpen && evidence?.evidence_url ? <CrewImageViewer src={evidence.evidence_url} alt={t("disciplinary.evidence")} title={t("disciplinary.evidence")} onClose={() => setViewerOpen(false)} /> : null}
  </CrewMobilePage>;
}
