// Date-only reporting coordinates are always supplied in the Meta account timezone.
export function historyFloor(to) {
 const d=new Date(to+'T00:00:00Z');if(!Number.isFinite(+d))return null;
 const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-37);
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
 d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);
}
export function campaignLifetime(campaign,to,timezone="Asia/Kuala_Lumpur") {
 const date=value=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))}catch{return null}};
 const start=date(campaign?.start_time),floor=historyFloor(to);
 if(!floor||!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||start>to)return null;
 // Provider epoch sentinel is not a real campaign start.
 if(start<'2000-01-01')return {from:floor,to,limited:true};
 const stop=date(campaign.stop_time),end=stop&&stop>=start&&stop<to?stop:to;
 return end<floor?null:{from:start<floor?floor:start,to:end,limited:start<floor};
}
export function adsCoverage(data,connection,from,to) {
 const report=data?.reports?.find(r=>r.connection_id===connection&&r.date_from===from&&r.date_to===to);
 const coverage=data?.coverage?.find(r=>r.connection_id===connection);
 const job=data?.jobs?.find(j=>j.connection_id===connection&&j.date_from===from&&j.date_to===to&&['queued','leased','retry','failed','cancelled'].includes(j.state));
 const relatedRanges=(coverage?.ranges||[]).filter(r=>r.from<=to&&r.to>=from);
 const containingRange=relatedRanges.find(r=>r.from<=from&&r.to>=to);
 // A wider aggregate is evidence of a completed import, not selected-period metrics.
 const periodEvidence=report?'exact':containingRange?'broader':relatedRanges.length?'overlap':'none';
 return {report,coverage,job,periodEvidence,containingRange,relatedRanges,state:job&&['queued','leased','retry'].includes(job.state)?'syncing':report?'observed':job?'failed':'not_synced'};
}
export function adsMetricAvailability(report,level,row) {
 if(report?.not_synced||!report)return 'Selected period not synced';
 if(report.warnings?.[level])return 'Provider unavailable';
 if(!row)return 'No activity reported';
 return null;
}
