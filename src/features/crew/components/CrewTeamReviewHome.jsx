import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, UsersRound } from "lucide-react";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import { crewService } from "../../../services/crewService.js";

const dimensions = ["teamwork", "reliability", "communication", "work_attitude"];
const scale = ["rarely", "sometimes", "usually", "often", "consistently"];

export default function CrewTeamReviewHome({ token }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
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

  const teammates = data?.teammates || [];
  const pending = teammates.filter((teammate) => !teammate.reviewed);
  if ((!data?.open || !pending.length) && !sheetOpen) return null;

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
    {data?.open && pending.length ? <button type="button" className="crew-team-home-entry" onClick={() => { setSheetOpen(true); setSuccess(false); setError(""); }}>
      <i className="crew-ui-icon-container crew-ui-icon-container--compact"><UsersRound size={18} /></i>
      <span><strong>{t("teamReview.title")}</strong><small>{t("teamReview.progress", { completed: data.completed, total: data.total })}</small></span>
      <em>{t("teamReview.continue")}</em><ChevronRight size={17} />
    </button> : null}
    {sheetOpen && <CrewBottomSheet title={t("teamReview.title")} description={selected ? selected.name : t("teamReview.help")}
      onClose={() => { setSheetOpen(false); setSelected(null); }} closeDisabled={busy}
      footer={selected ? <><button type="button" className="crew-mobile-secondary" disabled={busy} onClick={() => setSelected(null)}>{t("common.back")}</button><button type="button" className="crew-mobile-primary" disabled={busy || dimensions.some((key) => !ratings[key])} onClick={submit}>{busy ? t("common.saving") : t("common.submit")}</button></> : null}>
      {!selected ? <div className="crew-team-list">
        {success ? <p role="status" className="crew-team-success"><Check size={16} />{t("teamReview.submitted")}</p> : null}
        <p>{t("teamReview.progress", { completed: data?.completed || 0, total: data?.total || 0 })}</p>
        {teammates.map((teammate) => <button type="button" key={teammate.id} disabled={teammate.reviewed}
          onClick={() => { setSelected(teammate); setRatings({}); setComment(""); setSuccess(false); setError(""); }}>
          <span><strong>{teammate.name}</strong><small>{teammate.position}</small></span>
          <em>{t(teammate.reviewed ? "teamReview.reviewed" : "teamReview.review")}</em>
          {teammate.reviewed ? <Check size={16} /> : <ChevronRight size={16} />}
        </button>)}
      </div> : <div className="crew-team-form">
        <p>{t("teamReview.help")}</p>
        <div className="crew-team-scale">{scale.map((word, index) => <span key={word}><b>{index + 1}</b> {t(`teamReview.scale.${word}`)}</span>)}</div>
        {dimensions.map((key) => <fieldset key={key}><legend>{t(`teamReview.dimensions.${key}`)}</legend><div>{scale.map((word, index) => <button type="button" key={word} className={ratings[key] === index + 1 ? "is-active" : ""} aria-label={`${index + 1} ${t(`teamReview.scale.${word}`)}`} aria-pressed={ratings[key] === index + 1} onClick={() => setRatings((current) => ({ ...current, [key]: index + 1 }))}>{index + 1}</button>)}</div></fieldset>)}
        <label className="crew-team-comment">{t("teamReview.comment")}<textarea value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} placeholder={t("teamReview.commentPlaceholder")} /></label>
        {error && <div role="alert" className="crew-v2-error">{error}</div>}
      </div>
      }
    </CrewBottomSheet>}
  </section>;
}
