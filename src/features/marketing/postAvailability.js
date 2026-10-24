export const LIVE_AVAILABILITY={
 available:{label:'Live on Meta',tone:'success',help:'Meta positively observed this publication. Historical metrics and the original receipt are retained.'},
 deleted:{label:'Removed on Meta',tone:'danger',help:'A signed Meta Page post-removal event was verified. The original publication receipt and historical Insights remain intact.'},
 unavailable:{label:'Unavailable on Meta',tone:'warning',help:'The post could not be verified as currently public. A missing or unreadable object does not prove deletion.'},
 access_restricted:{label:'Access restricted',tone:'warning',help:'Meta denied the current read. This does not prove the post was deleted.'},
 temporarily_unavailable:{label:'Check delayed',tone:'neutral',help:'The provider check failed temporarily. Previous publication evidence is preserved.'},
 unknown:{label:'Not checked',tone:'neutral',help:'Current provider availability has not been verified. Published describes the historical publication receipt.'}
};
export function liveAvailabilityInfo(availability){return LIVE_AVAILABILITY[availability?.state]||LIVE_AVAILABILITY.unknown;}
export function publicationAvailability(channels){
 const posts=(channels||[]).filter(c=>c.provider_post_id);if(!posts.length)return null;
 const states=posts.map(p=>LIVE_AVAILABILITY[p.availability?.state]?p.availability.state:'unknown'),unique=[...new Set(states)];
 const details=posts.map(p=>`${p.channel==='instagram'?'Instagram':'Facebook'}: ${liveAvailabilityInfo(p.availability).label}`).join(' · ');
 if(unique.length===1)return {...LIVE_AVAILABILITY[unique[0]],details,state:unique[0]};
 return {state:'partial',label:states.includes('deleted')?'Partly removed':states.includes('unavailable')?'Partly unavailable':'Partly checked',tone:'warning',help:'Channel availability differs. Publication receipts and channel results remain independent.',details};
}
