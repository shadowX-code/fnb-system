import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, UsersRound } from "lucide-react";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import { crewService } from "../../../services/crewService.js";

const dimensions = ["teamwork", "reliability", "communication", "work_attitude"];

export default function CrewPeerReviewHome({ token }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [ratings, setRatings] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    crewService.peerReviewMobile(token).then((result) => { if (active) setData(result); }).catch(() => { if (active) setData(null); });
    return () => { active = false; };
  }, [token]);

  const pending = data?.assignments?.filter((assignment) => !assignment.submitted) || [];
  if (!data?.open || !pending.length) return null;

  async function submit() {
    if (!selected || dimensions.some((key) => !ratings[key])) return;
    setBusy(true); setError("");
    try {
      await crewService.submitPeerReview(token, selected.id, ratings);
      const next = await crewService.peerReviewMobile(token);
      setData(next);
      setSelected(next.assignments.find((assignment) => !assignment.submitted) || null);
      setRatings({});
    } catch (cause) {
      setError(cause.message || t("peerReview.submitError"));
    } finally { setBusy(false); }
  }

  return <section className="crew-v2-home-section crew-peer-home">
    <button type="button" className="crew-peer-home-entry" onClick={() => { setSelected(pending[0]); setRatings({}); setError(""); }}>
      <i className="crew-ui-icon-container crew-ui-icon-container--compact"><UsersRound size={18} /></i>
      <span><strong>{t("peerReview.title")}</strong><small>{t("peerReview.progress", { completed: data.completed, total: data.total })}</small></span>
      <em>{t("peerReview.continue")}</em><ChevronRight size={17} />
    </button>
    {selected && <CrewBottomSheet title={t("peerReview.title")} description={selected.subject_name} onClose={() => setSelected(null)} closeDisabled={busy}
      footer={<><button type="button" className="crew-mobile-secondary" disabled={busy} onClick={() => setSelected(null)}>{t("common.cancel")}</button><button type="button" className="crew-mobile-primary" disabled={busy || dimensions.some((key) => !ratings[key])} onClick={submit}>{busy ? t("common.saving") : t("common.submit")}</button></>}>
      <div className="crew-peer-form">
        <p>{t("peerReview.help")}</p>
        {dimensions.map((key) => <fieldset key={key}><legend>{t(`peerReview.dimensions.${key}`)}</legend><div>{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={ratings[key] === value ? "is-active" : ""} aria-pressed={ratings[key] === value} onClick={() => setRatings((current) => ({ ...current, [key]: value }))}>{value}</button>)}</div></fieldset>)}
        {error && <div role="alert" className="crew-v2-error">{error}</div>}
      </div>
    </CrewBottomSheet>}
  </section>;
}
