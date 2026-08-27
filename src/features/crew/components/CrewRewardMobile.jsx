import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import "../../../i18n/index.js";
import {
  ChevronRight,
  CircleHelp,
  Gift,
  History,
  Info,
  TrendingUp,
} from "lucide-react";
import { formatCrewDate, formatCrewMoney, translateStatus } from "../utils/crewI18n.js";
import { CrewMobilePageHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";
import CrewMobileModal from "./CrewMobileModal.jsx";
import rewardHeroBackground from "../assets/reward-hero-approved.png";

gsap.registerPlugin(useGSAP);

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

function TierTable({ tiers }) {
  const { t } = useTranslation();
  return <div className="crew-reward-tier-table" aria-label={t("reward.rateTable")}>
    <div><b>{t("reward.scoreRange")}</b><b>{t("reward.level")}</b><b>{t("reward.earnRate")}</b></div>
    {tiers.map((tier) => <div key={tier.range}><span>{tier.range}</span><span>{tier.level}</span><strong>{rate(tier.rate)}</strong></div>)}
  </div>;
}

function RewardHeroMotion({ pathRef }) {
  return <>
    <span className="crew-reward-hero-sheen" aria-hidden="true" />
    <svg className="crew-reward-hero-light-path" viewBox="0 0 390 232" preserveAspectRatio="none" aria-hidden="true">
      <path ref={pathRef} d="M194 169 C252 169 311 122 390 119" />
      <g className="crew-reward-hero-light-pulse" transform="translate(194 169)"><circle className="crew-reward-hero-light-bloom" r="5" /><circle className="crew-reward-hero-light-core" r="2.35" /></g>
    </svg>
  </>;
}

function HeroInfoButton({ label, onOpen }) {
  const { t } = useTranslation();
  return <button className="crew-reward-hero-info" type="button" aria-label={label || t("reward.help")} onClick={onOpen}><span aria-hidden="true">i</span></button>;
}

function RewardHero({ data, onOpenSheet }) {
  const { t } = useTranslation();
  const heroRef = useRef(null);
  const amountRef = useRef(null);
  const pathRef = useRef(null);
  const previousAmountRef = useRef(0);
  const hasPresentedRef = useRef(false);
  const label = data.cycle_status === "paid" ? t("reward.paidReward") : data.cycle_status === "finalized" ? t("reward.finalReward") : t("reward.estimatedReward");
  const amount = Number(data.reward_amount ?? data.estimated_reward ?? 0);
  useGSAP(() => {
    const root = heroRef.current;
    if (!root || !amountRef.current) return undefined;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const startAmount = hasPresentedRef.current ? previousAmountRef.current : 0;
    if (reducedMotion) {
      amountRef.current.textContent = money(amount);
      previousAmountRef.current = amount;
      hasPresentedRef.current = true;
      return undefined;
    }

    const value = { amount: startAmount };
    amountRef.current.textContent = money(startAmount);
    const reveal = gsap.to(value, {
      amount,
      duration: hasPresentedRef.current ? .72 : .84,
      ease: "power2.out",
      onUpdate: () => { if (amountRef.current) amountRef.current.textContent = money(value.amount); },
    });
    const sheen = root.querySelector(".crew-reward-hero-sheen");
    const sheenSweep = gsap.timeline({ delay: .12, repeat: -1, repeatDelay: 2.4 })
      .set(sheen, { xPercent: -12, opacity: .06 })
      .to(sheen, { xPercent: 16, opacity: .38, duration: 6.4, ease: "sine.inOut" })
      .to(sheen, { opacity: .07, duration: 1.1, ease: "sine.inOut" });
    const path = pathRef.current;
    const pulse = root.querySelector(".crew-reward-hero-light-pulse");
    let pathSweep = null;
    if (path && pulse && typeof path.getTotalLength === "function" && typeof path.getPointAtLength === "function") {
      const length = path.getTotalLength();
      const start = path.getPointAtLength(0);
      const progress = { value: 0 };
      const positionPulse = () => {
        const point = path.getPointAtLength(length * progress.value);
        gsap.set(pulse, { x: point.x - start.x, y: point.y - start.y });
      };
      positionPulse();
      pathSweep = gsap.timeline({ delay: .7, repeat: -1, repeatDelay: 2.6 })
        .set(pulse, { opacity: 0 })
        .to(pulse, { opacity: 1, duration: .22, ease: "sine.out" })
        .to(progress, { value: 1, duration: 5.2, ease: "none", onUpdate: positionPulse }, 0)
        .to(pulse, { opacity: 0, duration: .28, ease: "sine.in" }, "<4.92");
    }
    previousAmountRef.current = amount;
    hasPresentedRef.current = true;
    return () => {
      reveal.kill();
      sheenSweep.kill();
      pathSweep?.kill();
    };
  }, { scope: heroRef, dependencies: [amount], revertOnUpdate: true });
  return <article ref={heroRef} className="crew-reward-hero" style={{ "--crew-reward-hero-background": `url(${rewardHeroBackground})` }}>
    <RewardHeroMotion pathRef={pathRef} />
    <div className="crew-reward-hero-kicker"><span>{t("reward.thisMonth")}</span><em>{translateStatus(data.status, t)}</em></div>
    <div className="crew-reward-hero-total"><small>{label}<HeroInfoButton label={t("reward.estimatedReward")} onOpen={() => onOpenSheet("estimated-reward")} /></small><strong aria-label={money(amount)}><span ref={amountRef} aria-hidden="true">{money(0)}</span><span className="sr-only" aria-hidden="true">{money(amount)}</span></strong></div>
    <div className="crew-reward-hero-metrics">
      <div><small>{t("reward.maximumShare")}<HeroInfoButton label={t("reward.maximumShare")} onOpen={() => onOpenSheet("maximum-share")} /></small><strong>{money(data.maximum_share)}</strong></div>
      <div><small>{t("reward.rewardPool")}<HeroInfoButton label={t("reward.rewardPool")} onOpen={() => onOpenSheet("reward-pool")} /></small><strong>{money(data.reward_pool ?? data.configured_pool)}</strong></div>
      <div><small>{t("reward.contribution")}<HeroInfoButton label={t("reward.contribution")} onOpen={() => onOpenSheet("contribution")} /></small><strong>{rate(data.contribution_share, 2)}</strong></div>
    </div>
  </article>;
}

function ScoreRing({ score }) {
  return <div className="crew-reward-score-ring" aria-label={`${Math.round(score)} / 100`}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle className="crew-reward-score-ring-track" cx="50" cy="50" r="43" pathLength="100" />
      <circle className="crew-reward-score-ring-progress" cx="50" cy="50" r="43" pathLength="100" strokeDasharray={`${score} 100`} />
    </svg>
    <span><strong>{Math.round(score)}</strong><b>/100</b></span>
  </div>;
}

function PerformanceOverview({ data, onViewPerformance }) {
  const { t } = useTranslation();
  const relationshipRef = useRef(null);
  const hasPresentedRef = useRef(false);
  const score = Math.max(0, Math.min(100, Number(data.performance_score || 0)));
  useGSAP(() => {
    const root = relationshipRef.current;
    if (!root || hasPresentedRef.current || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return undefined;
    const scoreGroup = root.querySelector(".crew-reward-performance-score");
    const connectorFlow = root.querySelector(".crew-reward-performance-connector-flow");
    const rateGroup = root.querySelector(".crew-reward-performance-rate");
    if (!scoreGroup || !connectorFlow || !rateGroup) return undefined;
    const timeline = gsap.timeline();
    timeline
      .to(scoreGroup, { scale: 1.018, duration: .16, ease: "power2.out" })
      .to(scoreGroup, { scale: 1, duration: .18, ease: "power2.inOut" })
      .fromTo(connectorFlow, { scaleX: .08, opacity: .1 }, { scaleX: 1, opacity: .94, duration: .26, ease: "power2.out" }, .14)
      .to(connectorFlow, { opacity: .3, duration: .18, ease: "sine.out" })
      .to(rateGroup, { scale: 1.025, duration: .16, ease: "power2.out" }, .38)
      .to(rateGroup, { scale: 1, duration: .18, ease: "power2.inOut" });
    hasPresentedRef.current = true;
    return () => timeline.kill();
  }, { scope: relationshipRef, dependencies: [score, data.earn_rate], revertOnUpdate: true });
  return <section className="crew-reward-performance">
    <div ref={relationshipRef} className="crew-reward-performance-relationship">
      <button className="crew-reward-performance-score" type="button" aria-label={t("reward.viewPerformance")} onClick={onViewPerformance}><ScoreRing score={score} /><small>{t("reward.performanceScoreLabel")}<ChevronRight size={15} aria-hidden="true" /></small></button>
      <span className="crew-reward-performance-connector" aria-hidden="true"><i className="crew-reward-performance-connector-track" /><i className="crew-reward-performance-connector-flow" /><ChevronRight className="crew-reward-performance-connector-arrow" size={15} /></span>
      <div className="crew-reward-performance-rate"><span><strong>{rate(data.earn_rate)}</strong><HeroInfoButton label={t("reward.currentRate")} onOpen={() => onViewPerformance?.("earn-rate")} /></span><small>{t("reward.currentRate")}</small><CrewStatusBadge tone="success">{translateRewardLevel(data.performance_level, t) || translateStatus("ready_for_review", t)}</CrewStatusBadge></div>
    </div>
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
  const earnedRate = Math.max(0, Math.min(1, Number(currentProjection?.earn_rate ?? data.earn_rate ?? 0)));
  return <section className="crew-reward-surface crew-reward-projection">
    <header><h2>{t("reward.estimatedReward")}</h2><button type="button" onClick={() => onOpenSheet("help")}>{t("reward.howWorks")} <Info size={15} /></button></header>
    <div className="crew-reward-potential" aria-label={t("reward.projection")}>
      <div className="is-current"><strong>{money(currentProjection?.amount)}</strong><small>{translateProjectionLabel(currentProjection, t)}</small></div>
      <div className="is-potential"><strong>{money(potentialProjection?.amount ?? currentProjection?.amount)}</strong><small>{t("reward.maxPotential")}</small></div>
      <div className="crew-reward-potential-scale"><span>{t("reward.score", { score: Math.round(Number(currentProjection?.score || currentScore)) })}<em>{t("reward.rateEarned", { rate: rate(currentProjection?.earn_rate) })}</em></span><span>{t("reward.score", { score: potentialProjection?.key === "max" ? "95+" : Math.round(Number(potentialProjection?.score ?? currentProjection?.score ?? currentScore)) })}<em>{t("reward.rateEarned", { rate: rate(potentialProjection?.earn_rate ?? currentProjection?.earn_rate) })}</em></span></div>
      <div className="crew-reward-potential-rail" style={{ "--crew-reward-progress": `${earnedRate * 100}%` }} aria-hidden="true"><i /><b /></div>
    </div>
    <p className="crew-reward-projection-note"><Info size={15} />{t("reward.projectionAssumption")}</p>
  </section>;
}

function RewardHistory({ history, onViewAll }) {
  const { t } = useTranslation();
  const recent = history?.[0];
  return <section className="crew-reward-surface crew-reward-history-card">
    <header><span><h2><History size={18} /> {t("reward.history")}</h2><p>{t("reward.historyCaption")}</p></span>{history?.length ? <button type="button" onClick={onViewAll}>{t("reward.viewAll")} <ChevronRight size={16} /></button> : null}</header>
    {recent ? <button type="button" className="crew-reward-history-row" onClick={onViewAll}><time>{formatCrewDate(`${recent.period_start}T00:00:00`, { month: "short", year: "numeric" })}</time><span><strong>{money(recent.amount)}</strong><em>{translateStatus(recent.status, t)}</em></span><ChevronRight size={17} /></button> : <div className="crew-reward-history-empty"><span className="crew-ui-icon-container"><History size={19} /></span><strong>{t("reward.noHistory")}</strong><p>{t("reward.historyCaption")}</p></div>}
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
      <RewardHero data={data} onOpenSheet={setSheet} />
      <PerformanceOverview data={data} onViewPerformance={(sheetName) => sheetName === "earn-rate" ? setSheet("earn-rate") : onViewPerformance?.()} />
      <RewardProjection data={data} onOpenSheet={setSheet} />
      <RewardHistory history={data.history || []} onViewAll={() => setSheet("history")} />
    </> : <article className="crew-reward-unavailable"><Gift size={30} /><h2>{translateStatus(data.status, t) || t("reward.notAvailable")}</h2><p>{data.eligibility_reason || data.explanation || t("reward.notAvailableYet")}</p></article>}

    {sheet === "help" && <CrewMobileModal title={t("reward.formulaTitle")} onClose={() => setSheet(null)}><div className="crew-reward-modal-section"><strong>{t("reward.maximumShare")}</strong><p>{t("reward.maximumShareHelp")}</p><div className="crew-reward-formula"><small>{t("reward.rewardPool")} × {t("reward.contributionShare")}</small><strong>{money(data.reward_pool ?? data.configured_pool)} × {rate(data.contribution_share, 2)} = {money(data.maximum_share)}</strong></div></div><div className="crew-reward-modal-section"><strong>{t("reward.performanceEarnRate")}</strong><p>{t("reward.performanceEarnRateHelp")}</p><div className="crew-reward-formula is-result"><small>{t("reward.maximumShare")} × {t("reward.performanceEarnRate")}</small><strong>{money(data.maximum_share)} × {rate(data.earn_rate)} = {money(data.reward_amount ?? data.estimated_reward)}</strong></div></div></CrewMobileModal>}
    {sheet === "estimated-reward" && <CrewMobileModal title={t("reward.estimatedReward")} onClose={() => setSheet(null)}><div className="crew-reward-modal-section"><p>{t("reward.estimatedRewardHelp")}</p></div></CrewMobileModal>}
    {sheet === "maximum-share" && <CrewMobileModal title={t("reward.maximumShare")} onClose={() => setSheet(null)}><div className="crew-reward-modal-section"><p>{t("reward.maximumShareHelp")}</p></div></CrewMobileModal>}
    {sheet === "reward-pool" && <CrewMobileModal title={t("reward.rewardPool")} onClose={() => setSheet(null)}><div className="crew-reward-modal-section"><p>{t("reward.rewardPoolHelp")}</p></div></CrewMobileModal>}
    {sheet === "contribution" && <CrewMobileModal title={t("reward.contribution")} onClose={() => setSheet(null)}><div className="crew-reward-modal-section"><p>{t("reward.contributionHelp")}</p></div></CrewMobileModal>}
    {sheet === "earn-rate" && <CrewMobileModal title={t("reward.currentRate")} onClose={() => setSheet(null)}><div className="crew-reward-modal-section"><p>{t("reward.performanceEarnRateHelp")}</p></div><TierTable tiers={tiers} /></CrewMobileModal>}
    {sheet === "history" && <CrewMobileModal title={t("reward.history")} onClose={() => setSheet(null)}><div className="crew-reward-modal-history">{(data.history || []).map((item) => <div key={item.period_start}><time>{formatCrewDate(`${item.period_start}T00:00:00`, { month: "long", year: "numeric" })}</time><span><strong>{money(item.amount)}</strong><small>{translateStatus(item.status, t)}</small></span></div>)}</div></CrewMobileModal>}
  </section>;
}
