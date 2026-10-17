import Badge from '../../components/ui/Badge.jsx';
import ContentTypeBadge from './ContentTypeBadge.jsx';
const number=value=>Number.isFinite(value)?value:'—';
const reason=target=>target.published_coverage==='permission_required'?'Content viewing permission required':target.published_coverage==='publication_date_unavailable'?'A confirmed publication is missing its actual date':'Publishing evidence has not been synchronized';
export default function BrandTargetCards({targets=[]}){
 return <><div className="planner-brand-targets">{targets.map(target=><article className="planner-brand-target" key={target.brand_id} aria-label={`${target.brand_name} targets`}>
  <header><h4>{target.brand_name}</h4>{target.overridden?<Badge>Monthly override</Badge>:null}</header>
  <div className="planner-scorecard-types">{['posts','reels'].map(type=>{
   const published=target[`published_${type}`],limit=target[type],available=target.published_available&&Number.isFinite(published);
   return <section className="planner-scorecard-section" key={type}>
    <h5><ContentTypeBadge value={type==='posts'?'post':'reel'}/><span>Published / Target</span></h5>
    <div className="planner-scorecard-number"><strong aria-label={`${target.brand_name} ${type} published`}>{available?published:'—'}</strong><span>/ {limit>0?limit:'—'}</span></div>
    {available&&limit>0?<><progress aria-label={`${target.brand_name} ${type} published target`} value={Math.min(published,limit)} max={limit}/><p className="planner-target-gap">{Math.max(0,limit-published)} remaining</p></>:<p className="planner-target-gap">{!available?'Evidence unavailable':'Target not set'}</p>}
   </section>;
  })}</div>
  <dl className="planner-target-pipeline"><div><dt>Scheduled</dt><dd>{number(target.scheduled_posts)} posts · {number(target.scheduled_reels)} reels</dd></div><div><dt>Production pipeline</dt><dd>{number(target.planned_posts)} posts · {number(target.planned_reels)} reels<span>{number(target.completed_posts)} posts · {number(target.completed_reels)} reels completed</span></dd></div></dl>
  {!target.published_available?<p className="planner-target-evidence" role="status">{reason(target)}</p>:null}
 </article>)}</div>{!targets.length?<p className="planner-day-empty">No brands available in this view.</p>:<p className="planner-insights-hint">Published counts use observed publication dates in Malaysia time. Each content item counts once across channels and revisions. Synchronized history may be incomplete.</p>}</>;
}
