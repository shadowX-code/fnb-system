import { useEffect, useMemo, useRef, useState } from "react";
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
import rewardArtwork from "../../../assets/crew/reward-trophy-gift.png";

const money = (value) => `RM ${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rate = (value, digits = 0) => `${(Number(value || 0) * 100).toFixed(digits)}%`;
const statusCopy = {
  qualified: "Qualified",
  finalized: "Finalized",
  paid: "Paid",
  not_eligible: "Not Eligible",
  awaiting_performance: "Awaiting Performance",
  not_available: "Not Available",
};
const defaultTiers = [
  { range: "95–100", level: "Outstanding", rate: 1 },
  { range: "90–94", level: "Excellent", rate: .9 },
  { range: "85–89", level: "Strong", rate: .8 },
  { range: "80–84", level: "Good", rate: .65 },
  { range: "75–79", level: "Meets Standard", rate: .45 },
  { range: "70–74", level: "Developing", rate: .2 },
  { range: "<70", level: "Below Standard", rate: 0 },
];

function Modal({ title, onClose, children }) {
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
      <header><h2>{title}</h2><button ref={closeRef} type="button" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
      <div>{children}</div>
    </section>
  </div>;
}

function InfoButton({ label, onClick }) {
  return <button type="button" className="crew-reward-inline-info" aria-label={label} onClick={onClick}><Info size={12} /></button>;
}

function TierTable({ tiers }) {
  return <div className="crew-reward-tier-table" aria-label="Performance earn rate table">
    <div><b>Score Range</b><b>Level</b><b>Earn Rate</b></div>
    {tiers.map((tier) => <div key={tier.range}><span>{tier.range}</span><span>{tier.level}</span><strong>{rate(tier.rate)}</strong></div>)}
  </div>;
}

function RewardHero({ data, onOpenModal }) {
  const contribution = Math.max(0, Math.min(1, Number(data.contribution_share || 0)));
  const label = data.reward_label || (data.cycle_status === "paid" ? "Paid Reward" : data.cycle_status === "finalized" ? "Final Reward" : "Estimated Reward");
  return <article className="crew-reward-hero">
    <img src={rewardArtwork} alt="" className="crew-reward-art" />
    <div className="crew-reward-hero-kicker"><span>This Month</span><em>{statusCopy[data.status] || data.status}</em></div>
    <div className="crew-reward-hero-total"><small>{label} <InfoButton label={`About ${label}`} onClick={() => onOpenModal("help")} /></small><strong>{money(data.reward_amount ?? data.estimated_reward)}</strong><p>Based on your current performance score of {data.performance_score == null ? "—" : Math.round(data.performance_score)}.</p></div>
    <div className="crew-reward-hero-metrics">
      <div className="is-maximum"><small>You can earn up to <InfoButton label="About maximum share" onClick={() => onOpenModal("maximum")} /></small><strong>{money(data.maximum_share)}</strong><p>100% of your maximum share</p></div>
      <div className="is-contribution"><span><small>Your Contribution <InfoButton label="About contribution share" onClick={() => onOpenModal("contribution")} /></small><p>{Number(data.eligible_hours || 0).toFixed(1)}h of {Number(data.total_eligible_hours || 0).toFixed(1)}h eligible hours</p></span><i aria-label={`${rate(contribution, 2)} contribution`} style={{ "--reward-progress": `${contribution * 360}deg` }}><b>{rate(contribution, 2)}</b></i></div>
      <div className="is-pool"><small>Reward Pool <InfoButton label="About reward pool" onClick={() => onOpenModal("pool")} /></small><strong>{money(data.reward_pool ?? data.configured_pool)}</strong><p>Shared across eligible crew</p></div>
    </div>
  </article>;
}

function PerformanceOverview({ data, tiers, onOpenSheet, onViewPerformance }) {
  const score = Math.max(0, Math.min(100, Number(data.performance_score || 0)));
  return <article className="crew-reward-card crew-reward-performance">
    <header><span><h2>Performance Overview</h2><p>Your performance determines how much of your maximum share you earn.</p></span><button type="button" onClick={onViewPerformance}>View My Performance <ChevronRight size={16} /></button></header>
    <div className="crew-reward-performance-main">
      <div className="crew-reward-score-summary">
        <div className="crew-reward-score-ring" style={{ "--score-progress": `${score * 3.6}deg` }}><span><strong>{Math.round(score)}</strong><small>/ 100</small></span></div>
        <div><h3>{data.performance_level || "Awaiting Review"}</h3><em>On Track</em><small>Current Earn Rate <InfoButton label="About current earn rate" onClick={() => onOpenSheet("rates")} /></small><strong>{rate(data.earn_rate)}</strong><p>Continue improving to unlock a higher rate.</p></div>
      </div>
    </div>
    <div className="crew-reward-scale" aria-label={`Performance score ${Math.round(score)}`}>
      <div className="crew-reward-scale-track"><i style={{ left: `${score}%` }}><b>{Math.round(score)}</b></i></div>
      <div className="crew-reward-scale-labels"><span>&lt;70<small>0%</small></span><span>70<small>20%</small></span><span>75<small>45%</small></span><span>80<small>65%</small></span><span>85<small>80%</small></span><span>90<small>90%</small></span><span>95<small>100%</small></span></div>
    </div>
    <button type="button" className="crew-reward-info-link" onClick={() => onOpenSheet("rates")}>How earn rate works <Info size={14} /></button>
  </article>;
}

function RewardProjection({ data, onOpenSheet }) {
  if (data.projection_applicable === false || ["finalized", "paid"].includes(data.cycle_status)) {
    return <article className="crew-reward-card crew-reward-finalized"><TrendingUp size={20} /><span><h2>Reward finalized</h2><p>This month’s amount is final, so projections no longer apply.</p></span></article>;
  }
  const projections = data.projections || [];
  return <article className="crew-reward-card crew-reward-projection">
    <header><span><h2><TrendingUp size={19} /> Estimated Reward Projection</h2><p>See how your reward can grow with a higher performance score.</p></span><button type="button" onClick={() => onOpenSheet("projection")}><Info size={15} /> How it works</button></header>
    <div className="crew-reward-projection-track">
      {projections.map((item, index) => <div key={item.key || item.label} className={`is-${item.key || index}`}><small>{item.label}</small><b>Score {item.key === "max" ? "95+" : Math.round(Number(item.score || 0))}</b><i>{item.key === "max" ? "★" : ""}</i><strong>{money(item.amount)}</strong><span>{rate(item.earn_rate)} earned</span></div>)}
    </div>
    <p className="crew-reward-projection-note"><Info size={14} /> Projections assume your current contribution ({rate(data.contribution_share, 2)}) and reward pool remain similar.</p>
  </article>;
}

function RewardHistory({ history, onViewAll }) {
  const recent = history?.[0];
  return <article className="crew-reward-card crew-reward-history-card">
    <header><span><h2><History size={18} /> Reward History</h2><p>Track your past reward payouts.</p></span>{history?.length ? <button type="button" onClick={onViewAll}>View all <ChevronRight size={16} /></button> : null}</header>
    {recent ? <button type="button" className="crew-reward-history-row" onClick={onViewAll}><time>{new Date(`${recent.period_start}T00:00:00`).toLocaleDateString("en-MY", { month: "short", year: "numeric" })}</time><span><strong>{money(recent.amount)}</strong><em>{statusCopy[recent.status] || recent.status}</em><small>{recent.paid_at ? `Paid on ${new Date(recent.paid_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}` : "Finalized monthly reward"}</small></span><ChevronRight size={17} /></button> : <p className="crew-reward-history-empty">Your finalized Reward history will appear here.</p>}
  </article>;
}

export default function CrewRewardMobile({ data, loading, onRetry, onViewPerformance }) {
  const [sheet, setSheet] = useState(null);
  const tiers = useMemo(() => data?.earn_rate_tiers?.length ? data.earn_rate_tiers : defaultTiers, [data?.earn_rate_tiers]);
  if (loading) return <section className="crew-v2-state"><span className="crew-v2-spinner" /><strong>Loading your reward…</strong></section>;
  if (!data) return <section className="crew-v2-state is-error"><Gift size={26} /><strong>Reward is unavailable</strong><p>We could not load this month’s Reward information.</p><button type="button" onClick={onRetry}>Try again</button></section>;
  const unlocked = ["qualified", "finalized", "paid"].includes(data.status);
  return <section className="crew-reward-final">
    <header className="crew-reward-page-header"><h1>Reward</h1><button type="button" aria-label="Reward help" onClick={() => setSheet("help")}><CircleHelp size={22} /></button></header>
    {unlocked ? <>
      <RewardHero data={data} onOpenModal={setSheet} />
      <button type="button" className="crew-reward-motivation" onClick={() => setSheet("help")}><i><Lightbulb size={19} /></i><span>Work more hours and improve your performance to earn closer to your maximum share!</span><ChevronRight size={18} /></button>
      <PerformanceOverview data={data} tiers={tiers} onOpenSheet={setSheet} onViewPerformance={onViewPerformance} />
      <RewardProjection data={data} onOpenSheet={setSheet} />
      <button type="button" className="crew-reward-formula-row" onClick={() => setSheet("formula")}><i><Calculator size={18} /></i><span><strong>How is this calculated?</strong><small>Your maximum share is based on eligible hours contribution. Your Performance determines the percentage you earn.</small></span><ChevronRight size={18} /></button>
      <RewardHistory history={data.history || []} onViewAll={() => setSheet("history")} />
    </> : <article className="crew-reward-unavailable"><Gift size={30} /><h2>{statusCopy[data.status] || "Reward not available"}</h2><p>{data.eligibility_reason || data.explanation || "This month’s Reward is not available yet."}</p></article>}

    {sheet === "help" && <Modal title="About your Reward" onClose={() => setSheet(null)}><div className="crew-reward-modal-section"><strong>Maximum Share</strong><p>Your Reward Pool share is based on your eligible hours contribution.</p></div><div className="crew-reward-modal-section"><strong>Performance Earn Rate</strong><p>Your finalized Performance Score determines how much of your Maximum Share you receive.</p></div><div className="crew-reward-modal-note"><Lightbulb size={18} /><span>More eligible hours may increase your contribution. A stronger Performance score can unlock a higher earn rate.</span></div></Modal>}
    {sheet === "maximum" && <Modal title="Your Maximum Share" onClose={() => setSheet(null)}><p>Your maximum share is {money(data.maximum_share)}. It is your portion of the outlet Reward Pool based on eligible-hours contribution.</p></Modal>}
    {sheet === "contribution" && <Modal title="Your Contribution" onClose={() => setSheet(null)}><p>You contributed {Number(data.eligible_hours || 0).toFixed(1)} of {Number(data.total_eligible_hours || 0).toFixed(1)} eligible outlet hours, equal to {rate(data.contribution_share, 2)}.</p></Modal>}
    {sheet === "pool" && <Modal title="Reward Pool" onClose={() => setSheet(null)}><p>The {money(data.reward_pool ?? data.configured_pool)} Reward Pool is shared across eligible Crew for this month.</p></Modal>}
    {sheet === "rates" && <Modal title="Performance earn rates" onClose={() => setSheet(null)}><p>Your monthly finalized Performance score maps to one transparent earn rate.</p><TierTable tiers={tiers} /></Modal>}
    {sheet === "projection" && <Modal title="About projections" onClose={() => setSheet(null)}><p>Projections keep your current Reward Pool and eligible-hours contribution fixed. Only the Performance tier changes. They are estimates, not guaranteed payouts.</p></Modal>}
    {sheet === "formula" && <Modal title="How your Reward is calculated" onClose={() => setSheet(null)}><div className="crew-reward-formula"><span><small>Reward Pool</small><strong>{money(data.reward_pool ?? data.configured_pool)}</strong></span><b>×</b><span><small>Contribution Share</small><strong>{rate(data.contribution_share, 2)}</strong></span><b>=</b><span><small>Maximum Share</small><strong>{money(data.maximum_share)}</strong></span></div><div className="crew-reward-formula"><span><small>Maximum Share</small><strong>{money(data.maximum_share)}</strong></span><b>×</b><span><small>Performance Earn Rate</small><strong>{rate(data.earn_rate)}</strong></span><b>=</b><span><small>{data.reward_label || "Estimated Reward"}</small><strong>{money(data.reward_amount ?? data.estimated_reward)}</strong></span></div></Modal>}
    {sheet === "history" && <Modal title="Reward History" onClose={() => setSheet(null)}><div className="crew-reward-modal-history">{(data.history || []).map((item) => <div key={item.period_start}><time>{new Date(`${item.period_start}T00:00:00`).toLocaleDateString("en-MY", { month: "long", year: "numeric" })}</time><span><strong>{money(item.amount)}</strong><small>{statusCopy[item.status] || item.status}</small></span></div>)}</div></Modal>}
  </section>;
}
