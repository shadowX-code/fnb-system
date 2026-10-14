import { marketingService } from './marketingService.js';
import { plannerService } from './plannerService.js';
export const dashboardService={
 social:(org,brand,from,to,signal)=>marketingService.socialPublications(org,brand,from,to,signal),
 performance:(org,brand,from,to,grain)=>marketingService.socialPerformance(org,brand,from,to,grain),
 async operations(org,brand,month,can,signal){
  const contentAllowed=can('marketing_calendar.view')||can('marketing_content.view'),inboxAllowed=can('marketing_inbox.view');
  const operational=contentAllowed||inboxAllowed?marketingService.dashboardOperations(org,brand,signal):Promise.resolve({content:null,conversations:null});
  const sources=[['tasks',can('marketing_planner.view'),()=>plannerService.read(org,month,brand).then(r=>r.tasks)],['content',contentAllowed,()=>operational.then(r=>r.content)],['conversations',inboxAllowed,()=>operational.then(r=>r.conversations)]];
  const results=await Promise.allSettled(sources.map(([,allowed,load])=>allowed?load():Promise.resolve(null)));
  const data={},unavailable=[];results.forEach((result,i)=>{const [name,allowed]=sources[i];data[name]=result.status==='fulfilled'?result.value:null;if(!allowed||result.status==='rejected')unavailable.push({name,reason:allowed?'Could not load · Refresh to retry':'View permission required'});});
  return {...data,unavailable};
 }
};
