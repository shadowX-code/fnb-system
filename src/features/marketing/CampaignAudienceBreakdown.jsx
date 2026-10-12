export default function CampaignAudienceBreakdown({breakdown,loading=false,error='',basis='current'}) {
 return <section className="outreach-audience-breakdown" aria-label="Audience breakdown" aria-busy={loading}>
  <dl>{[['matching','Matching Customers'],['excluded','Excluded Customers'],['eligible','Eligible Recipients']].map(([key,label])=><div key={key}><dt>{label}</dt><dd>{loading?'…':breakdown?.[key]??'Unavailable'}</dd></div>)}</dl>
  {error?<p role="alert">{error}</p>:null}
  {breakdown?<><p className="text-xs text-text-secondary">{basis==='reviewed'?'Audience locked at review. Consent is checked again before each action.':'Current audience preview. Only Subscribed customers are eligible.'}</p>
  {breakdown.excluded>0?<ul className="text-xs text-text-secondary">{breakdown.not_subscribed>0?<li>Not Subscribed: {breakdown.not_subscribed}</li>:null}{breakdown.do_not_contact>0?<li>Do Not Contact: {breakdown.do_not_contact}</li>:null}{breakdown.other_excluded>0?<li>Contact eligibility changed: {breakdown.other_excluded}</li>:null}</ul>:null}</>:null}
 </section>;
}
