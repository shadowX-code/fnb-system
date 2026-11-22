import {AssistantError} from '../assistantError.js';
import {readContract,uuid,month,page,pick} from '../assistant/readContract.js';

export const plannerRead=readContract({
 id:'read_marketing_plan',module_id:'marketing_planner',version:2,related_module_ids:['marketing_planning_insights'],
 label:'Brand creative plan',permission:'marketing_planner.view',
 scope:'Current human organization membership and brand access',source:'/marketing/planner',
 discoveryPhrases:['creative plan','creative tasks','content planner','perancangan kandungan','内容计划','內容計劃'],
 description:'Count or list saved creative tasks for a named brand and one planning month (first day). Use the recorded task status filter. Task count does not measure published posts. No private assets, membership roster or draft bodies.',
 properties:{organization_id:uuid,brand_id:uuid,month,page,
  status:{type:'string',enum:['all','planned','in_progress','in_review','revision_needed','completed']}},
 normalizeArguments:args=>args&&typeof args==='object'&&!Array.isArray(args)?{page:1,status:'all',...args}:args,
 rpc:'marketing_planner_read',arguments:a=>({p_org:a.organization_id,p_brand:a.brand_id,p_month:a.month}),
 project(data,args){
  if(!Array.isArray(data.tasks))throw new AssistantError('business_read_unavailable',503);
  const tasks=args.status==='all'?data.tasks:data.tasks.filter(task=>task.status===args.status);
  const first=(args.page-1)*20;
  const rows=tasks.slice(first,first+20).map(task=>pick(task,['id','title','status','content_type','due_date','revision','updated_at']));
  return {total_matching:tasks.length,aggregate_complete:true,page:args.page,returned:rows.length,truncated:tasks.length>first+20,rows};
 },
 interface:{queryKinds:['count','list','filter'],authority:'marketing_planner_read',aggregates:'complete_filtered_scope',
  pagination:'Exact filtered count of saved tasks for the selected Brand/month before paging; up to 20 task summaries.',
  unsupported:['Publishing outcomes, provider delivery, targets, assignee identity and task bodies are outside this read.']},
});
