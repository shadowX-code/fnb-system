import { Calculator, Clock3, Gauge, Gift, History, Sparkles, Target } from "lucide-react";

const money = (value) => `RM ${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;
const statusCopy = {
  qualified: "Qualified",
  finalized: "Finalized",
  paid: "Paid",
  not_eligible: "Not Eligible",
  awaiting_performance: "Awaiting Performance",
  not_available: "Not Available",
};

export default function CrewRewardMobile({ data, loading, onRetry }) {
  if (loading) return <section className="crew-v2-state"><span className="crew-v2-spinner" /><strong>Loading your reward…</strong></section>;
  if (!data) return <section className="crew-v2-state is-error"><Gift size={26} /><strong>Reward is unavailable</strong><p>We could not load this month’s Reward information.</p><button type="button" onClick={onRetry}>Try again</button></section>;
  const unlocked = ["qualified", "finalized", "paid"].includes(data.status);
  return <section className="crew-v2-reward">
    <header className="crew-v2-page-header"><div><h1>Reward</h1></div></header>
    {unlocked ? <article className="crew-v2-reward-hero is-unlocked">
      <div className="crew-v2-icon-token"><Gift size={24} /></div><small>This Month</small>
      <h2>{money(data.estimated_reward)}</h2><span className={`crew-v2-status is-${data.status}`}>{statusCopy[data.status]}</span>
      <p>{data.status === "paid" ? "This Reward has been marked paid." : data.status === "finalized" ? "Your monthly Reward is finalized." : "Estimated from verified monthly evidence."}</p>
    </article> : <article className="crew-v2-reward-hero is-locked">
      <div className="crew-v2-icon-token"><Target size={24} /></div><small>This Month</small><h2>Reward Not Unlocked</h2>
      <p>{data.eligibility_reason || data.explanation || "This month’s Reward is not available yet."}</p>
    </article>}

    <section className="crew-v2-section-block"><div className="crew-v2-section-title"><h2>Monthly evidence</h2><span>{data.calculation_version || "reward-v1"}</span></div>
      <div className="crew-v2-reward-list">
        <div><Gauge size={18} /><span><strong>Performance</strong><small>{data.status === "not_eligible" ? `Required ${Math.round(Number(data.minimum_performance || 60))}` : "Finalized monthly score"}</small></span><em>{data.performance_score == null ? "—" : Math.round(data.performance_score)}</em></div>
        <div><Clock3 size={18} /><span><strong>Eligible Hours</strong><small>Completed attendance evidence</small></span><em>{Number(data.eligible_hours || 0).toFixed(1)}h</em></div>
        <div><Sparkles size={18} /><span><strong>Contribution</strong><small>Your share of eligible outlet hours</small></span><em>{percent(data.contribution_share)}</em></div>
        <div><Gift size={18} /><span><strong>Pool Status</strong><small>{money(data.configured_pool)} configured</small></span><em>{money(data.unlocked_pool)}</em></div>
      </div>
    </section>

    {unlocked ? <details className="crew-v2-reward-explanation"><summary><Calculator size={17} /> How is this calculated?</summary><div>
      <span><small>Eligible Hours</small><strong>{Number(data.eligible_hours || 0).toFixed(2)}h</strong></span>
      <span><small>Performance Factor</small><strong>{percent(data.performance_factor)}</strong></span>
      <span><small>Contribution Share</small><strong>{percent(data.contribution_share)}</strong></span>
      <span><small>Unlocked Pool</small><strong>{money(data.unlocked_pool)}</strong></span>
      <p>Your estimate uses completed eligible working hours, finalized Performance and the outlet Reward Pool. It never includes another Crew member’s details.</p>
    </div></details> : null}

    <section className="crew-v2-section-block"><div className="crew-v2-section-title"><h2>Reward History</h2><History size={17} /></div>
      <div className="crew-v2-reward-history">{(data.history || []).length ? data.history.map((item) => <div key={item.period_start}><span><strong>{new Date(item.period_start).toLocaleDateString("en-MY", { month: "short", year: "numeric" })}</strong><small>{statusCopy[item.status] || item.status}</small></span><em>{money(item.amount)}</em></div>) : <p>Your finalized Reward history will appear here.</p>}</div>
    </section>
  </section>;
}
