import assert from 'node:assert/strict';
import {checkCapture} from './nativeAssistantOperationalCertification.mjs';

// The noun is the grain of the owning read model. A roster entry is a duty
// assignment, a recipe row is a version, and an observed post is not an impression.
const counts=[
 ['Restaurant','read_inventory_stock_evidence','matching stock positions','(?:stock )?positions?'],
 ['Restaurant','read_inventory_par_levels','item-to-outlet par configurations','(?:par )?(?:settings|configurations?)'],
 ['Factory','read_factory_audit_events','Factory audit events','(?:audit )?events?'],
 ['Factory','read_factory_raw_control_standards','raw material acceptance standards','(?:acceptance )?standards?'],
 ['Factory','read_factory_raw_control_evidence','raw material receipt lines','(?:receipt|receiving) lines?'],
 ['Factory','read_factory_storage_control','finished product storage records','(?:storage )?records?'],
 ['Factory','read_factory_processing_control','completed production QC entries','(?:production )?QC (?:entries|records?)'],
 ['Factory','read_factory_feedback_campaigns','Factory feedback campaigns','(?:feedback )?campaigns?'],
 ['Factory','read_factory_label_configuration','product label configurations','(?:product )?label (?:configurations?|records?)','page'],
 ['Factory','read_factory_transfers','Factory internal transfers','(?:internal )?transfers?','page'],
 ['Factory','read_factory_cash','matching petty cash transactions','(?:petty cash )?transactions?','page'],
 ['HR','read_role_directory','role definitions','role (?:records?|definitions?)'],
 ['HR','read_audit_event_metadata','retained audit events','(?:audit )?events?'],
 ['HR','read_payroll_run_status','authorized payroll periods','payroll periods?'],
 ['Crew','read_crew_performance_snapshot','matching saved performance results','(?:performance )?results?'],
 ['Marketing','read_marketing_ads_evidence','recorded ad reporting snapshots','(?:ad |reporting )?(?:snapshots?|reports?)'],
 ['Restaurant','read_sales_records','sales input entries','sales (?:input )?(?:entries|records?)'],
 ['Restaurant','read_inventory_waste','inventory waste records','waste (?:entries|records?)'],
 ['Restaurant','read_inventory_orders','inventory purchase orders','(?:purchase )?orders?'],
 ['Restaurant','read_inventory_check_groups','stock check groups','(?:stock[- ]check )?groups?'],
 ['Restaurant','read_inventory_recipe_catalogue','inventory recipes','(?:recipe catalogue entries|recipes?)'],
 ['Factory','read_factory_suppliers','Factory suppliers','(?:factory )?suppliers?'],
 ['Factory','read_factory_customers','Factory customers','(?:factory )?customers?'],
 ['Factory','read_factory_locations','Factory storage locations','(?:storage )?locations?'],
 ['Factory','read_factory_production_records','Factory production records','production (?:entries|records?)'],
 ['Factory','read_factory_recipe_versions','Factory recipe versions','(?:recipe )?versions?'],
 ['Factory','read_factory_equipment_cleaning_requirements','equipment cleaning requirements','(?:cleaning )?requirements?'],
 ['HR','read_legal_entities','legal entities','legal entit(?:ies|y)'],
 ['HR','read_employee_notice_status','employee notices','(?:employee )?notices?'],
 ['HR','read_employment_document_status','employment document records','employment documents?(?: records?)?'],
 ['HR','read_recruitment_openings','recruitment openings','(?:recruitment )?openings?'],
 ['Crew','read_crew_roster','duty roster entries','(?:roster (?:entries|assignments?)|duty assignments?)'],
 ['Crew','read_crew_skill_requirements','registered skill definitions','skill definitions?'],
 ['Crew','read_crew_sop_catalogue','published SOPs','published SOPs?'],
 ['Crew','read_crew_onboarding_progress','Crew members in the onboarding progress view, including those without an enrollment','(?:crew members?|member progress records?)'],
 ['Marketing','read_marketing_campaigns','campaigns','campaigns?'],
 ['Marketing','read_marketing_audiences','audiences','audiences?'],
 ['Marketing','read_marketing_connection_health','channel connections','(?:channel )?connections?'],
 ['Marketing','read_marketing_creator_posts','recorded creator posts','(?:creator )?posts?'],
 ['Marketing','read_marketing_social_performance','reported observation windows','(?:observation|reporting) (?:windows?|records?)'],
 ['Marketing','read_platform_team_access','visible organization team members','(?:team )?members?'],
 ['Marketing','read_platform_brands','visible Brands','brands?'],
];

function validateFinalAmount(reply,amount){
 const amounts=[...reply.matchAll(/(?:RM|MYR)\s*(-?\d+(?:\.\d+)?)\b/giu)].map(match=>Number(match[1]));
 assert.deepEqual([...new Set(amounts)],amount===null?[]:[amount],'Closing value is missing, invented, or contradicted');
}

export function registerScenarios(operations,canonicalPath){
 const map=new Map(operations.map(op=>[op.id,op]));
 const wrap=(id,domain,question,check)=>{
  const op=map.get(id);
  assert(op?.kind==='READ','Scenario needs a bound READ: '+id);
  const owner={owner:op.module_id,canonicalRoute:canonicalPath(op.module_id),rpc:op.rpc};
  return {domain,operations:[id],medium:'text',question,independentOwnerCheck:true,
   check:([e],reply,source,turn)=>{
    checkCapture(owner,source,turn,e.as_of);
    assert.equal(e.source,op.source||op.moduleInterface.source,'Wrong business authority');
    assert.equal(e.query_outcome,'SUCCESS');
    assert(Number.isFinite(Date.parse(e.as_of)),'Saved evidence freshness is missing');
    assert.deepEqual(e.requested_scope,source.scope,'Saved scope differs from independent capture');
    check(e,reply,source);
   }};
 };
 const cases={};
 for(const [domain,id,label,noun,boundary] of counts){
  cases[id+'_filtered_register_count']=wrap(id,domain,'How many '+label+' match those conditions?',(e,reply,s)=>{
   if(boundary!=='page')assert.equal(s.scope.mode,'summary');
   assert.equal(s.scope.page,1);
   assert(Number.isSafeInteger(s.count)&&s.count>=0,'Independent exact filtered count required');
   assert.equal(e.aggregate_complete,true);
   assert.equal(e.total_matching,s.count);
   if(boundary==='page'){
    assert(Number.isInteger(e.page_size)&&e.page_size>0);
    assert.deepEqual(e.rows.map(row=>row.id),s.page_ids,'Canonical first page differs');
    assert.equal(e.rows.length,Math.min(e.page_size,s.count));
    assert.equal(e.truncated,s.count>e.page_size);
   }else assert.equal(e.rows.length,0,'Expected the summary query');
   const words='(?:'+noun+')';
   const stated=[...reply.matchAll(new RegExp('(?<![\\d.-])(\\d+)\\s+(?:(?:matching|recorded|registered|active|archived|authorized|published)\\s+)*'+words+'\\b|\\b'+words+'\\s*(?:count|total)?\\s*(?:[:=]|is|are|total(?:ed)?|stand at)\\s*(\\d+)(?!\\d|\\.\\d)','giu'))].map(m=>Number(m[1]??m[2]));
   assert.deepEqual([...new Set(stated)],[s.count],'Final answer must bind the actual count to its business unit');
  });
 }
 cases.crew_review_assignment_count=wrap('read_crew_task_snapshot','Crew',
  'How many task assignments require review in this date range? Give one recorded task name when available.',(e,reply,s)=>{
   assert.equal(s.scope.listing,'review_queue');
   assert.equal(e.total_matching,s.count);assert.equal(e.aggregate_complete,true);
   assert.deepEqual(e.rows.map(r=>[r.name,r.business_date,r.status]),s.rows);
   assert.match(reply,new RegExp('(?<![.\\d])'+s.count+'\\s+(?:task )?assignments?','iu'));
   if(s.count>0)assert(s.rows.some(([name])=>typeof name==='string'&&reply.toLowerCase().includes(name.toLowerCase())));
  });
 cases.workflow_source_ceiling=wrap('read_marketing_workflows','Marketing',
  'How many workflow definitions can the Brand register establish? Distinguish an exact count from the source limit.',(e,reply,s)=>{
   assert(Number.isSafeInteger(s.visible)&&s.visible>=0&&s.visible<=100);
   assert.equal(e.total_lower_bound,s.visible);
   assert.equal(e.aggregate_complete,s.visible<100);
   assert.equal(e.total_matching,s.visible<100?s.visible:null);
   assert.match(reply,new RegExp('(?<![.\\d])'+s.visible+'\\s+(?:workflow )?definitions?','iu'));
   if(s.visible===100){assert.match(reply,/at least|lower bound|latest 100|only (?:the )?first 100|full (?:total|count) (?:is )?unknown/iu);
    assert.doesNotMatch(reply,/exactly 100|100 (?:workflow )?definitions? in total/iu);}
  });
 cases.receiving_quantity_units=wrap('read_factory_receiving_summary','Factory',
  'How many receipt documents and lines are recorded for this supplier and period? Does the receipt summary establish a total weight in kilograms?',(e,reply,s)=>{
   assert.equal(e.summary.documents,s.documents);assert.equal(e.summary.items,s.lines);
   assert.equal(e.summary.total_qty,s.source_quantity);
   assert.match(reply,new RegExp('(?<![.\\d])'+s.documents+'\\s+(?:receiving |receipt )?documents?','iu'));
   assert.match(reply,new RegExp('(?<![.\\d])'+s.lines+'\\s+(?:receipt |item )?(?:lines?|rows?)','iu'));
   assert.match(reply,/unit|weight|kilogram/iu);assert.match(reply,/cannot|unknown|mixed|no (?:verified |common |shared )|unavailable|not (?:a |established|given|available)/iu);
   assert.doesNotMatch(reply,/[-+]?\d+(?:\.\d+)?\s*(?:kg|kilograms?)\b/iu);
  });
 cases.factory_recipe_standards_and_versions=wrap('read_factory_recipe_versions','Factory',
  'How many products have active current recipe standards out of all current standards? Compare this with active saved versions out of all recorded versions.',(e,reply,s)=>{
   assert.equal(s.scope.measure,'current_products');assert.equal(s.scope.mode,'summary');assert.equal(s.scope.status,'active');
   assert.equal(e.aggregate_complete,true);
   const count=rows=>{
    assert(Array.isArray(rows)&&rows.every(row=>row.id&&typeof row.status==='string'),'Independently read identities and statuses required');
    assert.equal(rows.length,new Set(rows.map(row=>row.id)).size);
    const by_status={active:0,draft:0,archived:0};
    for(const row of rows)by_status[row.status]=(by_status[row.status]??0)+1;
    return {total:rows.length,by_status};
   };
   const products=count(s.current_standards),versions=count(s.saved_versions);
   assert.deepEqual(e.current_products,products);assert.deepEqual(e.recorded_versions,versions);assert.equal(e.total_matching,products.by_status.active);
   for(const [noun,v] of [['(?:products?|(?:current )?(?:recipe )?standards?)',products],['(?:saved |recorded |recipe )?versions?',versions]]){
    const ratio='(?<![.\\d])'+v.by_status.active+'\\s*(?:of|out of|/)\\s*'+v.total+'(?!\\d|\\.\\d)';
    const clauses=reply.split(/[.;\n]/u).filter(part=>new RegExp(noun,'iu').test(part));
    assert(clauses.some(part=>new RegExp(ratio,'iu').test(part)&&/active/iu.test(part)),'Final answer must pair active count, total and recipe population');
   }
  });
 cases.customer_filtered_and_brand_totals=wrap('read_brand_customer_directory','Marketing',
  'How many customers match these filters, and how many subscribed customers are recorded across this entire Brand?',(e,reply,s)=>{
   assert(s.scope.status!=='all'||s.scope.consent!=='all','A filtered source cohort is required');
   assert.equal(s.scope.page,1);
   assert(Number.isSafeInteger(s.filtered_total)&&Number.isSafeInteger(s.brand_subscribed),'Independent cohort and whole-brand totals required');
   assert.equal(e.total_matching,s.filtered_total);
   assert.equal(e.aggregate_complete,true);
   assert.equal(e.summary.subscribed,s.brand_subscribed);
   assert.match(e.summary_scope,/entire.*brand|whole.*brand/iu);
   assert.match(reply,new RegExp('(?:matching|filtered)(?: customers?)?\\s*[:=]?\\s*'+s.filtered_total+'(?!\\d|\\.\\d)|(?<![.\\d])'+s.filtered_total+'\\s+(?:matching|filtered) (?:customers?|records?)','iu'));
   assert.match(reply,new RegExp('(?:whole|entire|all|across (?:the|this))[^.\\n]{0,80}(?<!\\d)'+s.brand_subscribed+'\\s+subscribed|(?<!\\d)'+s.brand_subscribed+'\\s+subscribed[^.\\n]{0,75}(?:whole|entire|across|brand-wide)','iu'));
  });
 cases.stock_closing_publication=wrap('read_inventory_checks','Restaurant',
  'Has the submitted month-end stock check been published? Give its current revision and actual count date if recorded.',(e,reply,s)=>{
   assert.equal(s.scope.mode,'closing');
   assert.deepEqual(e.publication_state,s.state);
   assert(['published','submitted_unpublished','no_submitted_audit'].includes(s.state));
   if(s.state==='published'){
    assert(s.publication&&Number.isInteger(s.publication.revision)&&s.publication.source_audit_id,'Canonical published revision and source audit required');
    for(const key of ['source_audit_id','revision','actual_count_date','approved_at','valuation_status','valued_item_count','total_item_count'])
     assert.deepEqual(e.publication[key],s.publication[key],'Published closing evidence differs for '+key);
    assert.match(reply,/published|publication/iu);
    assert.doesNotMatch(reply,/not (?:yet )?published|unpublished|no submitted/iu);
    assert.match(reply,new RegExp('(?:revision|version|rev\\.?)\\s*[:#-]?\\s*'+s.publication.revision+'(?!\\d|\\.\\d)','iu'));
    if(s.publication.actual_count_date)assert(reply.includes(s.publication.actual_count_date));
    else assert.match(reply,/count date.{0,32}(?:unavailable|not recorded|unknown)/iu);
   }else{
    assert.equal(s.publication,null);
    assert.equal(e.publication,null);
    assert.match(reply,s.state==='submitted_unpublished'?/unpublished|not (?:yet )?published/iu:/no (?:submitted |qualifying )?(?:month-end |closing )?(?:audit|stock check)|(?:no|not) .{0,30}submit/iu);
   }
   validateFinalAmount(reply,null);
  });
 cases.finance_closing_valuation=wrap('read_operational_financials','Finance',
  'What is the published closing stock valuation? Include its currency, valuation coverage and whether the amount is partial or complete.',(e,reply,s)=>{
   assert.equal(s.scope.measure,'closing_stock');
   assert.equal(e.comparison_closing_stock,undefined,'A single-period question returned an unrelated comparison');
   assert.deepEqual(e.closing_stock.outlet,s.outlet);
   assert.deepEqual(e.closing_stock.period,s.period);
   assert.equal(e.closing_stock.currency,'MYR');
   // Compare raw reporting fields, not a second copy of the Assistant projection.
   const src=s.closing_stock_evidence;
   assert(src===null||['partial','complete'].includes(src?.valuation_status),'Missing independent Reporting publication state');
   const status=src?.valuation_status??'unavailable';
   assert.equal(e.closing_stock.status,status);
   for(const [out,raw] of [['amount','amount'],['valued_items','valued_item_count'],['total_items','total_item_count'],['actual_count_date','actual_count_date']])
    assert.equal(e.closing_stock[out],src?.[raw]??null);
   if(status==='unavailable')assert.match(reply,/unavailable|not available|no published|not published/iu);
   else{
    assert.match(reply,new RegExp('\\b'+status+'\\b','iu'));
    if(status==='partial')assert.doesNotMatch(reply.replace(/\b(?:not|isn't) (?:complete|fully valued)\b/giu,''),/\b(?:complete|fully valued)\b/iu);
    if(src.valued_item_count!=null&&src.total_item_count!=null)
     assert.match(reply,new RegExp('(?<!\\d)'+src.valued_item_count+'\\s*(?:/|of|out of)\\s*'+src.total_item_count+'(?!\\d)','iu'));
   }
   validateFinalAmount(reply,src?.amount??null);
  });
 return cases;
}

export function registerSourceCases(samples,scenarios){
 return samples.map(source=>{
  const id=source.scenario;
  const definition=scenarios[id];
  assert(definition&&Object.prototype.hasOwnProperty.call(scenarios,id)&&definition.independentOwnerCheck&&
   (id.endsWith('_filtered_register_count')||['stock_closing_publication','finance_closing_valuation','customer_filtered_and_brand_totals','crew_review_assignment_count','workflow_source_ceiling','receiving_quantity_units','factory_recipe_standards_and_versions'].includes(id)),'Unsupported register scenario');
  assert(typeof source.scope_label==='string'&&source.scope_label.trim()&&source.scope_label.length<=300,'A source-derived scope description is required');
  assert(!/[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}/i.test(source.scope_label),'Use human-readable scope in questions');
  return {id,question:source.scope_label.trim()+'. '+definition.question,source};
 });
}
