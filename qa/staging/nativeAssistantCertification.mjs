import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {assistantQuery,operations} from '../../supabase/functions/native-assistant/business.js';

const scenario=(domain,operations,question,check)=>({domain,operations,question,check});
const plain=value=>value.normalize('NFKC').replace(/[*`]/g,'').replace(/(?<=\d),(?=\d{3}\b)/g,'');
const escaped=text=>String(text).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const number=n=>`(?<![0-9.-])${escaped(n)}(?![0-9]|[.,][0-9])`;
const named=(reply,name,value)=>assert.match(reply,new RegExp(`(?:${name})[\\s:：=—-]{0,16}${number(value)}`,'iu'));
const ranked=(skuField)=>([e],reply,source)=>{
 assert.equal(e.ranking?.status,'ranked');
 assert.equal(e.ranking.unit,source.unit);
 assert.equal(e.ranking.order,source.order);
 assert.equal(e.ranking.ranked_count,source.count);
 if(skuField==='material_code')assert.equal(e.requested_scope?.status,'active');
 assert.deepEqual(e.rows.slice(0,source.top.length).map(row=>[row[skuField],row.current_balance]),source.top);
 let end=0;
 for(const [sku,value] of source.top){
  const entry=new RegExp(`(?<![\\w-])${escaped(sku)}(?![\\w-])[\\s\\S]{0,160}?${number(value)}\\s*${escaped(source.unit)}\\b`,'i').exec(reply.slice(end));
  assert.ok(entry,`Answer did not pair ${sku} with its ranked balance in ${source.unit}`);
  end+=entry.index+entry[0].length;
 }
};
function incompleteFinance(e,reply,source){
 assert.deepEqual(e.report.period,source.period);
 assert.equal(e.report.financial_completeness,'incomplete');
 assert.equal(e.report.outlet.outlet_count,source.outlets);
 for(const metric of source.missing)assert.deepEqual(e.report.financials[metric],{amount:null,presence:'missing'});
 assert.match(reply,/incomplete|不完整/i);
 for(const metric of source.missing){
  const label={opex:'OPEX|operating expenses?',revenue:'revenue',net_profit:'net profit',purchase_based_cogs:'COGS|purchase-based costs?'}[metric];
  assert.match(reply,new RegExp(`(?:${label})[^\\n]{0,70}(?:missing|unavailable|not available)`,'i'),metric);
 }
}
function checkKnowledge(evidence,reply,source){
 assert.equal(evidence.source,source.route);
 assert.equal(evidence.knowledge.status,'found');
 for(const [key,value] of Object.entries(source.scope))assert.equal(evidence.knowledge.scope[key],value);
 const citation=evidence.knowledge.citations.find(item=>item.document_id===source.id&&item.version===source.version&&
  item.current===source.current&&item.state===source.state&&item.title===source.title&&
  (!source.versionId||item.version_id===source.versionId)&&(!source.section||item.section===source.section));
 assert(citation,'Expected authoritative document, version, state and section not found');
 assert.match(citation.excerpt,new RegExp(escaped(source.excerpt),'iu'));
 assert.match(reply,new RegExp(escaped(source.title),'iu'));
 assert.match(reply,new RegExp(`\\b(?:version\\s+|v)?${escaped(source.version)}\\b`,'iu'));
 if(source.section)assert.match(reply,new RegExp(escaped(source.section),'iu'));
 for(const fact of source.answerFacts)assert.match(reply,new RegExp(escaped(fact),'iu'));
 if(!source.current)assert.match(reply,/historical|formerly|previous version/i);
}

export const scenarios={
 knowledge_factory_stock:scenario('Factory',['read_factory_sop_versions','read_factory_finished_goods'],'What is one recorded instruction from the current Dried Shrimp Sambal Production SOP? Separately, what is the current Factory Finished Goods stock for SKU S01?',([sop,stock],reply,source)=>{
  checkKnowledge(sop,reply,source.document);
  const [row]=stock.rows;
  assert.equal(stock.rows.length,1);
  assert.equal(row.product_code,source.stock.code);
  assert.equal(row.current_balance,source.stock.quantity);
  assert.match(reply,new RegExp(`\\b${escaped(source.stock.code)}\\b`,'i'));
  assert.match(reply,new RegExp(`${number(source.stock.quantity)}\\s*${escaped(source.stock.unit)}\\b`,'i'));
 }),
 knowledge_crew_current:scenario('Crew',['read_crew_published_sop'],'At Friends Corner, what does the current Workstation Cleanliness SOP say to do with used items? Cite its version and outlet.',([e],reply,source)=>checkKnowledge(e,reply,source)),
 knowledge_factory_cleaning:scenario('Factory',['read_factory_cleaning_methods'],'What are the recorded steps in the current MeSTI Clean-in-Place method reference? Cite the version.',([e],reply,source)=>checkKnowledge(e,reply,source)),
 knowledge_crew_historical:scenario('Crew',['read_crew_published_sop'],'Read the specified historical published Crew SOP version. Identify it as historical and cite that version.',([e],reply,source)=>checkKnowledge(e,reply,source)),
 knowledge_crew_onboarding:scenario('Crew',['read_crew_onboarding_catalogue'],'What does the current published Crew Onboarding lesson say for the specified outlet and topic?',([e],reply,source)=>checkKnowledge(e,reply,source)),
 knowledge_marketing_faq:scenario('Marketing',['read_marketing_usable_faq'],'What does the current approved FAQ say the Idamans Food Industry brand name is? Cite the FAQ and its version.',([e],reply,source)=>checkKnowledge(e,reply,source)),
 knowledge_marketing_brand:scenario('Marketing',['read_marketing_knowledge_sources'],'What is the verified identity in the current Brand Knowledge for Idamans Food Industry? Cite the approved profile and revision.',([e],reply,source)=>checkKnowledge(e,reply,source)),
 knowledge_hr_template:scenario('People',['read_published_contract_templates'],'What does the current published unfilled template for the specified Legal Entity and clause say? Cite the template and version.',([e],reply,source)=>checkKnowledge(e,reply,source)),
 knowledge_hr_holiday:scenario('People',['read_payroll_holiday_policy'],'What public holiday treatment is recorded in the current applicable policy for the specified Legal Entity? Cite the policy and effective date.',([e],reply,source)=>checkKnowledge(e,reply,source)),
 knowledge_guide:scenario('Platform',['read_assistant_system_guidance'],'How do I reset my Personal Memory preferences in the FeedX Assistant? Cite the guide and version.',([e],reply,source)=>checkKnowledge(e,reply,source)),
 asset_spoon:scenario('Restaurant',['read_asset_catalogue'],'What is the current balance of asset-spoon at Friends Corner?',([e],reply,source)=>{
  assert.equal(e.source,'/operations/asset-tracking');
  assert.equal(e.requested_scope?.mode,'detail');
  assert.equal(e.outlet.id,source.outletId);
  assert.equal(e.match_status,'matched');
  assert.equal(e.rows.length,1);
  const [asset]=e.rows;
  assert.equal(asset.outlet_id,source.outletId);
  assert.equal(asset.name,source.name);
  assert.equal(asset.asset_code,source.code);
  assert.equal(asset.current_quantity,source.quantity);
  assert.equal(asset.unit,source.unit);
  assert.match(reply,new RegExp(escaped(source.outlet),'i'));
  assert.match(reply,new RegExp(`\\b${escaped(source.name)}s?\\b`,'i'));
  assert.match(reply,new RegExp(`${number(source.quantity)}\\s*(?:${escaped(source.unit)}s?|spoons?)\\b`,'i'));
  if(source.code==null)assert.doesNotMatch(reply,/\b(?:asset\s+)?(?:code|sku)\s*[:=]?\s*asset-spoon\b/i);
 }),
 asset_count:scenario('Restaurant',['read_asset_catalogue'],'Follow up in the same conversation: How many current asset records are registered at the same outlet? Count asset records, not quantities.',([e],reply,source)=>{
  assert.equal(e.requested_scope?.mode,'summary');
  assert.equal(e.outlet.id,source.outletId);
  assert.equal(e.aggregate_complete,true);
  assert.equal(e.total_matching,source.count);
  assert.equal(e.rows.length,0);
  assert.match(reply,new RegExp(escaped(source.outlet),'i'));
  assert.match(reply,new RegExp(`${number(source.count)}\\s+(?:current\\s+)?asset records?`,'i'));
 }),
 fg_rank:scenario('Factory',['read_factory_finished_goods'],'Which Factory finished goods have the three highest stock balances in kg? Include SKU and balance.',ranked('product_code')),
 rm_rank:scenario('Factory',['read_factory_raw_catalogue'],'Follow up to FG ranking: What about the three highest active raw materials, using the same kg unit? List SKU and balance.',ranked('material_code')),
 employees_rm:scenario('HR / Factory',['read_employee_directory','read_factory_raw_catalogue'],'What is the total authorized Employees headcount, and which three active Factory raw materials have the highest current stock balances in kg? Include SKU and balance for each raw material.',([employees,raw],reply,source)=>{
  assert.equal(employees.aggregate_complete,true);
  assert.equal(employees.summary.total,source.total);
  named(reply,'total(?: employees| headcount)?',source.total);
  ranked('material_code')([raw],reply,source.ranking);
 }),
 mixed_units:scenario('Factory',['read_factory_raw_catalogue'],'Which raw materials have the highest balances across all units?',([e],reply,source)=>{
  assert.equal(e.ranking?.status,'unit_required');
  assert.deepEqual(e.ranking.available_units,source.units);
  assert.equal(e.rows.length,0);
  assert.match(reply,/unit|单位/i);
  assert.match(reply,/which|choose|specify|选择/i);
 }),
 fg_page:scenario('Factory',['read_factory_finished_goods'],'Show page 2 of all those products with SKU and current balance. State how many products are on this page versus the complete total.',([e],reply,source)=>{
  assert.equal(e.page,2);assert.equal(e.total_matching,source.total);assert.equal(e.rows.length,source.returned);
  assert.match(reply,new RegExp(`page\\s+2[\\s\\S]{0,100}${number(source.returned)}\\s+products`,'i'));
  assert.match(reply,new RegExp(`total[^\\n]{0,70}${number(source.total)}`,'i'));
 }),
 employees_grouped:scenario('HR',['read_employee_directory'],'Give separate complete counts by employment status and employment type for my authorized Employees scope.',([e],reply,source)=>{
  assert.equal(e.requested_scope?.mode,'summary');assert.equal(e.requested_scope?.status,'all');
  assert.equal(e.aggregate_complete,true);assert.deepEqual(e.summary,source.summary);
  assert.deepEqual(e.employment_types,source.types);
  assert.match(reply,/employee status|employment status|员工状态|雇佣状态/i);
  assert.match(reply,/employment type|雇佣类型|雇用类型/i);
  for(const [pattern,value] of [
   ['active|在职',source.summary.active],['resigned|离职',source.summary.resigned],
   ['terminated|终止',source.summary.terminated],['other|其他',source.summary.other],
   ['full[- ]time|全职',source.types.full_time],['part[- ]time|兼职',source.types.part_time],
   ['probation|试用期',source.types.probation],['contract|合同工',source.types.contract],
  ])named(reply,pattern,value);
  assert.match(reply,new RegExp(`(?:总员工数|总人数|total)[^\\n]{0,25}${number(source.summary.total)}`,'i'));
 }),
 crew_count:scenario('Crew',['read_crew_leave'],'How many leave requests overlap [date range] for [authorized outlet]? Give the count without employee names or leave reasons.',([e],reply,source)=>{
  assert.deepEqual(e.requested_scope,source.scope);
  assert.equal(e.total_matching,source.total);
  assert.match(reply,new RegExp(`${number(source.total)}\\s+(?:overlapping\\s+)?(?:leave\\s+)?requests?`,'i'));
 }),
 restaurant_list:scenario('Restaurant',['read_sales_records'],'List the recorded Sales Input entries for [period and authorized outlet]. Say if this is a bounded page.',([e],reply,source)=>{
  assert.deepEqual(e.requested_scope,source.scope);
  assert.equal(e.completeness.aggregate_scope,'not_asserted');
  assert.deepEqual(e.rows.map(row=>[row.channel_name,row.amount]),source.rows);
  for(const [channel,amount] of source.rows)assert.match(reply,new RegExp(`${escaped(channel)}[^\\n]{0,36}${number(amount)}`,'i'));
  assert.match(reply,/page|returned|entries shown/i);
 }),
 sales_comparison:scenario('Restaurant',['read_sales_comparison'],'Compare [named month] sales at [authorized outlet] to the same month last year. Identify any missing period.',([e],reply,source)=>{
  assert.deepEqual(e.requested_scope,source.scope);
  const month=e.months.find(row=>row.month===source.month);
  assert.deepEqual(month.current,source.current);
  assert.deepEqual(month.previous_year,source.previous);
  assert.match(reply,/last year|previous year|prior year/i);
  if(!source.previous.values||!source.current.values)assert.match(reply,/missing|unavailable|no (?:recorded )?data/i);
  if(source.answerValue!=null)assert.match(reply,new RegExp(number(source.answerValue)));
 }),
 finance_partial:scenario('Finance',['read_operational_financials'],'What is the financial completeness for [authorized outlet and month]? Name every missing source/metric.',([e],reply,source)=>incompleteFinance(e,reply,source)),
 marketing_count:scenario('Marketing',['read_marketing_plan'],'How many creative tasks are in the [authorized brand and month] planning list?',([e],reply,source)=>{
  assert.deepEqual(e.requested_scope,source.scope);
  assert.equal(e.total_matching,source.total);
  assert.match(reply,new RegExp(`${number(source.total)}\\s+(?:creative\\s+|planning\\s+)?tasks?`,'i'));
 }),
 factory_finance:scenario('Factory / Finance',['read_factory_cleaning_methods','read_operational_financials'],'List the Factory cleaning-method reference names, then report [month] operational reporting completeness for authorized outlets.',([cleaning,finance],reply,source)=>{
  assert.deepEqual(cleaning.rows.map(row=>row.name),source.methodNames);
  for(const name of source.methodNames)assert.match(reply,new RegExp(escaped(name),'i'));
  assert.match(reply,/reference/i);
  incompleteFinance(finance,reply,source.finance);
 }),
};

export function certifyScenario(id,record){
 const definition=scenarios[id];
 if(!definition)throw Error('Unknown certification scenario');
 if(!record)return {status:'BLOCKED',reason:'No authenticated turn and independent source snapshot'};
 if(record.blocker)return {status:'BLOCKED',reason:record.blocker};
 try{
  const {turn,source}=record;
  assert(turn?.request_id&&turn.created_at&&turn.model,'Saved Text turn identity required');
  assert.equal(turn.state,'completed','Saved turn did not complete');
  assert.equal(turn.tool_state,'completed','Tool path did not complete with verified evidence');
  assert(!turn.voice_lease_id,'Text turn required');
  assert.equal(typeof turn.reply,'string');
  assert(turn.reply.trim(),'Final reply is missing');
  assert(source,'Independent source comparison required');
  const evidence=turn.evidence?.items||[turn.evidence];
  const selected=evidence.map(e=>e?.capability);
  assert.deepEqual([...selected].sort(),[...definition.operations].sort(),'Wrong, missing or duplicate tool evidence');
  definition.check(definition.operations.map(key=>evidence.find(item=>item.capability===key)),plain(turn.reply),source);
  return {status:'PASS',request_id:turn.request_id,at:turn.created_at,operations:definition.operations};
 }catch(error){return {status:'FAIL',reason:String(error.message).split('\n')[0],request_id:record.turn?.request_id};}
}

for(const [id,question] of [
 ['asset_spoon_fresh','What is the current balance of asset-spoon at Friends Corner?'],
 ['asset_spoon_voice_correction','In the existing conversation after a failed spoken outlet lookup: 你不懂Friends Corner的汤匙剩多少？'],
 ['asset_spoon_followup','After confirming Friends Corner, ask for the current Spoon balance at that outlet.'],
]){
 scenarios[id]=scenario('Restaurant',['read_asset_catalogue'],question,([e],reply,source)=>{
  assert.equal(e.query_outcome,'SUCCESS');
  scenarios.asset_spoon.check([e],reply,source);
 });
}
scenarios.asset_ambiguous=scenario('Restaurant',['read_asset_catalogue'],'How many Cup units are recorded at Friends Corner?',([e],reply,source)=>{
 assert.equal(e.outlet.id,source.outletId);
 assert.equal(e.query_outcome,'AMBIGUOUS');
 assert.equal(e.match_status,'ambiguous');
 assert.equal(e.rows.length,0);
 assert.match(reply,/confirm|clarif|exact|确认/i);
 assert.doesNotMatch(reply,/\d+\s*(?:units?|pcs|件)/iu);
});
scenarios.asset_no_match=scenario('Restaurant',['read_asset_catalogue'],'What is the balance of a nonexistent test asset in the authorized outlet?',([e],reply,source)=>{
 assert.equal(e.outlet.id,source.outletId);
 assert.equal(e.query_outcome,'NO_MATCH');
 assert.equal(e.match_status,'not_found');
 assert.equal(e.rows.length,0);
 assert.match(reply,/no matching|没有匹配/i);
 assert.doesNotMatch(reply,/\d+\s*(?:units?|pcs|件)/iu);
});
scenarios.employees_fg_scope=scenario('HR / Factory',['read_employee_directory','read_factory_finished_goods'],
 'How many authorized Employees are there, and what is the current Factory Finished Goods stock for SKU S01?',([employees,stock],reply,source)=>{
  assert.equal(employees.aggregate_complete,true);
  assert.equal(employees.summary.total,source.count);
  assert.equal(stock.rows.length,1);
  assert.equal(stock.rows[0].product_code,source.code);
  assert.equal(stock.rows[0].current_balance,source.quantity);
  assert.match(reply,new RegExp(number(source.count)));
  assert.match(reply,new RegExp(number(source.quantity)+'\\s*'+escaped(source.unit)+'\\b','iu'));
 });

export function certifyRun(records={}){
 for(const id of Object.keys(records))assert(Object.hasOwn(scenarios,id),`Unknown scenario: ${id}`);
 return Object.fromEntries(Object.keys(scenarios).map(id=>[id,certifyScenario(id,records[id])]));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const recordPath=process.argv[2];
 if(!recordPath)throw Error('Usage: node qa/staging/nativeAssistantCertification.mjs <reviewed-run.json> [--strict]');
 const results=certifyRun(JSON.parse(readFileSync(recordPath,'utf8')));
 console.log(JSON.stringify(results,null,2));
 if(Object.values(results).some(row=>row.status==='FAIL'||process.argv.includes('--strict')&&row.status==='BLOCKED'))process.exitCode=1;
}

export function assertScenarioContracts(){
 const registry=new Map(operations.map(operation=>[operation.id,operation]));
 const knowledgeCoverage=new Set();
 for(const [scenarioId,{operations:ids}] of Object.entries(scenarios)){
  for(const id of ids){
   const operation=assistantQuery(id);
   assert(operation.kind==='READ'||operation.kind==='GUIDANCE',id);
   if(scenarioId.startsWith('knowledge_')&&operation.knowledge)knowledgeCoverage.add(id);
  }
 }
 for(const operation of operations.filter(operation=>operation.knowledge))assert(knowledgeCoverage.has(operation.id),`Missing knowledge acceptance scenario for ${operation.id}`);
 const supported={
  read_asset_catalogue:['summary','count','detail','search','list'],
  read_factory_finished_goods:['rank','list'],
  read_factory_raw_catalogue:['rank','filter'],
  read_employee_directory:['summary','group'],
  read_crew_leave:['count'],
  read_sales_comparison:['period_comparison'],
  read_operational_financials:['summary'],
  read_marketing_plan:['count'],
 };
 for(const [id,dimensions] of Object.entries(supported))
  for(const dimension of dimensions)assert(registry.get(id).moduleInterface.query.dimensions.includes(dimension),`${id}: missing ${dimension}`);
 assert.equal(registry.get('read_sales_records').tool.parameters.properties.page.type,'number');
}
