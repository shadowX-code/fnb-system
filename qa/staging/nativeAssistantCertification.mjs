import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {assistantQuery,operations} from '../../supabase/functions/native-assistant/business.js';

const scenario=(domain,operations,question,check,medium='text')=>({domain,operations,question,check,medium});
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
  assert.equal(e.source,e.version>=3?'/restaurant/operations/asset-tracking':'/operations/asset-tracking');
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
  assert.match(reply,new RegExp(`page\\s+2[\\s\\S]{0,100}${number(source.returned)}\\s+(?:packaging SKUs?|products)`,'i'));
  assert.match(reply,new RegExp(`total[^\\n]{0,70}${number(source.total)}`,'i'));
  if(source.rows){
   assert.equal(e.aggregate_complete,true);
   assert.deepEqual([e.measure,e.status,e.query,e.uom,e.sku,e.availability],['sku','all','',null,null,'all']);
   assert.deepEqual(e.rows.map(row=>[row.product_code,row.current_balance,row.uom]),source.rows);
   for(const [sku,balance,uom] of source.rows)
    assert.match(reply,new RegExp(escaped(sku)+`[^\\n]{0,40}${number(balance)}\\s*${escaped(uom)}\\b`,'iu'));
  }
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
 if(record?.blocker)return {status:'BLOCKED',reason:record.blocker};
 if(!record?.turn)return {status:'BLOCKED',reason:'No authenticated turn and independent source snapshot'};
 try{
  const {turn,source}=record;
  assert(turn?.request_id&&turn.created_at&&turn.model,'Saved turn identity required');
  assert.equal(turn.state,'completed','Saved turn did not complete');
  assert.equal(turn.tool_state,'completed','Tool path did not complete with verified evidence');
  if(definition.medium==='voice')assert(turn.voice_lease_id&&turn.voice_input_available,'Saved Voice turn and transcript required');
  else assert(!turn.voice_lease_id,'Text turn required');
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
function checkAssetBalances([e],reply,source){
 assert.equal(e.outlet.id,source.outletId);
 assert.equal(e.query_outcome,'SUCCESS');
 assert.equal(e.aggregate_complete,true);
 assert.equal(e.total_matching,source.count);
 assert.deepEqual(e.rows.map(row=>[row.name,row.current_quantity,row.unit]),source.rows);
 assert.match(reply,new RegExp(escaped(source.outlet),'iu'));
 assert.match(reply,new RegExp(number(source.count),'u'));
 for(const [name,quantity,unit] of source.rows)
  assert.match(reply,new RegExp(escaped(name)+'[^\\n]{0,24}'+number(quantity)+'\\s*'+escaped(unit),'iu'));
 assert.doesNotMatch(reply,/outlet_id|read_asset_catalogue/iu);
}
function checkOutletInventory([e],reply,source){
 assert.equal(e.source,'/restaurant/inventory/master');
 assert.equal(e.query_outcome,'SUCCESS');
 assert.equal(e.aggregate_complete,true);
 assert.equal(e.requested_scope.status,source.status);
 assert.deepEqual(Object.fromEntries(e.by_outlet.map(row=>[row.outlet.id,row.total_matching])),source.counts);
 for(const [outlet,count] of Object.entries(source.namedCounts))named(reply,escaped(outlet),count);
 assert.doesNotMatch(reply,/outlet_id|read_inventory_items|asset tracking/iu);
}
for(const [language,question] of [
 ['zh','餐厅每个门店目前有多少种库存品项？'],
 ['ms','Berapa jenis item inventori restoran untuk setiap cawangan?'],
 ['en','How many Master Inventory item types are there at each outlet?'],
])scenarios['master_inventory_by_outlet_'+language]=scenario('Restaurant',['read_inventory_items'],question,checkOutletInventory);
scenarios.asset_outlet_correction=scenario('Restaurant',['read_asset_catalogue'],
 'After the outlet was misheard in a count-and-balance request, say its human-readable name again.',checkAssetBalances);
scenarios.asset_outlet_correction_voice=scenario('Restaurant',['read_asset_catalogue'],
 'Correct the misheard outlet name in a live call, then listen for its asset count and balances.',checkAssetBalances,'voice');

const concise=(reply,amount)=>{
 const lead=reply.split(/\n|[。!?]/u,1)[0].slice(0,160);
 assert.match(lead,new RegExp(number(amount),'u'),'Lead with the verified result');
 assert.doesNotMatch(reply,/\b(?:outlet_id|brand_id|read_[a-z_]+|arguments_json)\b/u);
};
const filteredCount=([e],reply,source)=>{
 assert.equal(e.query_outcome,'SUCCESS');
 assert.equal(e.aggregate_complete,true);
 assert.equal(e.total_matching,source.count);
 for(const [key,value] of Object.entries(source.filters))assert.deepEqual(e.requested_scope?.[key]??e[key],value);
 concise(reply,source.count);
};
scenarios.asset_catalogue_complete=scenario('Restaurant',['read_asset_catalogue'],
 'List the current assets and recorded quantities at one outlet.',(items,reply,source)=>{
  checkAssetBalances(items,reply,source);
  assert.equal(items[0].truncated,false);
 });
scenarios.asset_dated_history=scenario('Restaurant',['read_asset_catalogue'],
 'Show the recorded movements for a named asset at one outlet in the requested date range.',([e],reply,source)=>{
  assert.equal(e.outlet.id,source.outletId);
  assert.equal(e.asset.name,source.asset);
  assert.equal(e.asset.unit,source.unit);
  assert.equal(e.history_source,'asset_movement_logs');
  assert.equal(e.requested_scope.mode,'movements');
  assert.deepEqual([e.requested_scope.from,e.requested_scope.to],[source.from??null,source.to??null]);
  assert.equal(e.total_matching,source.count);
  assert.deepEqual(e.rows.map(row=>[row.movement_date,row.quantity_change,row.quantity_before,row.quantity_after]),source.rows);
  assert.match(reply,new RegExp(escaped(source.outlet),'iu'));
  for(const [date,change,before,after] of source.rows){
   assert.match(reply,new RegExp(escaped(date)+'[^\\n]{0,70}'+number(change),'iu'));
   assert.match(reply,new RegExp(number(before)+'[^\\n]{0,20}'+number(after),'iu'));
  }
 });
scenarios.operating_expense_recorded_year=scenario('Restaurant',['read_operating_expenses'],
 'What were the recorded operating expenses at the outlet for the specified year?',([e],reply,source)=>{
  assert.equal(e.outlet.id,source.outletId);
  assert.equal(e.year,source.year);
  assert.equal(e.currency,'MYR');
  assert.equal(e.total_amount,source.amount);
  assert.deepEqual(e.rows.map(row=>[row.month,row.amount]),source.months);
  assert.equal(e.period_complete,source.months.length===12);
  assert.equal(e.missing_months.length,12-source.months.length);
  assert.match(plain(reply),new RegExp('(?<![0-9.-])'+escaped(source.amount)+(Number.isInteger(source.amount)?'(?:[.]00)?':'')+'(?![0-9.])','u'));
  if(source.months.length<12)assert.match(reply,/recorded|已记录|已錄入|direkodkan/iu);
 });
scenarios.inventory_stock_position=scenario('Restaurant',['read_inventory_stock_evidence'],
 'What does the last verified stock count say for the named item and outlet?',([e],reply,source)=>{
  assert.equal(e.outlet.id,source.outletId);
  assert.equal(e.item.sku,source.sku);
  assert.equal(e.total_matching,1);
  const [row]=e.rows;
  assert.equal(row.state,source.state);
  assert.equal(row.check_date,source.checkDate);
  assert.equal(row.confirmed_count,source.confirmedCount);
  if(source.confirmedCount===null)assert.match(reply,/changed|unverified|unavailable|not confirm|未确认|未核实/iu);
  else assert.match(reply,new RegExp(number(source.confirmedCount),'u'));
 });
scenarios.movement_filtered_count=scenario('Restaurant',['read_inventory_movements'],'Count a recorded movement type at a named outlet during a specified period.',filteredCount);
scenarios.fg_filtered_count=scenario('Factory',['read_factory_finished_goods'],'Count packaging SKUs with a specified recorded status.',filteredCount);
scenarios.fg_product_count=scenario('Factory',['read_factory_finished_goods'],'Count Finished Goods in the grouped catalogue, treating packaging SKUs as variants.',filteredCount);
scenarios.department_count=scenario('HR',['read_departments'],'Count departments with a specified status.',filteredCount);
scenarios.position_department_count=scenario('HR',['read_job_positions'],'Count positions in a named department.',filteredCount);
scenarios.crew_status_count=scenario('Crew',['read_crew_leave'],'Count leave requests with the specified approval status that overlap the date range at this outlet.',filteredCount);
scenarios.planner_status_count=scenario('Marketing',['read_marketing_plan'],'Count recorded creative tasks at a named brand in a specified month and status.',filteredCount);
scenarios.finance_period_pair=scenario('Finance',['read_operational_financials'],'Compare recorded revenue in two months at one outlet.',([e],reply,source)=>{
 assert.deepEqual(e.requested_scope?.outlet_id,source.outletId);
 assert.equal(e.query_outcome,'SUCCESS');
 const reports=[e.report,e.comparison_report];
 for(const [i,expected] of source.periods.entries()){
  const actual=reports[i];
  assert.equal(actual.outlet.id,source.outletId);
  assert.deepEqual(actual.period,{year:expected.year,month:expected.month});
  assert.deepEqual(actual.financials.revenue,expected.revenue);
  if(expected.revenue.amount==null)assert.match(reply,/unavailable|missing|未记录|tiada data/iu);
  else assert.match(reply,new RegExp(number(expected.revenue.amount),'u'));
 }
 assert.doesNotMatch(reply,/outlet_id|read_operational_financials/u);
});

function checkMovementHistory([e], reply, source) {
 const restaurant=e.capability==='read_inventory_movements';
 assert.equal(e.query_outcome,'SUCCESS');
 assert.equal(e.requested_scope.from,source.from);
 assert.equal(e.requested_scope.to,source.to);
 if(restaurant)assert.equal(e.requested_scope.outlet_id,source.outletId);
 else assert.equal(e.requested_scope.sku,source.sku);
 assert.equal(e.total_matching,source.count);
 assert.equal(e.aggregate_complete,true);
 assert.equal(e.page,source.page??1);
 assert.equal(e.truncated,e.page*20<source.count);
 const entries=e.rows.map(row=>({id:row.id,sku:restaurant?row.sku:row.item_code,date:(restaurant?row.created_at:row.movement_date).slice(0,10),
  quantity:row.quantity,unit:restaurant?row.unit:row.quantity_unit}));
 assert.deepEqual(entries,source.records);
 assert.match(reply,new RegExp(escaped(source.sku),'iu'));
 if(source.count)assert.match(reply,new RegExp(number(entries[0].quantity)+'\\s*'+escaped(entries[0].unit),'iu'));
 assert.match(reply,new RegExp(number(source.count),'u'));
}
for(const [id,label] of [['read_factory_product_movements','finished product'],['read_factory_raw_movements','raw material']]){
 scenarios[id+'_history']=scenario('Factory',[id],'How many stock movements were posted for this '+label+' SKU in the selected dates, and what was its most recent signed movement and unit?',checkMovementHistory);
}
const directoryCases={
 read_outlet_directory:['Restaurant','outlets'],
 read_sales_channels:['Restaurant','sales channels'],
 read_purchase_categories:['Restaurant','purchase categories'],
 read_supplier_directory:['Restaurant','Restaurant suppliers'],
 read_factory_equipment:['Factory','Factory equipment records'],
};
for(const [id,[domain,label]] of Object.entries(directoryCases)){
 scenarios[id+'_count']=scenario(domain,[id],'How many '+label+' are recorded in my authorized scope?',([e],reply,source)=>{
  assert.deepEqual(e.requested_scope,source.scope);
  assert.equal(e.requested_scope.mode,'summary');
  assert.equal(e.aggregate_complete,true);
  assert.equal(e.total_matching,source.count);
  assert.match(reply,new RegExp(number(source.count),'u'));
  assert.match(reply,new RegExp(escaped(label.replace(/^(?:Restaurant|Factory) /,'').replace(/ records$/,'')),'iu'));
 });
}
scenarios.purchase_input_rank=scenario('Restaurant',['read_purchase_records'],
 'What is the largest individual purchase entry at this outlet for this month? Give its amount, recorded supplier and category, and the number of entered purchase rows.',([e],reply,source)=>{
  assert.deepEqual(e.requested_scope,source.scope);
  assert.equal(e.requested_scope.sort,'amount_desc');
  assert.equal(e.requested_scope.page,1);
  assert.equal(e.aggregate_complete,true);
  assert.equal(e.total_matching,source.count);
  const [first]=e.rows;
  assert.deepEqual([first.id,Number(first.amount),first.supplier_name,first.category_name],source.largest);
  assert.match(reply,new RegExp(number(source.largest[1]),'u'));
  assert.match(reply,new RegExp(number(source.count)+'\\s+(?:(?:recorded|purchase|matching)\\s+)*(?:entries|rows|records)','iu'));
  for(const label of source.largest.slice(2).filter(Boolean))assert.match(reply,new RegExp(escaped(label),'iu'));
 });
scenarios.inventory_movement_item_history=scenario('Restaurant',['read_inventory_movements'],
 'How many ingredient movements occurred at this outlet during the specified period? Identify the most recent item by SKU, movement quantity and unit.',checkMovementHistory);
scenarios.finance_performance_change=scenario('Finance',['read_operational_financials'],
 'How did this outlet perform compared with its earlier month? Separate observed cost changes from any suggested investigation.',([e],reply,source)=>{
 assert.equal(e.report.outlet.id,source.outletId);
 assert.deepEqual(e.analysis.current_period,source.current);
 assert.deepEqual(e.analysis.comparison_period,source.previous);
 for(const [field,expected] of Object.entries(source.analysis))assert.deepEqual(e.analysis[field],expected);
 for(const amount of [source.analysis.purchase_based_cogs_change_myr,source.analysis.recorded_opex_change_myr]){
  if(amount!==null)assert.match(reply,new RegExp(number(Math.abs(amount)),'u'));
 }
 if(source.analysis.ebitda_contributions_myr===null)assert.match(reply,/missing|unavailable|incomplete|cannot|insufficient/iu);
});

// Templates consume independently read, scoped records. Neither a generated
// prompt nor a source snapshot alone qualifies as a live certification.
scenarios.outlet_expense_and_assets=scenario('Restaurant',['read_operating_expenses','read_asset_catalogue'],
 'Give recorded annual operating expenses and the current asset count for one outlet. Recommend one check before interpreting the cost.',
 ([expense,assets],reply,source)=>{
  assert.equal(expense.outlet.id,source.outletId);
  assert.equal(assets.outlet.id,source.outletId);
  assert.equal(expense.query_outcome,'SUCCESS');
  assert.equal(assets.query_outcome,'SUCCESS');
  assert.equal(expense.year,source.year);
  assert.equal(expense.requested_scope.month,null);
  assert.equal(expense.currency,'MYR');
  assert.deepEqual(expense.rows.map(row=>[row.month,Number(row.amount)]),source.months);
  assert.equal(expense.total_amount,source.amount);
  assert.equal(expense.period_complete,source.months.length===12);
  assert.equal(assets.aggregate_complete,true);
  assert.equal(assets.total_matching,source.assets);
  assert.match(reply,new RegExp(escaped(source.code),'iu'));
  assert.match(reply,new RegExp('(?:RM|MYR)\\s*'+escaped(source.amount)+'(?:\\.00)?(?![0-9])','iu'));
  const assetCount=number(source.assets);
  assert.match(reply,new RegExp('(?:'+assetCount+'\\s+(?:current\\s+)?asset(?:s| records?)?\\b|asset(?:s| count| records?)\\s*(?:is|are|:|=|—)?\\s*'+assetCount+')','iu'));
  if(source.months.length<12) {
   assert.match(reply,/recorded|missing|only|partial|incomplete/iu);
   assert.match(reply,/check|confirm|review|verify|reconcile|ensure/iu);
   assert.match(reply,/month|entr(?:y|ies)|input|period/iu);
  }
  assert.doesNotMatch(reply,/outlet_id|read_asset_catalogue|read_operating_expenses/iu);
 });

export function generateSourceCases(snapshot){
 const cases=[];
 const add=(id,question,source,after)=>cases.push({id,question,source,...after?{after}:{}});
 for(const row of snapshot.outletOperations||[])add('outlet_expense_and_assets',
  'Give '+row.code+' recorded '+row.year+' operating expenses and '+row.code+
  ' current asset count, and recommend one next check for interpreting cost.',row);
 for(const {outlet,outletId,name,code,quantity,unit,outletAssetCount} of snapshot.assets||[]){
  const asset={outlet,outletId,name,code,quantity,unit};
  const item=name;
  for(const question of ['What is the current balance of asset '+item+' at '+outlet+'?',
   outlet+' 的资产 '+item+' 目前还剩多少？','Berapa baki aset '+item+' di '+outlet+' sekarang?'])
   add('asset_spoon',question,asset);
  if(Number.isSafeInteger(outletAssetCount))add('asset_count','How many current asset records are there at that outlet?',
   {outlet,outletId,count:outletAssetCount},cases.length-1);
 }
 for(const row of snapshot.assetCatalogues||[])
  if(row.count<=20)add('asset_catalogue_complete','List all current assets and their balances at '+row.outlet+'.',row);
 for(const row of snapshot.assetHistory||[]){
  const period=row.from&&row.to?' from '+row.from+' to '+row.to:'';
  add('asset_dated_history','Show '+row.asset+' asset movement history at '+row.outlet+period+'.',row);
 }
 for(const row of snapshot.directoryCounts||[]){
  const declaration=directoryCases[row.operation];
  assert(declaration,'Unsupported directory scenario');
  const status=row.scope.status&&row.scope.status!=='all'?row.scope.status+' ':'';
  add(row.operation+'_count','How many '+status+declaration[1]+' are recorded in my authorized scope?',row);
 }
 for(const row of snapshot.purchaseRanks||[])add('purchase_input_rank',
  'How many purchase entries did '+row.outlet+' record for '+row.scope.month.slice(0,7)+' and what was the largest entry? Give its amount, recorded supplier and category.',row);
 for(const row of snapshot.operatingExpenses||[])add('operating_expense_recorded_year',
  'What are the '+row.year+' operating expenses at '+row.outlet+'?',row);
 for(const row of snapshot.stockPositions||[])add('inventory_stock_position',
  'What is the verified physical stock for '+row.sku+' at the Restaurant outlet '+row.outlet+'?',row);
 if(snapshot.inventory?.length>=2){
  const selected=snapshot.inventory.slice(0,12);
  const names=selected.map(row=>row.outlet).join(', ');
  const source={status:'active',counts:Object.fromEntries(selected.map(row=>[row.outletId,row.count])),
   namedCounts:Object.fromEntries(selected.map(row=>[row.outlet,row.count]))};
  for(const [language,question] of [
   ['en','Give the number of active Master Inventory item types at each of these outlets: '+names+'.'],
   ['ms','Berapa jenis item inventori restoran aktif di setiap cawangan ini: '+names+'?'],
   ['zh','请分别列出这些门店启用的库存品项种类：'+names+'，每家有多少种？'],
  ])add('master_inventory_by_outlet_'+language,question,source);
 }
 for(const row of snapshot.warehouseMovementHistory||[]){
  const kind=row.ledger;
  if(!['finished product','raw material'].includes(kind))throw Error('Unknown Factory movement source');
  add((kind==='finished product'?'read_factory_product_movements':'read_factory_raw_movements')+'_history',
   'For '+kind+' SKU '+row.sku+' in Factory, how many stock movements were posted from '+row.from+' to '+row.to+'? Give the latest signed quantity and unit.',row);
 }
 for(const row of snapshot.inventoryMovementHistory||[])add('inventory_movement_item_history',
  'How many ingredient movements occurred at '+row.outlet+' from '+row.from+' to '+row.to+'? Give the latest item SKU, signed quantity and unit.',row);
 for(const row of snapshot.financePerformance||[])add('finance_performance_change',
  'At '+row.outlet+', how did purchase costs and recorded operating expenses change in '+row.current.year+'-'+row.current.month+
  ' versus '+row.previous.year+'-'+row.previous.month+'? What should we look into?',row);
 for(const row of snapshot.movements||[])add('movement_filtered_count',
  'How many '+row.filters.movement_type+' inventory movement records were posted at '+row.outlet+' from '+row.filters.from+' to '+row.filters.to+'?',row);
 for(const row of snapshot.finishedGoods||[])add('fg_filtered_count','How many '+row.filters.status+' Factory Finished Goods packaging SKUs are registered?',row);
 for(const row of snapshot.productGroups||[])add('fg_product_count','How many products are in the Factory Finished Goods grouped catalogue?',row);
 for(const row of snapshot.departments||[])add('department_count','How many '+row.filters.status+' HR departments are registered?',row);
 for(const row of snapshot.positions||[])add('position_department_count','How many HR job positions are registered in '+row.filters.department+'?',row);
 for(const row of snapshot.leave||[])add('crew_status_count','How many '+row.filters.status+' Crew leave requests overlap '+row.filters.from+' to '+row.filters.to+' at '+row.outlet+'?',row);
 for(const row of snapshot.plans||[])add('planner_status_count','How many '+row.filters.status.replaceAll('_',' ')+' creative tasks are in the '+row.brand+' plan for '+row.filters.month.slice(0,7)+'?',row);
 for(const row of snapshot.finance||[])add('finance_period_pair','Compare the operational revenue for '+row.outlet+' in '+row.periods.map(p=>p.year+'-'+String(p.month).padStart(2,'0')).join(' and ')+'.',row);
 return cases;
}

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

export function certifyGeneratedRun(records){
 const outcomes=[];
 for(const row of records){
  const result=certifyScenario(row.id,row);
  if(row.after!==undefined&&result.status==='PASS'){
   const previous=records[row.after]?.turn;
   if(row.after<0||row.after>=outcomes.length||outcomes[row.after].status!=='PASS'||
    !previous?.session_id||previous.session_id!==row.turn.session_id||
    Date.parse(previous.created_at)>=Date.parse(row.turn.created_at))
    outcomes.push({status:'FAIL',reason:'Follow-up needs the passing preceding turn in the same conversation'});
   else outcomes.push(result);
  }else outcomes.push(result);
 }
 return outcomes;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [mode,recordPath]=process.argv.slice(2);
 if(!mode)throw Error('Usage: node qa/staging/nativeAssistantCertification.mjs <reviewed-run.json> [--strict], or --generate <source.json>, or --generated-run <run.json>');
 if(mode==='--generate'){
  console.log(JSON.stringify(generateSourceCases(JSON.parse(readFileSync(recordPath,'utf8'))),null,2));
 }else{
  const input=JSON.parse(readFileSync(mode==='--generated-run'?recordPath:mode,'utf8'));
  const results=mode==='--generated-run'?certifyGeneratedRun(input):certifyRun(input);
  console.log(JSON.stringify(results,null,2));
  if(Object.values(results).some(row=>row.status==='FAIL'||process.argv.includes('--strict')&&row.status==='BLOCKED'))process.exitCode=1;
 }
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
  read_asset_catalogue:['summary','count','detail','search','list','movement_history'],
  read_operating_expenses:['summary','list','detail','filter'],
  read_inventory_items:['summary','count','list','group'],
  read_inventory_movements:['summary','count','list','filter'],
  read_factory_product_movements:['count','list','filter','movement_history'],
  read_factory_raw_movements:['count','list','filter','movement_history'],
  read_departments:['summary','count','list','filter'],
  read_job_positions:['summary','count','list','filter'],
  read_factory_finished_goods:['rank','list'],
  read_factory_raw_catalogue:['rank','filter'],
  read_employee_directory:['summary','group'],
  read_crew_leave:['count'],
  read_sales_comparison:['period_comparison'],
  read_operational_financials:['summary','period_comparison'],
  read_marketing_plan:['count'],
 };
 for(const [id,dimensions] of Object.entries(supported))
  for(const dimension of dimensions)assert(registry.get(id).moduleInterface.query.dimensions.includes(dimension),`${id}: missing ${dimension}`);
 assert.equal(registry.get('read_sales_records').tool.parameters.properties.page.type,'number');
}
