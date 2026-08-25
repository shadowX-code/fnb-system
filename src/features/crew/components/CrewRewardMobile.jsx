import { useEffect, useMemo, useRef, useState } from "react";
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
  X,
} from "lucide-react";
import { formatCrewDate, formatCrewMoney, translateStatus } from "../utils/crewI18n.js";
import { CrewMobilePageHeader } from "./CrewMobileUI.jsx";

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

function RewardHeroOrbit() {
  return <svg className="crew-reward-hero-orbit" viewBox="0 0 500 300" aria-hidden="true">
    <defs>
      <radialGradient id="crew-reward-planet-depth" cx="18%" cy="18%" r="82%"><stop stopColor="#0d5260" stopOpacity=".42" /><stop offset=".58" stopColor="#062a36" stopOpacity=".45" /><stop offset="1" stopColor="#021923" stopOpacity=".92" /></radialGradient>
      <linearGradient id="crew-reward-orbit-cyan" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#00b7c7" stopOpacity="0" /><stop offset=".35" stopColor="#8af7ef" stopOpacity=".86" /><stop offset=".64" stopColor="#00b7c7" stopOpacity=".28" /><stop offset="1" stopColor="#00b7c7" stopOpacity="0" /></linearGradient>
      <filter id="crew-reward-orbit-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5" /></filter>
    </defs>
    <circle className="crew-reward-hero-planet" cx="486" cy="-55" r="202" fill="url(#crew-reward-planet-depth)" />
    <g className="crew-reward-hero-orbit-rings crew-reward-hero-orbit-rings-a" fill="none" stroke="currentColor">
      <circle cx="486" cy="-55" r="211" strokeOpacity=".18" strokeWidth="1" />
      <circle cx="486" cy="-55" r="186" strokeOpacity=".13" strokeWidth="1" />
      <circle cx="486" cy="-55" r="162" strokeOpacity=".1" strokeWidth="1" />
      <path d="M275 5A211 211 0 0 1 486 -266" stroke="url(#crew-reward-orbit-cyan)" strokeWidth="2" />
      <path d="M310 34A186 186 0 0 1 516 -238" stroke="url(#crew-reward-orbit-cyan)" strokeWidth="1.5" />
      <path d="M344 57A162 162 0 0 1 540 -215" stroke="url(#crew-reward-orbit-cyan)" strokeWidth="1" />
    </g>
    <g className="crew-reward-hero-orbit-rings crew-reward-hero-orbit-rings-b" fill="none" stroke="currentColor">
      <path className="crew-reward-hero-glow-arc" d="M294 11A205 205 0 0 1 425 -247" stroke="#7ef5ed" strokeOpacity=".72" strokeWidth="2.8" filter="url(#crew-reward-orbit-glow)" />
      <path d="M430 151A183 183 0 0 1 605 36" stroke="#74f4ed" strokeOpacity=".45" strokeWidth="2.1" filter="url(#crew-reward-orbit-glow)" />
      <path d="M342 56A161 161 0 0 1 503 -215" stroke="#00b7c7" strokeOpacity=".34" strokeWidth="1.4" />
    </g>
    <g className="crew-reward-hero-nodes" fill="#81f7ef" stroke="none">
      <circle cx="287" cy="15" r="3" fillOpacity=".86" />
      <circle cx="353" cy="64" r="2.3" fillOpacity=".72" />
      <circle cx="421" cy="115" r="2.6" fillOpacity=".7" />
      <circle cx="239" cy="88" r="1.9" fillOpacity=".52" />
    </g>
  </svg>;
}

function HeroInfoButton({ onOpen }) {
  const { t } = useTranslation();
  return <button className="crew-reward-hero-info" type="button" aria-label={t("reward.help")} onClick={onOpen}><Info size={14} /></button>;
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
    gsap.to(root.querySelector(".crew-reward-hero-planet"), { scale: 1.015, transformOrigin: "486px -55px", duration: 12, ease: "sine.inOut", repeat: -1, yoyo: true });
    gsap.to(root.querySelector(".crew-reward-hero-orbit-rings-a"), { rotation: 1.8, svgOrigin: "486 -55", duration: 24, ease: "sine.inOut", repeat: -1, yoyo: true });
    gsap.to(root.querySelector(".crew-reward-hero-orbit-rings-b"), { rotation: -1.2, svgOrigin: "486 -55", duration: 29, ease: "sine.inOut", repeat: -1, yoyo: true });
    gsap.to(root.querySelector(".crew-reward-hero-glow-arc"), { opacity: .45, duration: 9, ease: "sine.inOut", repeat: -1, yoyo: true });
    gsap.to(root.querySelectorAll(".crew-reward-hero-nodes circle"), { x: (index) => index % 2 ? -3 : 3, y: (index) => index % 2 ? 2 : -2, opacity: .55, duration: 5.5, ease: "sine.inOut", stagger: .45, repeat: -1, yoyo: true });
    return undefined;
  }, { scope: heroRef });
  return <article ref={heroRef} className="crew-reward-hero">
    <RewardHeroOrbit />
    <div className="crew-reward-hero-kicker"><span>{t("reward.thisMonth")}</span><em>{translateStatus(data.status, t)}</em></div>
    <div className="crew-reward-hero-total"><small>{label}<HeroInfoButton onOpen={() => onOpenSheet("help")} /></small><strong ref={amountRef}>{money(amount)}</strong><p>{t("reward.scoreBasis", { score: data.performance_score == null ? "—" : Math.round(data.performance_score) })}</p></div>
    <div className="crew-reward-hero-metrics">
      <div><small>{t("reward.maximumShare")}<HeroInfoButton onOpen={() => onOpenSheet("help")} /></small><strong>{money(data.maximum_share)}</strong></div>
      <div><small>{t("reward.rewardPool")}<HeroInfoButton onOpen={() => onOpenSheet("help")} /></small><strong>{money(data.reward_pool ?? data.configured_pool)}</strong></div>
      <div><small>{t("reward.contribution")}<HeroInfoButton onOpen={() => onOpenSheet("help")} /></small><strong>{rate(data.contribution_share, 2)}</strong></div>
    </div>
  </article>;
}

function PerformanceOverview({ data, onViewPerformance }) {
  const { t } = useTranslation();
  const score = Math.max(0, Math.min(100, Number(data.performance_score || 0)));
  return <section className="crew-reward-surface crew-reward-performance">
    <header><h2 className="crew-reward-performance-title">{t("reward.performanceScore", { score: "" })}</h2><button type="button" onClick={onViewPerformance}>{t("reward.viewPerformance")} <ChevronRight size={16} /></button></header>
    <div className="crew-reward-performance-relationship">
      <div className="crew-reward-performance-score"><strong>{Math.round(score)}</strong><span>/100</span><small>{t("reward.performanceScore", { score: "" })}</small></div>
      <i aria-hidden="true">→</i>
      <div className="crew-reward-performance-rate"><strong>{rate(data.earn_rate)}</strong><small>{t("reward.currentRate")}</small></div>
    </div>
    <p className="crew-reward-performance-status"><em>{translateRewardLevel(data.performance_level, t) || translateStatus("ready_for_review", t)}</em></p>
    <button className="crew-reward-performance-insight" type="button" onClick={() => onViewPerformance?.()}><TrendingUp size={18} /><span>{t("reward.performanceCaption")}</span><b>{t("reward.earnRateWorks")} <ChevronRight size={15} /></b></button>
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
      <div className="crew-reward-potential-rail" style={{ "--crew-reward-progress": `${earnedRate * 100}%` }} aria-hidden="true"><i /><b /></div>
      <div className="crew-reward-potential-scale"><span>{t("reward.score", { score: Math.round(Number(currentProjection?.score || currentScore)) })}<em>{t("reward.rateEarned", { rate: rate(currentProjection?.earn_rate) })}</em></span><span>0%</span><span>50%</span><span>100%</span><span>{t("reward.score", { score: potentialProjection?.key === "max" ? "95+" : Math.round(Number(potentialProjection?.score ?? currentProjection?.score ?? currentScore)) })}<em>{t("reward.rateEarned", { rate: rate(potentialProjection?.earn_rate ?? currentProjection?.earn_rate) })}</em></span></div>
    </div>
    <p className="crew-reward-projection-note"><Info size={18} />{t("reward.projectionAssumption", { contribution: rate(data.contribution_share, 2) })}</p>
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
      <PerformanceOverview data={data} onViewPerformance={onViewPerformance} />
      <RewardProjection data={data} onOpenSheet={setSheet} />
      <RewardHistory history={data.history || []} onViewAll={() => setSheet("history")} />
    </> : <article className="crew-reward-unavailable"><Gift size={30} /><h2>{translateStatus(data.status, t) || t("reward.notAvailable")}</h2><p>{data.eligibility_reason || data.explanation || t("reward.notAvailableYet")}</p></article>}

    {sheet === "help" && <Modal title={t("reward.formulaTitle")} onClose={() => setSheet(null)}><div className="crew-reward-modal-section"><strong>{t("reward.maximumShare")}</strong><p>{t("reward.maximumShareHelp")}</p><div className="crew-reward-formula"><small>{t("reward.rewardPool")} × {t("reward.contributionShare")}</small><strong>{money(data.reward_pool ?? data.configured_pool)} × {rate(data.contribution_share, 2)} = {money(data.maximum_share)}</strong></div></div><div className="crew-reward-modal-section"><strong>{t("reward.performanceEarnRate")}</strong><p>{t("reward.performanceEarnRateHelp")}</p><div className="crew-reward-formula is-result"><small>{t("reward.maximumShare")} × {t("reward.performanceEarnRate")}</small><strong>{money(data.maximum_share)} × {rate(data.earn_rate)} = {money(data.reward_amount ?? data.estimated_reward)}</strong></div></div><TierTable tiers={tiers} /></Modal>}
    {sheet === "history" && <Modal title={t("reward.history")} onClose={() => setSheet(null)}><div className="crew-reward-modal-history">{(data.history || []).map((item) => <div key={item.period_start}><time>{formatCrewDate(`${item.period_start}T00:00:00`, { month: "long", year: "numeric" })}</time><span><strong>{money(item.amount)}</strong><small>{translateStatus(item.status, t)}</small></span></div>)}</div></Modal>}
  </section>;
}
