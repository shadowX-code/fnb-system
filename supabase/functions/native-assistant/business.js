import {resumeScopedTask} from './taskResume.js';
import {queryDiscoveryTools,isQueryEnvelope,queryEnvelopeArguments,discoverQueries,excludeCompetingQueries,identifyReadOwner} from '../_shared/assistant/queryDiscovery.js';
import {employeeDirectoryRead,resolveDirectoryEmployee} from '../_shared/people/employeeDirectoryRead.js';
import {restaurantGapReads} from '../_shared/restaurant/gapReads.js';
import {financeGapReads} from '../_shared/finance/gapReads.js';
import {peopleGapReads} from '../_shared/people/gapReads.js';
import {crewGapReads} from '../_shared/crew/gapReads.js';
import {factoryGapReads} from '../_shared/factory/gapReads.js';
import {marketingGapReads} from '../_shared/marketing/gapReads.js';
import {restaurantCatalogueReads} from '../_shared/restaurant/catalogueReads.js';
import {assetCatalogueRead} from '../_shared/restaurant/assetCatalogueRead.js';
import {peopleCatalogueReads} from '../_shared/people/catalogueReads.js';
import {factoryCatalogueReads} from '../_shared/factory/catalogueReads.js';
import {factoryPlatformReads} from '../_shared/factory/platformReads.js';
import {crewPlatformReads} from '../_shared/crew/platformReads.js';
import {marketingPlatformReads} from '../_shared/marketing/platformReads.js';
import {peoplePlatformReads} from '../_shared/people/platformReads.js';
import {financePlatformReads} from '../_shared/finance/platformReads.js';
import {draftAction,captionAction} from '../_shared/marketing/draftAction.js';
import {plannerRead} from '../_shared/marketing/plannerRead.js';
import {reportRead} from '../_shared/finance/reportRead.js';
import {leaveRead} from '../_shared/crew/leaveRead.js';
import {employmentRead} from '../_shared/people/employmentRead.js';
import {cleaningRead} from '../_shared/factory/cleaningRead.js';
import {AssistantError} from '../_shared/assistantError.js';
import {finishedGoodsRead} from '../_shared/factory/finishedGoodsRead.js';
import {asksWorkflow,workflowKnowledge} from '../_shared/assistant/workflowGuidance.js';
import {systemGuidance} from '../_shared/assistant/systemGuidance.js';
import {entityKey,namedOutlets,outletDirectory,resolveBrand,resolveOutlet} from '../_shared/assistant/entityResolution.js';
import {invalidArgument,permitted} from '../_shared/assistant/readContract.js';
import {operationalAnalysis,verifiedAnswerAmounts,verifyReadEvidence} from '../_shared/assistant/evidence.js';
import {affirmedOutlet,asksForAnalysis,businessReplyLanguage,confirmedOutlet,continuedPage,correctedOutletWording,outcomeFor,outletContinuation,pageRequest,previousBusinessResult,previousNamedTurn} from './businessQuery.js';

// Composition of implemented module contracts, not a permission or grant store.
// Discovery never makes a module executable. ACTION tools create previews only.
export const operations = [employeeDirectoryRead,...restaurantGapReads,...peopleGapReads,...financeGapReads,...marketingGapReads,...factoryGapReads,...crewGapReads,finishedGoodsRead,cleaningRead,employmentRead,leaveRead,reportRead,plannerRead,draftAction,captionAction,...factoryPlatformReads,...crewPlatformReads,...marketingPlatformReads,...peoplePlatformReads,...factoryCatalogueReads,...peopleCatalogueReads,...restaurantCatalogueReads,assetCatalogueRead,...financePlatformReads];
const queryOperations=[...operations,systemGuidance];
const guideAvailable=(config,access)=>config.enabled===true&&access.admin===true;
export function assistantQuery(id){const operation=queryOperations.find(item=>item.id===id);if(!operation)throw new AssistantError('tool_not_allowed',403);return operation;}
export function validateBusinessArguments(id,args){
 if(isQueryEnvelope(id)){const parsed=queryEnvelopeArguments(id,args);if(id==='run_business_query')assistantQuery(parsed.operation);return parsed;}
 return assistantQuery(id).validate(args);
}
export function capabilityConnected(config,id){return config.capability_connections?.[id]===true;}
export function businessOperation(id){const operation=operations.find(item=>item.id===id);if(!operation)throw new AssistantError('tool_not_allowed',403);return operation;}
export function businessToolIdentity(tool, args) {
 const id = tool === 'run_business_query' ? args?.operation : tool;
 const operation = queryOperations.find(item => item.id === id);
 if (operation) return { operation: operation.id, operation_label: operation.label };
 if (tool === 'find_business_queries') return { operation: tool, operation_label: 'FeedX query discovery' };
 return {};
}
export function businessToolArgumentShape(tool, args) {
 const id = businessToolIdentity(tool, args).operation;
 const parameters = queryOperations.find(item => item.id === id)?.tool.parameters
  || queryDiscoveryTools.find(item => item.name === id)?.parameters;
 if (!parameters) return {};
 let inner = args;
 if (tool === 'run_business_query') {
  try { inner = queryEnvelopeArguments(tool, args).args; } catch { return {}; }
 }
 if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return {};
 const keys = Object.keys(inner);
 return {
  fields: keys.filter(key => Object.hasOwn(parameters.properties, key)),
  unsupported_field_count: keys.filter(key => !Object.hasOwn(parameters.properties, key)).length,
  ...(parameters.properties.mode?.enum?.includes(inner.mode) ? {mode:inner.mode} : {}),
 };
}
export function businessCapabilities(config,access){
 return operations.map(operation=>({id:operation.id,module_id:operation.module_id,related_module_ids:operation.related_module_ids||[],kind:operation.kind,version:operation.version,
  label:operation.label,scope:operation.scope,permission:operation.permission,query:operation.moduleInterface?.query,policy_group:operation.policyGroup||null,
  ...(operation.knowledge?{knowledge:{...operation.moduleInterface.knowledge,availability:!capabilityConnected(config,operation.id)?'disabled':
   operation.authorized(access)&&(operation.knowledge.additional_permissions||[]).every(permission=>access.permissions?.[permission]===true)?'live_source':'denied'}}:{}),
  connection_enabled:capabilityConnected(config,operation.id),test_supported:operation.kind==='READ',test_parameters:operation.kind==='READ'?operation.tool.parameters.properties:undefined,
  ai_execution_enabled:operation.kind==='ACTION'?config.ai_action_authorizations?.[operation.id]===true:undefined,
  availability:!capabilityConnected(config,operation.id)||operation.kind==='ACTION'&&config.ai_action_authorizations?.[operation.id]!==true?'disabled':operation.authorized(access)?'connected':'denied'}));
}
export function queryTool(operation){
 if(operation.kind!=='READ')return operation.tool;
 const parameters=operation.tool.parameters;
 const extra={};
 if(parameters.properties.outlet_id&&!parameters.properties.outlet_name)extra.outlet_name={type:['string','null'],maxLength:120,description:'Exact human-supplied outlet name/code, or null. Use null for a required outlet_id only when providing this name.'};
 if(parameters.properties.brand_id&&!parameters.properties.brand_name)extra.brand_name={type:['string','null'],maxLength:120,description:'Exact human-supplied Brand name, or null.'};
 if(operation.employeeNameLookup)extra.employee_name={type:['string','null'],maxLength:80,description:'Exact employee name or code from the user. Supply a null employee_id when using the name.'};
 if(!Object.keys(extra).length)return operation.tool;
 const properties={...parameters.properties,...extra};
 for(const field of ['outlet','brand','employee']){
  const id=properties[field+'_id'];
  if(extra[field+'_name']&&id.type==='string')properties[field+'_id']={...id,type:['string','null']};
 }
 if(extra.brand_name&&properties.organization_id?.type==='string')properties.organization_id={...properties.organization_id,type:['string','null']};
 return {...operation.tool,parameters:{...parameters,properties,required:Object.keys(properties)}};
}

const domainOf=operation=>{
 const root=operation.moduleInterface?.source?.split('/')[1];
 return ['operations','sales-purchase','inventory'].includes(root)?'restaurant':root||null;
};
export function createBusinessDispatcher({caller,config,access,readFactory,loadConfig,sessionId}={}){
 const capabilities=businessCapabilities(config||{},access||{});
 const withGuide=(base,current)=>guideAvailable(current,access||{})?[...base,{id:systemGuidance.id,availability:'connected'}]:base;
 const indexed=withGuide(capabilities,config||{});
 const intended=prompt=>queryOperations.filter(operation=>typeof prompt==='string'&&operation.queryIntent?.(prompt));
 const queryClauses=prompt=>prompt.split(/\s*[,，]?\s*(?:[;；?？。]|\b(?:and|also|then|separately|serta|dan)\b|另外|以及|并且|並且|同时|同時)\s*/iu).map(s=>s.trim()).filter(Boolean);
 const measureListOwner=(prompt,matches,clauses)=>{
  const owners=matches.filter(op=>op.ownsMeasureList?.(prompt,clauses,matches.filter(other=>other!==op).map(other=>other.id)));
  return owners.length===1?owners[0]:null;
 };
 const planned=prompt=>{
  const matches=intended(prompt);
  if(matches.length>1)return measureListOwner(prompt,matches,queryClauses(prompt));
  if(matches.length!==1)return null;
  if(matches[0].ownsMeasureList){
   const clauses=queryClauses(prompt);
   if(clauses.length>1&&!matches[0].ownsMeasureList(prompt,clauses,[]))return null;
  }
  const compound=/\b(?:also|separately|then|and what|and how|and which|serta)\b|另外|以及|并且|並且|同时|同時/iu.test(prompt);
  if(compound&&discoveryRows(queryOperations,indexed,{search:prompt.slice(0,240),page:1}).operations.some(other=>other.operation!==matches[0].id))return null;
  return matches[0];
 };
 const discoveryRows=(ops,available,params)=>discoverQueries(ops.map(operation=>({...operation,tool:queryTool(operation)})),available,params);
 const planFor=operation=>operation?{operation:operation.id,tool:indexed.find(item=>item.id===operation.id)?.availability==='connected'?queryTool(operation):null}:null;
 // A narrower scope is a new question. Only the owner can declare one and only
 // currently discoverable READs may be offered. Never execute it as a fallback.
 function unavailableDiscovery(plan,available,prompt){
  const requested=assistantQuery(plan.operation);
  const permissionState=available.find(row=>row.id===plan.operation)?.availability;
  const error=permissionState==='disabled'?'capability_disconnected':'business_read_denied';
  const language=businessReplyLanguage(prompt);
  const options=(requested.narrowerReads?.[plan.intent]||[]).flatMap(id=>{
   const entry=available.find(row=>row.id===id&&row.kind==='READ'&&row.availability==='connected');
   if(!entry)return [];
   const target=assistantQuery(id);
   return [{operation:id,label:entry.label,scope:entry.scope,offer:target.narrowerOffer?.[language]}];
  });
  const offer=options.length===1?options[0].offer:null;
  return {discovery_only:true,not_business_evidence:true,requested_query_unavailable:true,error,total_operations:0,
   page:1,has_more:false,preferred_operation:null,operations:[],narrower_reads:options,
   next_step:{kind:options.length?'offer_narrower_scope':'report_unavailable'},
   ...(offer?{answer_hint:offer}:{}),
   instruction:'The requested scope is unavailable with current access. Only offer a listed narrower scope for a new request. Do not call it automatically, substitute another metric or infer that all business sources are unavailable.'};
 }
 // A coordinated question can name several owners. Keep each clause with its own
 // authority and filters. A list of outlets or two dates alone is not a new read.
 let lastGoalPrompt, lastGoal;
 function planGoal(prompt){
  if(asksWorkflow(prompt))return null;
  if(typeof prompt!=='string'||!prompt.trim())return null;
  if(lastGoalPrompt===prompt)return lastGoal;
  lastGoalPrompt=prompt;
  lastGoal=null;
  const clauses=queryClauses(prompt);
  if(clauses.length<2||clauses.length>5)return null;
  if(measureListOwner(prompt,intended(prompt),clauses))return null;
  const steps=[];
  for(const wording of clauses){
   const matches=intended(wording);
   const explicit=matches.length===1?matches[0]:null;
   const result=discoveryRows(queryOperations.filter(op=>op.kind!=='ACTION'),indexed,{search:wording.slice(0,240),page:1});
   // A compound plan only coordinates independently identified reads. Keep open
   // discovery for ambiguous or unsupported clauses rather than forcing a substitute.
   const preferred=result.preferred_operation||(result.total_operations===1?result.operations[0].operation:null);
   const operation=explicit||(preferred?assistantQuery(preferred):null);
   if(!operation&&steps.length&&/^(?:(?:please|briefly)\s+)*(?:recommend|suggest|give (?:one|a) (?:recommendation|next check)|cadangkan|建议|建議)/iu.test(wording)&&!result.total_operations)continue;
   if(!operation||steps.some(step=>step.operation===operation.id))return null;
   const prior=steps.at(-1);
   const sameOutlet=prior&&operation.tool.parameters.properties.outlet_id&&
    assistantQuery(prior.operation).tool.parameters.properties.outlet_id&&
    (outletContinuation(wording)||/\b(?:there|at that location|di sana)\b|在那[里裡]|那[家間]店/iu.test(wording));
   steps.push({...planFor(operation),wording,intent:operation.queryIntent?.(wording),...(sameOutlet?{outletWording:prior.outletWording||prior.wording}:{})});
  }
  if(steps.length>=2&&steps.length<=4)lastGoal=steps;
  return lastGoal;
 }
 async function planTurn(prompt,history,signal,{textPages=false}={}){
  if(!prompt)return null;
  if(asksWorkflow(prompt)||planGoal(prompt))return null;
  const textPage=textPages?await finishedGoodsRead.planTextPage(prompt,history):null;
  if(textPage)return {...planFor(finishedGoodsRead),textPage};
  // Page-only turns reuse an exact authorized query, never a guessed or mixed one.
  if(pageRequest(prompt)){
   const page=continuedPage(prompt,await history?.(),id=>operations.find(op=>op.id===id));
   if(page.pagination_reply)return page;
   return {...planFor(assistantQuery(page.operation)),page};
  }
  const operation=planned(prompt);
  if(operation&&(!asksForAnalysis(prompt)||operation.resolveAnalyticalQuery))return {...planFor(operation),intent:operation.queryIntent(prompt),wording:prompt};
  if(asksForAnalysis(prompt))return null;
  // Domain-owned follow-ups may constrain the most recent successful scope.
  if(history){
   const previous=previousBusinessResult(await history());
   const prior=operations.find(op=>op.id===previous?.capability);
   const followUp=prior?.followUp?.(prompt,previous);
   if(followUp)return {...planFor(prior),followUp};
   const intent=prior?.contextualIntent?.(prompt,previous);
   if(intent)return {...planFor(prior),intent,contextualOutlet:previous.outlet.id};
  }
  const resume=await resumeScopedTask({prompt,history,planned,operationFor:id=>operations.find(op=>op.id===id),caller,signal});
  return resume?{...planFor(resume.owner),intent:resume.owner.queryIntent?.(resume.wording),wording:resume.wording,
   outlet:resume.outlet,resumeArguments:resume.args,scopePending:!resume.outlet}:null;
 }
 async function resolveTurnScope(operation,plan,prompt,history,signal){
  if(plan?.resumeArguments)return {named:plan.outlet?[plan.outlet]:[],inherited:null};
  const wording=correctedOutletWording(prompt);
  const directory=plan&&prompt&&!plan.outlet?await outletDirectory(caller,signal):[];
  let named=plan?.outlet?[plan.outlet]:namedOutlets(directory,wording);
  if(!named.length&&plan?.outletWording){
   return {named:namedOutlets(directory,correctedOutletWording(plan.outletWording)),inherited:null};
  }
  const inherited=plan?.contextualOutlet||null;
  if(named.length||!history||!outletContinuation(prompt)&&!affirmedOutlet(prompt))return {named,inherited};
  const prior=await history();
  // A confirmed adjacent name takes priority over older saved results.
  if(plan&&affirmedOutlet(prompt)){
   const pending=previousNamedTurn(prior);
   if(pending)named=namedOutlets(directory,correctedOutletWording(pending));
   if(named.length)return {named,inherited:null};
  }
  const domain=domainOf(operation);
  return {named,inherited:confirmedOutlet(prior,operation.id,domain==='restaurant'?domain:null)};
 }
 function turnArguments(operation,plan,prompt,named,outletId){
  const defaults=plan.resumeArguments||operation.prepareArguments?.(plan.wording||prompt);
  if(!defaults)return null;
  if(outletId)return {...defaults,outlet_id:outletId,outlet_name:null,...defaults.outlet_scope?{outlet_scope:'named',outlet_names:[]}:{}};
  if(named.length===1)return {...defaults,outlet_name:named[0].name,outlet_id:null,...defaults.outlet_scope?{outlet_scope:'named',outlet_names:[]}:{}};
  if(named.length>1&&defaults.outlet_scope&&named.length<=12)return {...defaults,outlet_scope:'each_outlet',outlet_names:named.map(outlet=>outlet.name)};
  if(!named.length&&defaults.outlet_scope&&!outletContinuation(prompt)&&
   (defaults.outlet_scope==='each_outlet'||!/\b(?:at|for|in|di)\s+|在|门店|門店/iu.test(prompt)))return defaults;
  return null;
 }
 function groundedRecommendation(evidences,prompt,goal){
  if(!asksForAnalysis(prompt)||!evidences.length||evidences.some(e=>!e?.capability||e.no_evidence||e.not_business_evidence||outcomeFor(e)!=='SUCCESS'))return null;
  const language=/\p{Script=Han}/u.test(prompt)?'zh':/\b(?:berapa|semak|perbelanjaan|kos|cadang(?:an|kan)?|mengapa|kenapa)\b/iu.test(prompt)?'ms':'en';
  const facts=[],checks=[];
  for(const evidence of evidences){
   const owner=assistantQuery(evidence.capability);
   if(owner.kind!=='READ'||evidence.version!==owner.moduleInterface.evidence_version||evidence.source!==owner.moduleInterface.source)return null;
   const wording=goal?.find(step=>step.operation===owner.id)?.wording||prompt;
   const formatted=owner.format?.(evidence,wording);
   if(!formatted)return null;
   facts.push(formatted);
   const check=owner.nextCheck?.(evidence,language);
   if(check&&!checks.includes(check))checks.push(check);
  }
  // A comparative question also needs the actual compared values and change.
  // The monetary comparison formatter retains ownership of those answers.
  if(!checks.length||operationalAnalysis(evidences,assistantQuery)?.comparisons.length)return null;
  return [...facts,...checks].join('\n');
 }
 return {
  capabilities,
  guidance_sources:guideAvailable(config||{},access||{})?[{id:systemGuidance.id,module_id:systemGuidance.module_id,...systemGuidance.knowledge,availability:'live_source',retrieval:'current_release'}]:[],
  tools:(()=>{const offered=queryOperations.filter(operation=>indexed.find(item=>item.id===operation.id)?.availability==='connected');return offered.length>8?queryDiscoveryTools:offered.map(queryTool);})(),
  preferredVoiceTools:operations.filter(operation=>operation.prepareArguments&&planFor(operation)?.tool).map(queryTool),
  analyze:evidences=>operationalAnalysis(evidences,assistantQuery),
  groundedRecommendation,
  validAnswerAmounts:(reply,evidences)=>verifiedAnswerAmounts(reply,evidences,assistantQuery),
  planGoal,
  planTurn,
  measureOwner(prompt){
   const id=identifyReadOwner(queryOperations,prompt.slice(0,240));
   return id?planFor(assistantQuery(id)):null;
  },
  async unavailableRead(plan,prompt){
   if(!assistantQuery(plan.operation).narrowerReads?.[plan.intent])return null;
   const current=loadConfig?await loadConfig():config||{};
   return unavailableDiscovery(plan,businessCapabilities(current,access||{}),prompt);
  },
  plan(prompt){
   if(asksWorkflow(prompt)||planGoal(prompt))return null;
   const operation=planned(prompt);
   if(asksForAnalysis(prompt)&&!operation?.resolveAnalyticalQuery)return null;
   return operation?{...planFor(operation),intent:operation.queryIntent(prompt),wording:prompt}:null;
  },
  async resolvedArguments(plan,prompt,history,signal){
   if(!plan?.tool||plan.scopePending)return null;
   const operation=assistantQuery(plan.operation);
   if(plan.followUp&&operation.format)return plan.followUp;
   if(plan.page&&operation.formatsListPages===true)return plan.page.args;
   if(!plan.resumeArguments&&!operation.prepareArguments?.(plan.wording||prompt))return null;
   const current=loadConfig?await loadConfig():config||{};
   if(!capabilityConnected(current,operation.id)||!operation.authorized(access||{}))throw new AssistantError('business_read_denied',403);
   await permitted(caller,operation.permission,signal);
   const {named,inherited}=await resolveTurnScope(operation,plan,prompt,history,signal);
   return turnArguments(operation,plan,prompt,named,inherited);
  },
  excludedForPrompt:prompt=>excludeCompetingQueries(operations,prompt),
  toolsForPrompt(prompt,excluded=new Set()){
   if(typeof prompt!=='string'||!prompt.trim())return [];
   const goal=planGoal(prompt);
   if(goal)return goal.filter(step=>step.tool&&!excluded.has(step.operation)).map(step=>step.tool);
   const searchable=queryOperations.filter(operation=>!excluded.has(operation.id)&&operation.kind!=='ACTION');
   const question=prompt.slice(0,240);
   // Discover each question separately so a strong match on one domain cannot
   // hide the resource referenced by the other question.
   const clauses=question.split(/\b(?:and|also)\s+(?=(?:what|how|which|show|count|list)\b)|另外|以及|并且|並且/iu).slice(0,2);
   const matches=clauses.map(search=>discoveryRows(searchable,indexed,{search,page:1}).operations);
   const ranked=matches.length===1?matches[0]:[...matches.map(rows=>rows[0]).filter(Boolean),...matches.flat()];
   return [...new Set([...(asksWorkflow(prompt)&&guideAvailable(config||{},access||{})?[systemGuidance.id]:[]),...ranked.map(item=>item.operation)])].slice(0,2).map(id=>queryTool(assistantQuery(id)));
  },
  async execute(id,args,signal,{correctArguments=false,excluded,prompt,history,withOutcome=false,turnPlan,currentEvidence=[]}={}){
   if(pageRequest(prompt)){
    turnPlan=turnPlan??await planTurn(prompt,history,signal);
    if(turnPlan?.pagination_reply)return {query_outcome:turnPlan.query_outcome,answer_hint:turnPlan.pagination_reply,no_evidence:true,not_business_evidence:true};
   }
   const blocked=excluded||excludeCompetingQueries(operations,prompt);
   const goal=planGoal(prompt);
   const enveloped=id==='run_business_query';
   if(isQueryEnvelope(id)){
    const parsed=queryEnvelopeArguments(id,args);
    if(id==='find_business_queries'){
     const current=loadConfig?await loadConfig():config||{};
     const plan=turnPlan??(await planTurn(prompt,history,signal));
     const available=withGuide(businessCapabilities(current,access||{}),current);
     const requestedUnavailable=plan&&!available.some(row=>row.id===plan.operation&&row.availability==='connected');
     const candidates=queryOperations.filter(operation=>!blocked.has(operation.id)&&
      (!asksForAnalysis(prompt)||operation.kind!=='ACTION')&&(!goal||goal.some(step=>step.operation===operation.id))&&(!plan||operation.id===plan.operation));
     const knownSearch=typeof prompt==='string'&&prompt.trim()?prompt.trim().slice(0,240):null;
     const transcriptResult=!plan&&knownSearch&&parsed.page===1?discoveryRows(candidates,available,{search:knownSearch,page:1}):null;
     const toolResult=discoveryRows(candidates,available,plan?{search:plan.operation,page:1}:parsed);
     const useTranscript=transcriptResult&&(transcriptResult.preferred_operation||!toolResult.operations.length&&transcriptResult.operations.length);
     const result=requestedUnavailable?unavailableDiscovery(plan,available,prompt):
      useTranscript?{...transcriptResult,search_origin:'user_turn'}:{...toolResult,search_origin:plan?'planned_owner':'tool_search'};
     return withOutcome?{...result,query_outcome:outcomeFor(result)}:result;
    }
    id=parsed.operation;args=parsed.args;
   }
   const operation=assistantQuery(id);
   const step=goal?.find(item=>item.operation===id);
   const plan=step??turnPlan??(await planTurn(prompt,history,signal));
   const supplementaryGuide=id===systemGuidance.id&&asksWorkflow(prompt);
   if(blocked.has(id)||!supplementaryGuide&&(goal&&!step||plan&&plan.operation!==id)||operation.kind==='ACTION'&&asksForAnalysis(prompt))throw new AssistantError('tool_not_allowed',403);
   if(step)prompt=step.wording;
   // ACTION requires a separate, server-owned execution authority and confirmed
   // intent. Neither a tool argument nor the human's existing permission grants it.

   const current=loadConfig?await loadConfig():config||{};
   if(operation.kind==='ACTION'&&current.ai_action_authorizations?.[id]!==true)throw new AssistantError('action_not_authorized',403);
   if(operation.kind==='GUIDANCE'){
    if(!guideAvailable(current,access||{}))throw new AssistantError('business_read_denied',403);
   }else{
    if(!capabilityConnected(current,id))throw new AssistantError('capability_disconnected',403);
    if(!operation.authorized(access||{}))throw new AssistantError(operation.deniedCode,403);
   }
   if(operation.kind==='READ'&&typeof prompt==='string'&&operation.scopeTextArguments)args=operation.scopeTextArguments(args,prompt,plan?.intent);
   const domain=domainOf(operation);
   try{
    if(args===undefined)invalidArgument('invalid_json');
    if(operation.kind==='READ'&&args&&typeof args==='object'&&!Array.isArray(args)){
     args={...args};
     const properties=operation.tool.parameters.properties;
     const accepted=queryTool(operation).parameters.properties;
     if(Object.keys(args).some(key=>!Object.hasOwn(accepted,key)))invalidArgument('unexpected_field');
     if(plan?.textPage&&operation===finishedGoodsRead)args={...args,...plan.textPage.args};
     if(plan?.page||plan?.followUp)args=plan.page?.args||plan.followUp;
     if(properties.outlet_id&&!plan?.page&&!plan?.followUp){
      if(args.outlet_name!=null&&(typeof args.outlet_name!=='string'||!args.outlet_name.trim()||args.outlet_name.length>120))
       invalidArgument('unsupported_value','outlet_name');
      // Only an independently identified single-domain turn can bind a name from the whole utterance.
      const scopeText=correctedOutletWording(prompt);
      if(plan)await permitted(caller,operation.permission,signal);
      const {named,inherited}=await resolveTurnScope(operation,plan,prompt,history,signal);
      const resolved=plan?turnArguments(operation,plan,prompt,named,inherited):null;
      if(resolved)args={...args,...resolved};
      else if(named.length>1)throw new AssistantError('entity_ambiguous',409);
      else if(named[0]){args.outlet_name=named[0].name;args.outlet_id=null;}
      if(plan&&!resolved&&!named.length&&(!step||step.intent||args.outlet_name||args.outlet_id)){
       const wording=' '+entityKey(scopeText)+' ';
       const supplied=args.outlet_name||args.outlet_id;
       if(inherited||!supplied||!wording.includes(' '+entityKey(supplied)+' ')){
        if(!inherited)throw new AssistantError('entity_scope_required',409);
        args.outlet_name=null;
        args.outlet_id=inherited;
       }
      }
      if(!plan&&!args.outlet_name&&!args.outlet_id&&inherited)args.outlet_id=inherited;
      if(!properties.outlet_name){
       if(args.outlet_name){
        const outlet=await resolveOutlet(caller,{outlet_name:args.outlet_name},signal);
        if(!outlet)throw new AssistantError('entity_unresolved',409);
        args.outlet_id=outlet.id;
       }
       delete args.outlet_name;
      }
     }
     if(operation.employeeNameLookup&&Object.hasOwn(args,'employee_name')){
      const name=args.employee_name;
      if(name!==null){
       if(typeof name!=='string'||!name.trim()||name.length>80)invalidArgument('unsupported_value','employee_name');
       if(!capabilityConnected(current,employeeDirectoryRead.id))throw new AssistantError('capability_disconnected',403);
       await permitted(caller,operation.permission,signal);
       await permitted(caller,employeeDirectoryRead.permission,signal);
       const values=employeeDirectoryRead.validate({mode:'list',query:name.trim()});
       const employee=await resolveDirectoryEmployee(caller,values,signal);
       if(args.employee_id&&args.employee_id!==employee.id)throw new AssistantError('entity_ambiguous',409);
       args.employee_id=employee.id;
      }
      delete args.employee_name;
     }
     if(properties.brand_id&&!properties.brand_name){
      if(args.brand_name!=null){
       if(typeof args.brand_name!=='string'||!args.brand_name.trim()||args.brand_name.length>120)invalidArgument('unsupported_value','brand_name');
       const brand=await resolveBrand(caller,args.brand_name,signal);
       if(!brand)throw new AssistantError('entity_unresolved',409);
       args.brand_id=brand.id;
       if(properties.organization_id&&brand.organization_id)args.organization_id=brand.organization_id;
      }
      delete args.brand_name;
     }
    }
    if(plan?.scopePending)throw new AssistantError('entity_scope_required',409);
    const normalized=operation.validate(args);
    signal?.throwIfAborted();
    if(operation.kind==='READ'&&!operation.knowledge){
     const prior=currentEvidence.find(row=>row?.capability===id&&row.source===operation.moduleInterface.source&&row.version===operation.version&&
      row.requested_scope&&Object.keys(normalized).length===Object.keys(row.requested_scope).length&&
      Object.entries(normalized).every(([key,value])=>JSON.stringify(row.requested_scope[key])===JSON.stringify(value)));
     if(prior)return {operation:id,query_outcome:outcomeFor(prior),already_read:true,not_business_evidence:true,
      instruction:'This exact scoped read already returned in this turn. Use its earlier evidence. Ask for clarification if unresolved.'};
    }
    // caller is the authenticated human client, never the service-role client.
    const evidence=await (readFactory&&id===finishedGoodsRead.id?readFactory(args,signal):operation.kind==='GUIDANCE'?operation.execute(caller,args,signal,sessionId,query=>workflowKnowledge(query,operations,
     op=>capabilityConnected(current,op.id)&&op.authorized(access||{})&&(op.knowledge?.additional_permissions||[]).every(p=>access?.permissions?.[p]===true),caller,signal,{prompt,history})):operation.execute(caller,args,signal,sessionId));
    if(operation.kind==='READ')verifyReadEvidence(operation.moduleInterface,id,evidence,normalized);
    return withOutcome&&operation.kind!=='ACTION'?{...evidence,...operation.kind==='READ'&&!evidence.requested_scope?{requested_scope:normalized}:{},
     query_outcome:outcomeFor(evidence),query_domain:domain}:evidence;
   }catch(error){
    if(error.code==='business_result_limit'&&['single_record_exceeds_evidence_limit','metadata_exceeds_evidence_limit'].includes(error.diagnostic?.reason))
     return {error:'business_result_limit',reason:error.diagnostic.reason,not_business_evidence:true,no_evidence:true,
      query_outcome:'EXECUTION_ERROR',operation:id,operation_label:operation.label,
      instruction:error.diagnostic.reason==='single_record_exceeds_evidence_limit'?'Even one record exceeds the safe response size. Explain the limitation and direct the user to the owning module.':'The required summary metadata exceeds the safe response size. Explain the limitation and direct the user to the owning module.'};
    if((enveloped||correctArguments)&&error.code==='tool_arguments_invalid')return {error:'tool_arguments_invalid',not_business_evidence:true,no_evidence:true,
     ...(withOutcome?{query_outcome:'UNSUPPORTED'}:{}),operation:id,operation_label:operation.label,
     parameters:queryTool(operation).parameters,description:operation.tool.description,
     validation:error.diagnostic?.validation||{reason:'invalid_combination'},
     instruction:'Retry using the schema, operation description and validation fields. Preserve explicit supported filters. No business result or action was produced.'};
    throw error;
   }
  },
  formatFollowUpAnswer(id,evidence,prompt,options){return assistantQuery(id).formatFollowUpAnswer?.(evidence,prompt,options)||null;},
  format(id,evidence,prompt,options){return assistantQuery(id).format?.(evidence,prompt,options)||null;},
  completeTextPage(evidence,plan){return plan?.textPage?finishedGoodsRead.completeTextPage(evidence,plan.textPage):null;},
 };
}

export async function businessAccess(caller){
 const unique=[...new Set(operations.map(o=>o.permission))];
 const {data,error}=await caller.rpc('native_assistant_permissions',{p_codes:unique});
 if(error||!data||typeof data!=='object'||Array.isArray(data))throw new AssistantError('admin_required',403);
 const permissions=Object.fromEntries(unique.map(permission=>[permission,data[permission]===true]));
 return {admin:true,permissions,factory:permissions['factory_finished_goods.view']===true};
}

// Explicit existing members only. Never derive blanket access from module IDs.
export function modulePolicyMembers(id){
 const members=operations.filter(o=>o.kind==='READ'&&o.policyGroup===id);
 if(!members.length)throw new AssistantError('tool_not_allowed',403);
 return members.map(o=>o.id);
}
