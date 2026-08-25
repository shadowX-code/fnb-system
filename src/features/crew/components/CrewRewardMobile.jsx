import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";
import {
  ChevronRight,
  CircleHelp,
  Gift,
  History,
  Info,
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
  return <div className="crew-ui-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={modalRef} className="crew-ui-modal crew-reward-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header className="crew-ui-modal-header"><h2>{title}</h2><button ref={closeRef} className="crew-ui-modal-close" type="button" onClick={onClose} aria-label={t("common.close")}><X size={20} /></button></header>
      <div className="crew-ui-modal-content">{children}</div>
    </section>
  </div>;
}

function TierTable({ tiers }) {
  const { t } = useTranslation();
  return <div className="crew-reward-tier-table" aria-label={t("reward.rateTable")}>
    <div><b>{t("reward.scoreRange")}</b><b>{t("reward.level")}</b><b>{t("reward.earnRate")}</b></div>
    {tiers.map((tier) => <div key={tier.range}><span>{tier.range}</span><span>{tier.level}</span><strong>{rate(tier.rate)}</strong></div>)}
  </div>;
}

function RewardHero({ data }) {
  const { t } = useTranslation();
  const label = data.cycle_status === "paid" ? t("reward.paidReward") : data.cycle_status === "finalized" ? t("reward.finalReward") : t("reward.estimatedReward");
  return <article className="crew-reward-hero">
    <div className="crew-reward-hero-kicker"><span>{t("reward.thisMonth")}</span><em>{translateStatus(data.status, t)}</em></div>
    <div className="crew-reward-hero-total"><small>{label}</small><strong>{money(data.reward_amount ?? data.estimated_reward)}</strong><p>{t("reward.scoreBasis", { score: data.performance_score == null ? "—" : Math.round(data.performance_score) })}</p></div>
    <div className="crew-reward-hero-metrics">
      <div><small>{t("reward.maximumShare")}</small><strong>{money(data.maximum_share)}</strong></div>
      <div><small>{t("reward.rewardPool")}</small><strong>{money(data.reward_pool ?? data.configured_pool)}</strong></div>
      <div><small>{t("reward.contribution")}</small><strong>{rate(data.contribution_share, 2)}</strong></div>
    </div>
  </article>;
}

function PerformanceOverview({ data, onViewPerformance }) {
  const { t } = useTranslation();
  const score = Math.max(0, Math.min(100, Number(data.performance_score || 0)));
  return <section className="crew-reward-editorial crew-reward-performance">
    <header><h2>{t("reward.performanceOverview")} <span aria-hidden="true">→</span> {t("reward.estimatedReward")}</h2><button type="button" onClick={onViewPerformance}>{t("reward.viewPerformance")} <ChevronRight size={16} /></button></header>
    <div className="crew-reward-performance-relationship">
      <div><strong>{Math.round(score)}</strong><small>{t("reward.performanceScore", { score: Math.round(score) })}</small></div>
      <i aria-hidden="true">→</i>
      <div><strong>{rate(data.earn_rate)}</strong><small>{t("reward.currentRate")}</small></div>
    </div>
    <p className="crew-reward-performance-status"><em>{translateRewardLevel(data.performance_level, t) || translateStatus("ready_for_review", t)}</em>{t("reward.performanceCaption")}</p>
  </section>;
}

function RewardProjection({ data, onOpenSheet }) {
  const { t } = useTranslation();
  if (data.projection_applicable === false || ["finalized", "paid"].includes(data.cycle_status)) {
    return <article className="crew-reward-card crew-reward-finalized"><TrendingUp size={20} /><span><h2>{t("reward.finalized")}</h2><p>{t("reward.finalizedCaption")}</p></span></article>;
  }
  const allProjections = data.projections || [];
  const currentScore = Number(data.performance_score || 0);
  const currentProjection = allProjections.find((item) => item.key === "current") || allProjections[0];
  // A mobile progression must never move backwards from the actual current score.
  const potentialProjection = [...allProjections]
    .filter((item) => item !== currentProjection && Number(item.score || 0) > currentScore)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  return <section className="crew-reward-editorial crew-reward-projection">
    <header><h2><TrendingUp size={19} /> {t("reward.projection")}</h2><button type="button" onClick={() => onOpenSheet("help")}><Info size={15} /> {t("reward.howWorks")}</button></header>
    <div className="crew-reward-potential" aria-label={t("reward.projection")}>
      <div className="is-current"><strong>{money(currentProjection?.amount)}</strong><small>{translateProjectionLabel(currentProjection, t)}</small><span>{t("reward.score", { score: Math.round(Number(currentProjection?.score || currentScore)) })}</span><em>{t("reward.rateEarned", { rate: rate(currentProjection?.earn_rate) })}</em></div>
      <div className="crew-reward-potential-rail" aria-hidden="true"><i /><b /></div>
      <div className="is-potential"><strong>{money(potentialProjection?.amount ?? currentProjection?.amount)}</strong><small>{potentialProjection ? translateProjectionLabel(potentialProjection, t) : translateProjectionLabel(currentProjection, t)}</small><span>{t("reward.score", { score: potentialProjection?.key === "max" ? "95+" : Math.round(Number(potentialProjection?.score ?? currentProjection?.score ?? currentScore)) })}</span><em>{t("reward.rateEarned", { rate: rate(potentialProjection?.earn_rate ?? currentProjection?.earn_rate) })}</em></div>
    </div>
  </section>;
}

function RewardHistory({ history, onViewAll }) {
  const { t } = useTranslation();
  const recent = history?.[0];
  return <section className="crew-reward-editorial crew-reward-history-card">
    <header><span><h2><History size={18} /> {t("reward.history")}</h2><p>{t("reward.historyCaption")}</p></span>{history?.length ? <button type="button" onClick={onViewAll}>{t("reward.viewAll")} <ChevronRight size={16} /></button> : null}</header>
    {recent ? <button type="button" className="crew-reward-history-row" onClick={onViewAll}><time>{formatCrewDate(`${recent.period_start}T00:00:00`, { month: "short", year: "numeric" })}</time><span><strong>{money(recent.amount)}</strong><em>{translateStatus(recent.status, t)}</em></span><ChevronRight size={17} /></button> : <p className="crew-reward-history-empty"><History size={17} />{t("reward.noHistory")}</p>}
  </section>;
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
      <RewardHero data={data} />
      <PerformanceOverview data={data} onViewPerformance={onViewPerformance} />
      <RewardProjection data={data} onOpenSheet={setSheet} />
      <RewardHistory history={data.history || []} onViewAll={() => setSheet("history")} />
    </> : <article className="crew-reward-unavailable"><Gift size={30} /><h2>{translateStatus(data.status, t) || t("reward.notAvailable")}</h2><p>{data.eligibility_reason || data.explanation || t("reward.notAvailableYet")}</p></article>}

    {sheet === "help" && <Modal title={t("reward.formulaTitle")} onClose={() => setSheet(null)}><div className="crew-reward-modal-section"><strong>{t("reward.maximumShare")}</strong><p>{t("reward.maximumShareHelp")}</p><div className="crew-reward-formula"><small>{t("reward.rewardPool")} × {t("reward.contributionShare")}</small><strong>{money(data.reward_pool ?? data.configured_pool)} × {rate(data.contribution_share, 2)} = {money(data.maximum_share)}</strong></div></div><div className="crew-reward-modal-section"><strong>{t("reward.performanceEarnRate")}</strong><p>{t("reward.performanceEarnRateHelp")}</p><div className="crew-reward-formula is-result"><small>{t("reward.maximumShare")} × {t("reward.performanceEarnRate")}</small><strong>{money(data.maximum_share)} × {rate(data.earn_rate)} = {money(data.reward_amount ?? data.estimated_reward)}</strong></div></div><TierTable tiers={tiers} /></Modal>}
    {sheet === "history" && <Modal title={t("reward.history")} onClose={() => setSheet(null)}><div className="crew-reward-modal-history">{(data.history || []).map((item) => <div key={item.period_start}><time>{formatCrewDate(`${item.period_start}T00:00:00`, { month: "long", year: "numeric" })}</time><span><strong>{money(item.amount)}</strong><small>{translateStatus(item.status, t)}</small></span></div>)}</div></Modal>}
  </section>;
}
