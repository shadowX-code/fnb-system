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

function RewardHeroOrbit() {
  return <svg className="crew-reward-hero-orbit" viewBox="0 0 500 300" aria-hidden="true">
    <defs>
      <radialGradient id="crew-reward-planet-depth" cx="18%" cy="18%" r="82%"><stop stopColor="#075265" stopOpacity=".28" /><stop offset=".34" stopColor="#052d3c" stopOpacity=".32" /><stop offset=".66" stopColor="#031827" stopOpacity=".9" /><stop offset="1" stopColor="#010b15" stopOpacity=".98" /></radialGradient>
      <radialGradient id="crew-reward-orbit-bloom" cx="50%" cy="50%" r="54%"><stop stopColor="#60f5ff" stopOpacity=".14" /><stop offset=".23" stopColor="#00b7c7" stopOpacity=".07" /><stop offset=".62" stopColor="#007b99" stopOpacity=".025" /><stop offset="1" stopColor="#002235" stopOpacity="0" /></radialGradient>
      <linearGradient id="crew-reward-orbit-cyan" x1="0" y1=".12" x2=".85" y2=".82"><stop stopColor="#00b7c7" stopOpacity="0" /><stop offset=".28" stopColor="#3defff" stopOpacity=".56" /><stop offset=".5" stopColor="#dffcff" stopOpacity=".94" /><stop offset=".72" stopColor="#00b7c7" stopOpacity=".36" /><stop offset="1" stopColor="#006e88" stopOpacity="0" /></linearGradient>
      <filter id="crew-reward-orbit-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="4.2" /></filter>
    </defs>
    <circle className="crew-reward-hero-bloom" cx="507" cy="-50" r="265" fill="url(#crew-reward-orbit-bloom)" />
    <circle className="crew-reward-hero-planet" cx="507" cy="-50" r="278" fill="url(#crew-reward-planet-depth)" />
    <g className="crew-reward-hero-orbit-rings crew-reward-hero-orbit-rings-a" fill="none" stroke="currentColor">
      <circle cx="507" cy="-50" r="312" strokeOpacity=".24" strokeWidth=".9" />
      <circle cx="507" cy="-50" r="284" strokeOpacity=".2" strokeWidth=".9" />
      <circle cx="507" cy="-50" r="256" strokeOpacity=".16" strokeWidth=".85" />
      <circle cx="507" cy="-50" r="230" strokeOpacity=".12" strokeWidth=".8" />
      <circle cx="507" cy="-50" r="204" strokeOpacity=".09" strokeWidth=".75" />
      <circle cx="507" cy="-50" r="284" stroke="url(#crew-reward-orbit-cyan)" strokeWidth="2.2" strokeDasharray="272 1513" strokeDashoffset="-597" />
      <circle cx="507" cy="-50" r="256" stroke="url(#crew-reward-orbit-cyan)" strokeWidth="1.35" strokeDasharray="214 1394" strokeDashoffset="-512" />
      <circle cx="507" cy="-50" r="230" stroke="url(#crew-reward-orbit-cyan)" strokeWidth="1" strokeDasharray="148 1297" strokeDashoffset="-435" />
    </g>
    <g className="crew-reward-hero-orbit-rings crew-reward-hero-orbit-rings-b" fill="none" stroke="currentColor">
      <circle className="crew-reward-hero-glow-arc" cx="507" cy="-50" r="284" stroke="#e8feff" strokeOpacity=".88" strokeWidth="4.2" strokeDasharray="224 1561" strokeDashoffset="-604" filter="url(#crew-reward-orbit-glow)" />
      <circle cx="507" cy="-50" r="284" stroke="#9dfaff" strokeOpacity=".92" strokeWidth="2.4" strokeDasharray="208 1577" strokeDashoffset="-604" />
      <circle cx="507" cy="-50" r="312" stroke="#3defff" strokeOpacity=".4" strokeWidth="1.4" strokeDasharray="142 1819" strokeDashoffset="-661" filter="url(#crew-reward-orbit-glow)" />
      <circle cx="507" cy="-50" r="256" stroke="#00b7c7" strokeOpacity=".32" strokeWidth="1.2" strokeDasharray="92 1516" strokeDashoffset="-468" />
    </g>
    <g className="crew-reward-hero-nodes" fill="#81f7ef" stroke="none">
      <circle cx="378" cy="-18" r="2.2" fillOpacity=".76" />
      <circle cx="420" cy="32" r="3.1" fillOpacity=".9" />
      <circle cx="330" cy="92" r="3.2" fillOpacity=".86" />
      <circle cx="468" cy="154" r="2.4" fillOpacity=".7" />
    </g>
    <g className="crew-reward-hero-particles" fill="#81f7ef" stroke="none">
      <circle cx="296" cy="6" r="1.5" fillOpacity=".44" />
      <circle cx="366" cy="48" r="1.4" fillOpacity=".36" />
      <circle cx="273" cy="116" r="1.2" fillOpacity=".32" />
      <circle cx="447" cy="95" r="1.3" fillOpacity=".3" />
    </g>
  </svg>;
}

function HeroInfoButton({ label, onOpen }) {
  const { t } = useTranslation();
  return <button className="crew-reward-hero-info" type="button" aria-label={label || t("reward.help")} onClick={onOpen}><span aria-hidden="true">i</span></button>;
}

function RewardHero({ data, onOpenSheet }) {
  const { t } = useTranslation();
  const heroRef = useRef(null);
  const amountRef = useRef(null);
  const label = data.cycle_status === "paid" ? t("reward.paidReward") : data.cycle_status === "finalized" ? t("reward.finalReward") : t("reward.estimatedReward");
  const amount = Number(data.reward_amount ?? data.estimated_reward ?? 0);
  useGSAP(() => {
    const root = heroRef.current;
    if (!root || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const content = root.querySelectorAll(".crew-reward-hero-kicker, .crew-reward-hero-total small, .crew-reward-hero-total p, .crew-reward-hero-metrics > div");
    const value = { amount: 0 };
    const timeline = gsap.timeline({ defaults: { ease: "power2.out" } });
    timeline
      .fromTo(root, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: .76 })
      .fromTo(content, { autoAlpha: 0, y: 7 }, { autoAlpha: 1, y: 0, duration: .34, stagger: .05 }, "<.18")
      .fromTo(amountRef.current, { autoAlpha: 0, y: 7 }, { autoAlpha: 1, y: 0, duration: .38 }, "<.08")
      .to(value, { amount, duration: .56, ease: "power1.out", onUpdate: () => { if (amountRef.current) amountRef.current.textContent = money(value.amount); } }, "<");
    gsap.to(root.querySelector(".crew-reward-hero-planet"), { scale: 1.012, transformOrigin: "507px -50px", duration: 12, ease: "sine.inOut", repeat: -1, yoyo: true });
    gsap.to(root.querySelector(".crew-reward-hero-orbit-rings-a"), { rotation: 1.2, svgOrigin: "507 -50", duration: 26, ease: "sine.inOut", repeat: -1, yoyo: true });
    gsap.to(root.querySelector(".crew-reward-hero-orbit-rings-b"), { rotation: -.85, svgOrigin: "507 -50", duration: 31, ease: "sine.inOut", repeat: -1, yoyo: true });
    gsap.to(root.querySelector(".crew-reward-hero-glow-arc"), { opacity: .45, duration: 9, ease: "sine.inOut", repeat: -1, yoyo: true });
    gsap.to(root.querySelectorAll(".crew-reward-hero-nodes circle"), { x: (index) => index % 2 ? -3 : 3, y: (index) => index % 2 ? 2 : -2, opacity: .55, duration: 5.5, ease: "sine.inOut", stagger: .45, repeat: -1, yoyo: true });
    return undefined;
  }, { scope: heroRef });
  return <article ref={heroRef} className="crew-reward-hero">
    <RewardHeroOrbit />
    <div className="crew-reward-hero-kicker"><span>{t("reward.thisMonth")}</span><em>{translateStatus(data.status, t)}</em></div>
    <div className="crew-reward-hero-total"><small>{label}<HeroInfoButton label={t("reward.estimatedReward")} onOpen={() => onOpenSheet("estimated-reward")} /></small><strong ref={amountRef}>{money(amount)}</strong><p>{t("reward.scoreBasis", { score: data.performance_score == null ? "—" : Math.round(data.performance_score) })}</p></div>
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
  const score = Math.max(0, Math.min(100, Number(data.performance_score || 0)));
  return <section className="crew-reward-surface crew-reward-performance">
    <header><button type="button" onClick={onViewPerformance}>{t("reward.viewPerformance")} <ChevronRight size={16} /></button></header>
    <div className="crew-reward-performance-relationship">
      <div className="crew-reward-performance-score"><ScoreRing score={score} /><small>{t("reward.performanceScoreLabel")}</small></div>
      <span className="crew-reward-performance-connector" aria-hidden="true"><ChevronRight size={16} /></span>
      <div className="crew-reward-performance-rate"><span><strong>{rate(data.earn_rate)}</strong><HeroInfoButton label={t("reward.currentRate")} onOpen={() => onViewPerformance?.("earn-rate")} /></span><small>{t("reward.currentRate")}</small><CrewStatusBadge tone="success">{translateRewardLevel(data.performance_level, t) || translateStatus("ready_for_review", t)}</CrewStatusBadge></div>
    </div>
    <button className="crew-reward-performance-rate-action" type="button" onClick={() => onViewPerformance?.("earn-rate")}>{t("reward.earnRateWorks")} <ChevronRight size={15} /></button>
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
