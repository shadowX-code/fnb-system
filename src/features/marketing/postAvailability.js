export const LIVE_AVAILABILITY={
 available:{label:'Live on Meta',tone:'success',help:'Meta positively observed this publication. Historical metrics and the original receipt are retained.'},
 deleted:{label:'Removed on Meta',tone:'danger',help:'A signed Meta Page post-removal event was verified. The original publication receipt and historical Insights remain intact.'},
 manually_removed:{label:'Removed · staff confirmed',tone:'warning',help:'An authorized staff member confirmed removal in Meta. This is not provider-verified deletion. The original receipt and historical Insights remain intact.'},
 unavailable:{label:'Unavailable on Meta',tone:'warning',help:'The post could not be verified as currently public. A missing or unreadable object does not prove deletion.'},
 access_restricted:{label:'Access restricted',tone:'warning',help:'Meta denied the current read. This does not prove the post was deleted.'},
 temporarily_unavailable:{label:'Check delayed',tone:'neutral',help:'The provider check failed temporarily. Previous publication evidence is preserved.'},
 unknown:{label:'Not checked',tone:'neutral',help:'Current provider availability has not been verified. Published describes the historical publication receipt.'}
};
export function liveAvailabilityInfo(availability){
 const base=LIVE_AVAILABILITY[availability?.state]||LIVE_AVAILABILITY.unknown;
 const info=availability?.calendar_visibility?.hidden?{...base,help:base.help+' Repeated checks qualify this channel for default Calendar hiding when every channel qualifies. List and publication history remain available.'}:base;
 return availability?.manual_confirmation?.state==='conflict'?{...info,tone:'warning',help:info.help+' Meta observed this post live after the staff confirmation. Review the conflicting evidence.'}:info;
}
export function publicationAvailability(channels){
 const posts=(channels||[]).filter(c=>c.provider_post_id);if(!posts.length)return null;
 const states=posts.map(p=>LIVE_AVAILABILITY[p.availability?.state]?p.availability.state:'unknown'),unique=[...new Set(states)];
 const details=posts.map(p=>`${p.channel==='instagram'?'Instagram':'Facebook'}: ${liveAvailabilityInfo(p.availability).label}${p.availability?.manual_confirmation?.state==='conflict'?' (staff confirmation conflict)':''}`).join(' · ');
 if(unique.length===1)return {...liveAvailabilityInfo((posts.find(p=>p.availability?.manual_confirmation?.state==='conflict')||posts[0]).availability),details,state:unique[0]};
 if(states.every(s=>['deleted','manually_removed'].includes(s)))return {state:'removed',label:'Removed · mixed confirmation',tone:'warning',help:'Every published channel is confirmed removed. Review each channel for provider or staff provenance. Original receipts and historical Insights remain intact.',details};
 return {state:'partial',label:states.some(s=>['deleted','manually_removed'].includes(s))?'Partly removed':states.includes('unavailable')?'Partly unavailable':'Partly checked',tone:'warning',help:'Channel availability differs. Publication receipts and channel results remain independent.',details};
}
