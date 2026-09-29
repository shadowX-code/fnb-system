import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, UsersRound } from "lucide-react";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewRatingScale from "./CrewRatingScale.jsx";
import { crewService } from "../../../services/crewService.js";

const dimensions = ["teamwork", "reliability", "communication", "work_attitude"];
const scale = ["rarely", "sometimes", "usually", "often", "consistently"];

export default function CrewTeamReviewHome({ token, employeeId }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [ratings, setRatings] = useState({});
  const [comment, setComment] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    crewService.teamReviewMobile(token).then((result) => { if (active) setData(result); }).catch(() => { if (active) setData(null); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!data?.open || !data?.period_start || !data?.teammates?.some((item) => !item.reviewed) || !employeeId) return;
    const key = `crew-team-review-intro:${employeeId}:${data.period_start}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "seen");
    } catch { return; }
    setIntroOpen(true);
  }, [data, employeeId]);

  const teammates = data?.teammates || [];
  const pending = teammates.filter((teammate) => !teammate.reviewed);
  if (!data?.open && !sheetOpen && !introOpen) return null;
  if (!teammates.length && !sheetOpen && !introOpen) return null;
  const closingDate = data?.deadline ? new Date(new Date(data.deadline).getTime() - 1).toLocaleDateString(i18n.language === "ms" ? "ms-MY" : i18n.language === "zh-CN" ? "zh-CN" : "en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }) : "";

  async function submit() {
    if (!selected || dimensions.some((key) => !ratings[key])) return;
    setBusy(true); setError("");
    try {
      await crewService.submitTeamReview(token, data.period_start, selected.id, ratings, comment);
      const next = await crewService.teamReviewMobile(token, data.period_start);
      setData(next);
      setSelected(null);
      setRatings({});
      setComment("");
      setSuccess(true);
    } catch (cause) {
      setError(cause.message || t("teamReview.submitError"));
    } finally { setBusy(false); }
  }

  return <section className="crew-v2-home-section crew-team-home">
    {data?.open && teammates.length ? <button type="button" className="crew-team-home-entry" onClick={() => { setSheetOpen(true); setSuccess(false); setError(""); }}>
      <i className="crew-ui-icon-container crew-ui-icon-container--compact"><UsersRound size={18} /></i>
      <span><strong>{t("teamReview.title")}</strong><small>{t("teamReview.closes", { date: closingDate })}</small><b>{pending.length ? t("teamReview.available", { count: pending.length }) : t("teamReview.caughtUp")}</b></span>
      {pending.length ? <em>{t("teamReview.continue")}</em> : null}<ChevronRight size={17} />
    </button> : null}
    {introOpen && <CrewBottomSheet title={t("teamReview.openTitle")} description={t("teamReview.openDescription")} onClose={() => setIntroOpen(false)} footer={<><button type="button" className="crew-mobile-secondary" onClick={() => setIntroOpen(false)}>{t("teamReview.later")}</button><button type="button" className="crew-mobile-primary" onClick={() => { setIntroOpen(false); setSheetOpen(true); }}>{t("teamReview.start")}</button></>}>
      <div className="crew-team-intro"><strong>{t("teamReview.available", { count: pending.length })}</strong><span>{t("teamReview.closes", { date: closingDate })}</span><small>{t("teamReview.privacy")}</small></div>
    </CrewBottomSheet>}
    {sheetOpen && <CrewBottomSheet title={t("teamReview.title")} description={selected ? selected.name : t("teamReview.help")}
      onClose={() => { setSheetOpen(false); setSelected(null); }} closeDisabled={busy}
      footer={selected ? <><button type="button" className="crew-mobile-secondary" disabled={busy} onClick={() => setSelected(null)}>{t("common.back")}</button><button type="button" className="crew-mobile-primary" disabled={busy || dimensions.some((key) => !ratings[key])} onClick={submit}>{busy ? t("common.saving") : t("common.submit")}</button></> : null}>
      {!selected ? <div className="crew-team-list">
        {success ? <p role="status" className="crew-team-success"><Check size={16} />{t("teamReview.submitted")}</p> : null}
        <p>{pending.length ? t("teamReview.availableAfter", { completed: data?.completed || 0, available: pending.length }) : t("teamReview.caughtUp")}</p>
        {teammates.map((teammate) => <button type="button" key={teammate.id} disabled={teammate.reviewed}
          onClick={() => { setSelected(teammate); setRatings({}); setComment(""); setSuccess(false); setError(""); }}>
          <span><strong>{teammate.name}</strong><small>{teammate.position}</small></span>
          <em>{t(teammate.reviewed ? "teamReview.reviewed" : "teamReview.review")}</em>
          {teammate.reviewed ? <Check size={16} /> : <ChevronRight size={16} />}
        </button>)}
      </div> : <div className="crew-team-form">
        <p>{t("teamReview.help")}</p>
        {dimensions.map((key) => <CrewRatingScale key={key} label={t(`teamReview.dimensions.${key}`)} value={ratings[key]} scale={scale} labelFor={(word) => t(`teamReview.scale.${word}`)} chooseLabel={t("teamReview.chooseRating")} onChange={(value) => setRatings((current) => ({ ...current, [key]: value }))} />)}
        <div className="crew-team-comment"><label htmlFor="crew-team-comment">{t("teamReview.comment")}</label><p>{t("teamReview.commentPrompt")}</p><textarea id="crew-team-comment" value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} placeholder={t("teamReview.commentPlaceholder")} /><small>{t("teamReview.commentPrivacy")}</small></div>
        {error && <div role="alert" className="crew-v2-error">{error}</div>}
      </div>
      }
    </CrewBottomSheet>}
  </section>;
}
