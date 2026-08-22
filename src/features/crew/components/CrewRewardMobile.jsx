import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";
import {
  Calculator,
  ChevronRight,
  CircleHelp,
  Gift,
  History,
  Info,
  Lightbulb,
  TrendingUp,
  X,
} from "lucide-react";
import { formatCrewDate, formatCrewMoney, translateStatus } from "../utils/crewI18n.js";
import { CrewMobilePageHeader } from "./CrewMobileUI.jsx";

const money = formatCrewMoney;
const rate = (value, digits = 0) => `${(Number(value || 0) * 100).toFixed(digits)}%`;
const defaultTiers = (t) => [
  { range: "95–100", level: t("reward.levels.outstanding"), rate: 1 },
  { range: "90–94", level: t("reward.levels.excellent"), rate: .9 },
  { range: "85–89", level: t("reward.levels.strong"), rate: .8 },
  { range: "80–84", level: t("status.good"), rate: .65 },
  { range: "75–79", level: t("reward.levels.meetsStandard"), rate: .45 },
  { range: "70–74", level: t("reward.levels.developing"), rate: .2 },
  { range: "<70", level: t("reward.levels.belowStandard"), rate: 0 },
];

const rewardLevelKey = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_|_$/g, "");

const translateRewardLevel = (value, t) => {
  const levelKeys = {
    outstanding: "outstanding",
    excellent: "excellent",
    strong: "strong",
    meets_standard: "meetsStandard",
    developing: "developing",
    below_standard: "belowStandard",
  };
  const key = levelKeys[rewardLevelKey(value)];
  return key ? t(`reward.levels.${key}`) : value;
};

const translateProjectionLabel = (item, t) => {
  const labels = {
    current: "currentProjection",
    on_track: "onTrack",
    great: "greatProjection",
    max: "maxPotential",
    max_potential: "maxPotential",
  };
  const key = labels[rewardLevelKey(item?.key || item?.label)];
  return key ? t(`reward.${key}`) : item?.label;
};

function Modal({ title, onClose, children }) {
  const { t } = useTranslation();
  const modalRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab") return;
      const focusable = [...modalRef.current.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose]);
  return <div className="crew-reward-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={modalRef} className="crew-reward-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>{title}</h2><button ref={closeRef} type="button" onClick={onClose} aria-label={t("common.close")}><X size={20} /></button></header>
      <div>{children}</div>
    </section>
  </div>;
}

function InfoButton({ label, onClick }) {
  return <button type="button" className="crew-reward-inline-info" aria-label={label} onClick={onClick}><Info size={12} /></button>;
}

function TierTable({ tiers }) {
  const { t } = useTranslation();
  return <div className="crew-reward-tier-table" aria-label={t("reward.rateTable")}>
    <div><b>{t("reward.scoreRange")}</b><b>{t("reward.level")}</b><b>{t("reward.earnRate")}</b></div>
    {tiers.map((tier) => <div key={tier.range}><span>{tier.range}</span><span>{tier.level}</span><strong>{rate(tier.rate)}</strong></div>)}
  </div>;
}

function RewardHero({ data, onOpenModal }) {
  const { t } = useTranslation();
  const contribution = Math.max(0, Math.min(1, Number(data.contribution_share || 0)));
  const label = data.cycle_status === "paid" ? t("reward.paidReward") : data.cycle_status === "finalized" ? t("reward.finalReward") : t("reward.estimatedReward");
  return <article className="crew-reward-hero">
    <div className="crew-reward-hero-kicker"><span>{t("reward.thisMonth")}</span><em>{translateStatus(data.status, t)}</em></div>
    <div className="crew-reward-hero-total"><small>{label} <InfoButton label={t("common.aboutNamed", { title: label })} onClick={() => onOpenModal("help")} /></small><strong>{money(data.reward_amount ?? data.estimated_reward)}</strong><p>{t("reward.scoreBasis", { score: data.performance_score == null ? "—" : Math.round(data.performance_score) })}</p></div>
    <div className="crew-reward-hero-metrics">
      <div className="is-maximum"><small>{t("reward.maximum")} <InfoButton label={t("common.aboutNamed", { title: t("reward.maximumShare").toLowerCase() })} onClick={() => onOpenModal("maximum")} /></small><strong>{money(data.maximum_share)}</strong><p>{t("reward.maximumCaption")}</p></div>
      <div className="is-contribution"><span><small>{t("reward.contribution")} <InfoButton label={t("common.aboutNamed", { title: t("reward.contributionShare").toLowerCase() })} onClick={() => onOpenModal("contribution")} /></small><p>{t("reward.eligibleHours", { eligible: Number(data.eligible_hours || 0).toFixed(1), total: Number(data.total_eligible_hours || 0).toFixed(1) })}</p></span><i aria-label={`${rate(contribution, 2)} ${t("reward.contribution")}`} style={{ "--reward-progress": `${contribution * 360}deg` }}><b>{rate(contribution, 2)}</b></i></div>
      <div className="is-pool"><small>{t("reward.rewardPool")} <InfoButton label={t("common.aboutNamed", { title: t("reward.rewardPool").toLowerCase() })} onClick={() => onOpenModal("pool")} /></small><strong>{money(data.reward_pool ?? data.configured_pool)}</strong><p>{t("reward.sharedPool")}</p></div>
    </div>
  </article>;
}

function PerformanceOverview({ data, tiers, onOpenSheet, onViewPerformance }) {
  const { t } = useTranslation();
  const score = Math.max(0, Math.min(100, Number(data.performance_score || 0)));
  return <article className="crew-reward-card crew-reward-performance">
    <header><span><h2>{t("reward.performanceOverview")}</h2><p>{t("reward.performanceCaption")}</p></span><button type="button" onClick={onViewPerformance}>{t("reward.viewPerformance")} <ChevronRight size={16} /></button></header>
    <div className="crew-reward-performance-main">
      <div className="crew-reward-score-summary">
        <div className="crew-reward-score-ring" style={{ "--score-progress": `${score * 3.6}deg` }}><span><strong>{Math.round(score)}</strong><small>/ 100</small></span></div>
        <div><h3>{translateRewardLevel(data.performance_level, t) || translateStatus("ready_for_review", t)}</h3><em>{t("reward.onTrack")}</em><small>{t("reward.currentRate")} <InfoButton label={t("common.aboutNamed", { title: t("reward.currentRate").toLowerCase() })} onClick={() => onOpenSheet("rates")} /></small><strong>{rate(data.earn_rate)}</strong></div>
      </div>
    </div>
    <div className="crew-reward-scale" aria-label={t("reward.performanceScore", { score: Math.round(score) })}>
      <div className="crew-reward-scale-track"><i style={{ left: `${score}%` }}><b>{Math.round(score)}</b></i></div>
      <div className="crew-reward-scale-labels"><span>&lt;70<small>0%</small></span><span>70<small>20%</small></span><span>75<small>45%</small></span><span>80<small>65%</small></span><span>85<small>80%</small></span><span>90<small>90%</small></span><span>95<small>100%</small></span></div>
    </div>
    <button type="button" className="crew-reward-info-link" onClick={() => onOpenSheet("rates")}>{t("reward.earnRateWorks")} <Info size={14} /></button>
  </article>;
}

function RewardProjection({ data, onOpenSheet }) {
  const { t } = useTranslation();
  if (data.projection_applicable === false || ["finalized", "paid"].includes(data.cycle_status)) {
    return <article className="crew-reward-card crew-reward-finalized"><TrendingUp size={20} /><span><h2>{t("reward.finalized")}</h2><p>{t("reward.finalizedCaption")}</p></span></article>;
  }
  const projections = data.projections || [];
  return <article className="crew-reward-card crew-reward-projection">
    <header><span><h2><TrendingUp size={19} /> {t("reward.projection")}</h2><p>{t("reward.projectionCaption")}</p></span><button type="button" onClick={() => onOpenSheet("projection")}><Info size={15} /> {t("reward.howWorks")}</button></header>
    <div className="crew-reward-projection-track">
      {projections.map((item, index) => <div key={item.key || item.label} className={`is-${item.key || index}`}><small>{translateProjectionLabel(item, t)}</small><b>{t("reward.score", { score: item.key === "max" ? "95+" : Math.round(Number(item.score || 0)) })}</b><i>{item.key === "max" ? "★" : ""}</i><strong>{money(item.amount)}</strong><span>{t("reward.rateEarned", { rate: rate(item.earn_rate) })}</span></div>)}
    </div>
    <p className="crew-reward-projection-note"><Info size={14} /> {t("reward.projectionAssumption", { contribution: rate(data.contribution_share, 2) })}</p>
  </article>;
}

function RewardHistory({ history, onViewAll }) {
  const { t } = useTranslation();
  const recent = history?.[0];
  return <article className="crew-reward-card crew-reward-history-card">
    <header><span><h2><History size={18} /> {t("reward.history")}</h2><p>{t("reward.historyCaption")}</p></span>{history?.length ? <button type="button" onClick={onViewAll}>{t("reward.viewAll")} <ChevronRight size={16} /></button> : null}</header>
    {recent ? <button type="button" className="crew-reward-history-row" onClick={onViewAll}><time>{formatCrewDate(`${recent.period_start}T00:00:00`, { month: "short", year: "numeric" })}</time><span><strong>{money(recent.amount)}</strong><em>{translateStatus(recent.status, t)}</em></span><ChevronRight size={17} /></button> : <p className="crew-reward-history-empty">{t("reward.noHistory")}</p>}
  </article>;
}

export default function CrewRewardMobile({ data, loading, onRetry, onViewPerformance }) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState(null);
  const tiers = useMemo(() => data?.earn_rate_tiers?.length ? data.earn_rate_tiers : defaultTiers(t), [data?.earn_rate_tiers, t]);
  if (loading) return <section className="crew-v2-state"><span className="crew-v2-spinner" /><strong>{t("reward.loading")}</strong></section>;
  if (!data) return <section className="crew-v2-state is-error"><Gift size={26} /><strong>{t("reward.unavailable")}</strong><p>{t("reward.unavailableBody")}</p><button type="button" onClick={onRetry}>{t("common.retry")}</button></section>;
  const unlocked = ["qualified", "finalized", "paid"].includes(data.status);
  return <section className="crew-reward-final">
    <CrewMobilePageHeader title={t("reward.title")} action={<button type="button" className="crew-reward-header-action" aria-label={t("reward.help")} onClick={() => setSheet("help")}><CircleHelp size={22} /></button>} />
    {unlocked ? <>
      <RewardHero data={data} onOpenModal={setSheet} />
      <button type="button" className="crew-reward-motivation" onClick={() => setSheet("help")}><i className="crew-ui-icon-container"><Lightbulb size={19} /></i><span>{t("reward.motivation")}</span><ChevronRight size={18} /></button>
      <PerformanceOverview data={data} tiers={tiers} onOpenSheet={setSheet} onViewPerformance={onViewPerformance} />
      <RewardProjection data={data} onOpenSheet={setSheet} />
      <button type="button" className="crew-reward-formula-row" onClick={() => setSheet("formula")}><i className="crew-ui-icon-container"><Calculator size={18} /></i><span><strong>{t("reward.calculated")}</strong></span><ChevronRight size={18} /></button>
      <RewardHistory history={data.history || []} onViewAll={() => setSheet("history")} />
    </> : <article className="crew-reward-unavailable"><Gift size={30} /><h2>{translateStatus(data.status, t) || t("reward.notAvailable")}</h2><p>{data.eligibility_reason || data.explanation || t("reward.notAvailableYet")}</p></article>}

    {sheet === "help" && <Modal title={t("reward.about")} onClose={() => setSheet(null)}><div className="crew-reward-modal-section"><strong>{t("reward.maximumShare")}</strong><p>{t("reward.maximumShareHelp")}</p></div><div className="crew-reward-modal-section"><strong>{t("reward.performanceEarnRate")}</strong><p>{t("reward.performanceEarnRateHelp")}</p></div><div className="crew-reward-modal-note"><Lightbulb size={18} /><span>{t("reward.helpCallout")}</span></div></Modal>}
    {sheet === "maximum" && <Modal title={t("reward.yourMaximumShare")} onClose={() => setSheet(null)}><p>{t("reward.maximumDetail", { amount: money(data.maximum_share) })}</p></Modal>}
    {sheet === "contribution" && <Modal title={t("reward.contribution")} onClose={() => setSheet(null)}><p>{t("reward.contributionDetail", { eligible: Number(data.eligible_hours || 0).toFixed(1), total: Number(data.total_eligible_hours || 0).toFixed(1), rate: rate(data.contribution_share, 2) })}</p></Modal>}
    {sheet === "pool" && <Modal title={t("reward.rewardPool")} onClose={() => setSheet(null)}><p>{t("reward.poolDetail", { amount: money(data.reward_pool ?? data.configured_pool) })}</p></Modal>}
    {sheet === "rates" && <Modal title={t("reward.performanceRates")} onClose={() => setSheet(null)}><p>{t("reward.performanceRatesHelp")}</p><TierTable tiers={tiers} /></Modal>}
    {sheet === "projection" && <Modal title={t("reward.aboutProjections")} onClose={() => setSheet(null)}><p>{t("reward.projectionDetail")}</p></Modal>}
    {sheet === "formula" && <Modal title={t("reward.formulaTitle")} onClose={() => setSheet(null)}><div className="crew-reward-formula"><span><small>{t("reward.rewardPool")}</small><strong>{money(data.reward_pool ?? data.configured_pool)}</strong></span><b>×</b><span><small>{t("reward.contributionShare")}</small><strong>{rate(data.contribution_share, 2)}</strong></span><b>=</b><span><small>{t("reward.maximumShare")}</small><strong>{money(data.maximum_share)}</strong></span></div><div className="crew-reward-formula"><span><small>{t("reward.maximumShare")}</small><strong>{money(data.maximum_share)}</strong></span><b>×</b><span><small>{t("reward.performanceEarnRate")}</small><strong>{rate(data.earn_rate)}</strong></span><b>=</b><span><small>{data.cycle_status === "paid" ? t("reward.paidReward") : data.cycle_status === "finalized" ? t("reward.finalReward") : t("reward.estimatedReward")}</small><strong>{money(data.reward_amount ?? data.estimated_reward)}</strong></span></div></Modal>}
    {sheet === "history" && <Modal title={t("reward.history")} onClose={() => setSheet(null)}><div className="crew-reward-modal-history">{(data.history || []).map((item) => <div key={item.period_start}><time>{formatCrewDate(`${item.period_start}T00:00:00`, { month: "long", year: "numeric" })}</time><span><strong>{money(item.amount)}</strong><small>{translateStatus(item.status, t)}</small></span></div>)}</div></Modal>}
  </section>;
}
