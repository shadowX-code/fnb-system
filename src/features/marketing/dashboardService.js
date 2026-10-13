import { marketingService } from './marketingService.js';
import { plannerService } from './plannerService.js';
import { inboxService } from './inboxService.js';
// Consume canonical paginated authorities; never present the first page as a full total.
export async function collectPages(load,rowsKey,totalKey,pageSize){
 const rows=[];let first;
 for(let page=1;page<=1000;page++){
  const result=await load(page);if(!first)first=result;const next=result[rowsKey]||[];rows.push(...next);
  if(rows.length>=(result[totalKey]||0))return {...first,[rowsKey]:rows};
  if(!next.length)throw new Error('The data changed while loading. Refresh to obtain a complete report.');
 }
 throw new Error('This scope is too large for this report. Choose a specific brand.');
}
export const dashboardService={
 async social(org,brand){return collectPages(page=>marketingService.integrations(org,brand,'analytics',page),'posts','total',20);},
 performance:(org,brand,from,to,grain)=>marketingService.socialPerformance(org,brand,from,to,grain),
 async operations(org,brand,month,can){
  const sources=[['tasks',can('marketing_planner.view'),()=>plannerService.read(org,month,brand).then(r=>r.tasks)],['content',can('marketing_calendar.view')||can('marketing_content.view'),()=>collectPages(page=>marketingService.contentManagement({organizationId:org,brandId:brand,page,pageSize:100}),'rows','total_count',100).then(r=>r.rows)],['conversations',can('marketing_inbox.view'),()=>collectPages(page=>inboxService.read({org,brand,channel:'social',page,pageSize:100}),'rows','total',100).then(r=>r.rows)]];
  const results=await Promise.allSettled(sources.map(([,allowed,load])=>allowed?load():Promise.resolve(null)));
  const data={},unavailable=[];results.forEach((result,i)=>{const [name,allowed]=sources[i];data[name]=result.status==='fulfilled'?result.value:null;if(!allowed||result.status==='rejected')unavailable.push({name,reason:allowed?'Could not load · Refresh to retry':'View permission required'});});
  return {...data,unavailable};
 }
};
