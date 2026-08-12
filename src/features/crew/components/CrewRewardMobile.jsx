import { CalendarDays, Gift, History, Sparkles } from "lucide-react";

export default function CrewRewardMobile() {
  return <section className="crew-v2-reward">
    <header className="crew-v2-page-header"><div><h1>Reward</h1></div></header>
    <article className="crew-v2-reward-hero"><div className="crew-v2-icon-token"><Gift size={24} /></div><small>FeedX Rewards</small><h2>Coming soon</h2><p>Your verified reward estimate, earn rate and payout history will appear here when Rewards launches.</p></article>
    <section className="crew-v2-reward-list">
      <div><Sparkles size={18} /><span><strong>Estimated reward</strong><small>Calculated from verified contribution</small></span><em>—</em></div>
      <div><CalendarDays size={18} /><span><strong>Payout date</strong><small>Shown when a payout cycle is active</small></span><em>—</em></div>
      <div><History size={18} /><span><strong>Reward history</strong><small>Your completed payouts will stay here</small></span><em>—</em></div>
    </section>
  </section>;
}
