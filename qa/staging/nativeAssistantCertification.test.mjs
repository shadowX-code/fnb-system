import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertScenarioContracts,certifyRun,certifyScenario,generateSourceCases,certifyGeneratedRun} from './nativeAssistantCertification.mjs';
import {moduleCoverage} from '../../scripts/assistantBusinessMatrix.mjs';

test('certification scenarios stay bound to implemented READ contracts',()=>assertScenarioContracts());

test('every canonical module has reviewed coverage and only registered operations',()=>{
 const modules=moduleCoverage();
 assert.equal(modules.find(row=>row.module.id==='space_station').coverage,'not_applicable');
 assert.equal(modules.find(row=>row.module.id==='asset_tracking').direct[0].id,'read_asset_catalogue');
 for(const {coverage,direct,shared} of modules){
  assert.equal(coverage==='partial',direct.length>0);
  if(coverage==='shared')assert(shared.length>0);
 }
});

const rank={
 turn:{request_id:'fixture',created_at:'2026-11-17T00:00:00Z',model:'fixture',state:'completed',tool_state:'completed',
  reply:'1. SKU: A-1 at 61 kg\n2. SKU: A-2 at 42 kg\n3. SKU: A-3 at 11 kg',
  evidence:{capability:'read_factory_finished_goods',ranking:{status:'ranked',unit:'kg',order:'balance_desc',ranked_count:6},
   rows:[{product_code:'A-1',current_balance:61},{product_code:'A-2',current_balance:42},{product_code:'A-3',current_balance:11}]}},
 source:{unit:'kg',order:'balance_desc',count:6,top:[['A-1',61],['A-2',42],['A-3',11]]},
};
test('a saved rank answer must pair exact SKUs, amounts, units and ordering',()=>{
 assert.equal(certifyScenario('fg_rank',rank).status,'PASS');
 for(const reply of [
  'A-1 at 611 kg, A-2 at 42 kg and A-3 at 11 kg',
  'A-1 at 61 packs, A-2 at 42 kg and A-3 at 11 kg',
  'A-2 at 42 kg, A-1 at 61 kg and A-3 at 11 kg',
  'Ranked six results from source.',
 ])assert.equal(certifyScenario('fg_rank',{...rank,turn:{...rank.turn,reply}}).status,'FAIL');
 assert.equal(certifyScenario('rm_rank',rank).status,'FAIL');
});

test('unknown data and policy blocks cannot become passing scenario evidence',()=>{
 assert.equal(certifyRun({}).finance_partial.status,'BLOCKED');
 assert.deepEqual(certifyScenario('restaurant_list',{blocker:'AI access disabled'}),{status:'BLOCKED',reason:'AI access disabled'});
 assert.equal(certifyScenario('fg_rank',{...rank,source:null}).status,'FAIL');
 assert.equal(certifyScenario('fg_rank',{...rank,turn:{...rank.turn,voice_lease_id:'fixture'}}).status,'FAIL');
});

test('asset answer must match the authorized outlet and saved canonical quantity',()=>{
 const source={outletId:'outlet-1',outlet:'Fixture Corner',code:null,name:'Spoon',quantity:72,unit:'unit'};
 const evidence={capability:'read_asset_catalogue',source:'/operations/asset-tracking',requested_scope:{mode:'detail'},
  outlet:{id:source.outletId},match_status:'matched',rows:[{outlet_id:source.outletId,name:'Spoon',asset_code:null,current_quantity:72,unit:'unit'}]};
 const turn={...rank.turn,evidence,reply:'Fixture Corner has 72 kilograms of Spoon.'};
 assert.equal(certifyScenario('asset_spoon',{turn,source}).status,'FAIL');
 assert.equal(certifyScenario('asset_spoon',{turn:{...turn,reply:'Fixture Corner has 72 units of Spoon.'},source}).status,'PASS');
 assert.equal(certifyScenario('asset_spoon',{turn:{...turn,reply:'The current balance of spoons at Fixture Corner is 72 units.'},source}).status,'PASS');
 assert.equal(certifyScenario('asset_spoon',{turn:{...turn,reply:'Fixture Corner has 72 units of Spoon, asset code: asset-spoon.'},source}).status,'FAIL');
 assert.equal(certifyScenario('asset_spoon',{turn:{...turn,reply:'Other Corner has 72 units of Spoon.'},source}).status,'FAIL');
});

test('source-derived cases carry independent expected scope and require the same thread for follow-ups',()=>{
 const source={outletId:'outlet-1',outlet:'Fixture Corner',name:'Fork',code:null,quantity:4,unit:'unit',outletAssetCount:9};
 const cases=generateSourceCases({assets:[source],inventory:[
  {outletId:'outlet-1',outlet:'Fixture Corner',count:9},{outletId:'outlet-2',outlet:'Other Corner',count:3},
 ]});
 assert.equal(cases.length,7);
 assert.equal(cases[3].after,2);
 assert.deepEqual(cases.at(-1).source.counts,{'outlet-1':9,'outlet-2':3});
 assert.match(cases.at(-1).question,/Fixture Corner, Other Corner/);
 const asset={...rank.turn,session_id:'same',reply:'Fixture Corner has 4 units of Fork.',
  evidence:{capability:'read_asset_catalogue',source:'/operations/asset-tracking',requested_scope:{mode:'detail'},
   outlet:{id:source.outletId},match_status:'matched',rows:[{outlet_id:source.outletId,name:'Fork',asset_code:null,current_quantity:4,unit:'unit'}]}};
 const follow={...rank.turn,session_id:'different',created_at:'2026-11-17T00:01:00Z',reply:'Fixture Corner has 9 current asset records.',
  evidence:{capability:'read_asset_catalogue',outlet:{id:source.outletId},requested_scope:{mode:'summary'},aggregate_complete:true,total_matching:9,rows:[]}};
 cases[2].turn=asset;
 cases[3].turn=follow;
 assert.equal(certifyGeneratedRun(cases)[3].status,'FAIL');
 follow.session_id='same';
 assert.equal(certifyGeneratedRun(cases)[3].status,'PASS');
 assert.equal(certifyGeneratedRun(cases)[0].status,'BLOCKED');
});

test('operational answer certification binds independent scoped values and labels to a saved turn',()=>{
 const id='read_factory_job_summary';
 const turn={id:'turn',session_id:'session',request_id:'request',actor_ref:'fixture-owner',created_at:'2026-11-23T00:15:00Z',
  model:'fixture',state:'completed',tool_state:'completed',reply:'Draft: 2. Released: 9.',
  evidence:{capability:id,source:'/factory',as_of:'2026-11-23T00:15:00Z',query_outcome:'SUCCESS',requested_scope:{},summary:{draft:2,released:9}}};
 const source={operation:id,scope:{},scope_label:'For the allowed Factory',capture:{environment:'staging',method:'domain_service',
  module_id:'factory_job_order_records',authority:'factory_listing_summary',actor_ref:'fixture-owner',at:'2026-11-23T00:14:00Z'},
  records:[{summary:{draft:2,released:9}}]};
 const check=(t,s)=>certifyScenario(id+'_owner_answer',{turn:t,source:s}).status;
 assert.equal(check(turn,source),'PASS');
 assert.equal(check({...turn,reply:'Draft: 9. Released: 2.'},source),'FAIL');
 assert.equal(check({...turn,reply:'Draft: 2. Released: 9. Draft: 4.'},source),'FAIL');
 assert.equal(check(turn,{...source,records:[{summary:{draft:4,released:9}}]}),'FAIL');
 assert.equal(check(turn,{...source,scope:{outlet_id:'foreign'}}),'FAIL');
 assert.equal(check(turn,{...source,capture:{...source.capture,actor_ref:'another-owner'}}),'FAIL');
 assert.equal(check(turn,{...source,capture:null}),'BLOCKED');
 assert.equal(check({...turn,evidence:{...turn.evidence,source:'/finance/overview'}},source),'FAIL');
 assert.equal(check({...turn,evidence:{...turn.evidence,query_outcome:'UNAUTHORIZED'}},source),'FAIL');
 const [example]=generateSourceCases({operationalAnswers:[source]});
 assert.equal(example.id,id+'_owner_answer');assert.match(example.question,/allowed Factory.*job orders/i);
 assert.throws(()=>generateSourceCases({operationalAnswers:[{...source,scope_label:'Outlet 10000000-0000-4000-8000-000000000001'}]}));
 const {evidence,...clean}=turn;
 const denied={...clean,reply:'Your current permissions do not allow this read.',tool_state:'failed'};
 const traced={turn:denied,source:{...source,expectation:'denied'},trace:[{session_id:'session',turn_id:'turn',operation:id,outcome:'business_read_denied'}]};
 assert.equal(certifyScenario(example.id,traced).status,'PASS');
 assert.equal(certifyScenario(example.id,{...traced,trace:[]}).status,'FAIL');
 assert.equal(certifyScenario(example.id,{...traced,turn:{...denied,evidence}}).status,'FAIL');
 assert.equal(certifyScenario(example.id,{...traced,turn:{...denied,reply:'No records. It looks like you have no access.'}}).status,'FAIL');
});

test('operational rows require the correct identity, page boundary, final quantity and recorded unit',()=>{
 const id='read_inventory_waste', records=[{id:'a',waste_date:'2026-11-12',waste_type:'expired',quantity:7,unit:'kg'}];
 const source={operation:id,scope:{outlet_id:'x',page:1},scope_label:'For Test Kitchen',has_more:true,
  capture:{environment:'staging',method:'admin_view',module_id:'inventory_waste',authority:'/restaurant/inventory/waste',
   actor_ref:'tester',at:'2026-11-23T00:14:00Z'},records};
 const evidence={capability:id,source:'/restaurant/inventory/waste',requested_scope:source.scope,as_of:source.capture.at,query_outcome:'SUCCESS',truncated:true,rows:records};
 const turn={request_id:'fixture',created_at:source.capture.at,model:'fixture',state:'completed',tool_state:'completed',actor_ref:'tester',evidence,
  reply:'2026-11-12, expired. Quantity: 7 kg.'};
 const check=(t,s=source)=>certifyScenario(id+'_owner_answer',{turn:t,source:s}).status;
 assert.equal(check(turn),'PASS');
 assert.equal(check({...turn,reply:'2026-11-12, expired. Quantity: 7 units.'}),'FAIL');
 assert.equal(check({...turn,reply:turn.reply+' All records are shown.'}),'FAIL');
 assert.equal(check(turn,{...source,records:[{...records[0],id:'another'}]}),'FAIL');
 assert.equal(check(turn,{...source,records:[{...records[0],quantity:6}]}),'FAIL');
 assert.equal(check(turn,{...source,has_more:false}),'FAIL');
 assert.equal(check({...turn,evidence:{...evidence,rows:[{...records[0],passcode:'fixture'}]}}),'FAIL');
 const empty={...source,records:[],has_more:false,expectation:'empty_page'};
 const emptyTurn={...turn,reply:'No entries were returned on this page.',evidence:{...evidence,rows:[],truncated:false}};
 assert.equal(check(emptyTurn,empty),'PASS');
 assert.equal(check({...emptyTurn,reply:'No matching records means zero stock.'},empty),'FAIL');
});

function measuredTurn({id,module,route,rpc,scope,source,reply,evidence,scopeLabel}){
 const at='2026-11-23T00:15:00Z',actor_ref='fixture-owner';
 const turn={request_id:'fixture',actor_ref,model:'fixture',state:'completed',tool_state:'completed',created_at:at,reply,
  evidence:{capability:id,source:route,as_of:at,query_outcome:'SUCCESS',requested_scope:scope,...evidence}};
 return {turn,source:{scope,scope_label:scopeLabel,capture:{environment:'staging',method:rpc?'domain_service':'admin_view',module_id:module,authority:rpc||route,actor_ref,at},...source}};
}

test('stock check asks for source publication and revision without disclosing a monetary valuation',()=>{
 const id='stock_closing_publication';
 const scope={outlet_id:'fixture',page:1,month:'2026-11-01',mode:'closing'};
 const publication={revision:2,source_audit_id:'audit-fixture',actual_count_date:'2026-11-20',approved_at:'2026-11-21T00:00:00Z',
  valuation_status:'partial',valued_item_count:5,total_item_count:8};
 const record=measuredTurn({id:'read_inventory_checks',module:'inventory_stock_check',route:'/restaurant/inventory/stock-check',scope,
  source:{state:'published',publication},reply:'Published revision 2. Actual count date: 2026-11-20.',evidence:{publication_state:'published',publication}});
 const check=(s,t)=>certifyScenario(id,{source:s,turn:t}).status;
 assert.equal(check(record.source,record.turn),'PASS');
 assert.equal(check(record.source,{...record.turn,reply:'Published revision 1. Actual count date: 2026-11-20.'}),'FAIL');
 assert.equal(check(record.source,{...record.turn,reply:record.turn.reply+' Worth RM170.'}),'FAIL');
 assert.equal(check({...record.source,publication:{...publication,source_audit_id:'another'}},record.turn),'FAIL');
 for(const [state,reply] of [['no_submitted_audit','No submitted closing audit for this month.'],['submitted_unpublished','Submitted but not yet published.']]){
  const missing={...record.source,state,publication:null};
  const turn={...record.turn,reply,evidence:{...record.turn.evidence,publication_state:state,publication:null}};
  assert.equal(check(missing,turn),'PASS');
  assert.equal(check(missing,{...turn,reply:'The closing stock was RM0.'}),'FAIL');
 }
});

test('reporting closing valuation distinguishes unavailable, partial and a real published zero',()=>{
 const id='finance_closing_valuation';
 const outlet={id:'fixture',name:'Example outlet'},period={year:2026,month:11};
 const scope={outlet_id:outlet.id,...period,measure:'closing_stock',compare_year:null,compare_month:null};
 for(const [valuation,reply] of [[null,'Published closing valuation unavailable.'],
  [{amount:0,valuation_status:'complete',valued_item_count:4,total_item_count:4},'Complete closing valuation: RM0.00, 4/4 items valued.'],
  [{amount:91.43,valuation_status:'partial',valued_item_count:2,total_item_count:5},'Partial closing valuation: RM91.43; 2 of 5 items valued.']]){
  const record=measuredTurn({id:'read_operational_financials',module:'finance_overview',route:'/finance/overview',rpc:'reporting_monthly_scope_financials',
   scope,source:{outlet,period,closing_stock_evidence:valuation},reply,evidence:{closing_stock:{outlet,period,currency:'MYR',status:valuation?.valuation_status||'unavailable',
    amount:valuation?.amount??null,valued_items:valuation?.valued_item_count??null,total_items:valuation?.total_item_count??null,actual_count_date:null}}});
  assert.equal(certifyScenario(id,record).status,'PASS');
  assert.equal(certifyScenario(id,{...record,turn:{...record.turn,reply:reply+' Closing balance RM821.13.'}}).status,'FAIL');
  assert.equal(certifyScenario(id,{...record,source:{...record.source,capture:null}}).status,'BLOCKED');
  if(valuation?.valuation_status==='partial')assert.equal(certifyScenario(id,{...record,turn:{...record.turn,reply:reply.replace('Partial','Complete')}}).status,'FAIL');
 }
});

test('filtered counts distinguish members and enrollments and whole-brand consent from a filtered cohort',()=>{
 const scope={outlet_id:'fixture',mode:'summary',page:1,status:null,name:null};
 const record=measuredTurn({id:'read_crew_onboarding_progress',module:'crew_learning',route:'/crew/learning',rpc:'crew_admin_onboarding_progress_snapshot',scope,
  scopeLabel:'For Example Outlet this month',source:{count:13},reply:'13 Crew members, including those without an enrollment.',evidence:{rows:[],aggregate_complete:true,total_matching:13}});
 const id='read_crew_onboarding_progress_filtered_register_count';
 const [generated]=generateSourceCases({registerAnswers:[{...record.source,scenario:id}]});
 assert.match(generated.question,/including those without an enrollment/);
 assert.equal(certifyScenario(id,record).status,'PASS');
 assert.equal(certifyScenario(id,{...record,turn:{...record.turn,reply:'There were 13 enrollments.'}}).status,'FAIL');
 const customerScope={organization_id:'org',brand_id:'brand',page:1,status:'active',consent:'all'};
 const customer=measuredTurn({id:'read_brand_customer_directory',module:'platform_customers',route:'/marketing/customers',rpc:'marketing_customers_read',
  scope:customerScope,source:{filtered_total:3,brand_subscribed:31},reply:'3 matching customers. Across this brand there are 31 subscribed.',
  evidence:{total_matching:3,aggregate_complete:true,summary:{subscribed:31},summary_scope:'Entire authorized brand, before status and consent filters.'}});
 assert.equal(certifyScenario('customer_filtered_and_brand_totals',customer).status,'PASS');
 assert.equal(certifyScenario('customer_filtered_and_brand_totals',{...customer,turn:{...customer.turn,reply:'31 matching customers. Across this brand there are 3 subscribed.'}}).status,'FAIL');
});

test('expense and asset advice checks missing monthly entries without inventing a category or a transaction drilldown',()=>{
 const expense={capability:'read_operating_expenses',outlet:{id:'example'},query_outcome:'SUCCESS',year:2026,requested_scope:{month:null},currency:'MYR',
  rows:[{month:1,amount:10000}],total_amount:10000,period_complete:false};
 const assets={capability:'read_asset_catalogue',outlet:expense.outlet,query_outcome:'SUCCESS',aggregate_complete:true,total_matching:5};
 const source={outletId:'example',code:'Example Outlet',year:2026,months:[[1,10000]],amount:10000,assets:5};
 const turn={...rank.turn,evidence:{items:[expense,assets]}};
 const check=end=>certifyScenario('outlet_expense_and_assets',{turn:{...turn,reply:'Example Outlet recorded RM10000 in operating expenses (1 of 12 months) and has 5 current assets. '+end},source}).status;
 assert.equal(check('Check the missing monthly entries before interpreting this amount. Category detail is unavailable.'),'PASS');
 assert.equal(check('Check the 9 past months without entries before comparing costs. This source records monthly totals only.'),'PASS');
 assert.equal(check('Check the missing monthly entries. Investigate rent and utilities to explain high costs.'),'FAIL');
 assert.equal(check('Review the transactions and receipts.'),'FAIL');
});

test('workflow counts at the owner ceiling require a lower bound and receiving quantity is never a single-unit weight',()=>{
 const record=measuredTurn({id:'read_marketing_workflows',module:'marketing_whatsapp_workflows',route:'/marketing/whatsapp-workflows',rpc:'marketing_whatsapp_workflows',
  scope:{organization_id:'fixture',brand_id:'fixture',page:1},source:{visible:100},reply:'At least 100 workflow definitions are visible.',
  evidence:{total_lower_bound:100,aggregate_complete:false,total_matching:null}});
 assert.equal(certifyScenario('workflow_source_ceiling',record).status,'PASS');
 assert.equal(certifyScenario('workflow_source_ceiling',{...record,turn:{...record.turn,reply:'Exactly 100 workflow definitions.'}}).status,'FAIL');
 const receipts=measuredTurn({id:'read_factory_receiving_summary',module:'factory_raw_receiving',route:'/factory',rpc:'factory_listing_summary',
  scope:{from:'2026-10-01',to:'2026-10-14',supplier_name:'Example'},source:{documents:2,lines:3,source_quantity:105},
  reply:'2 receipt documents and 3 lines. The source has no verified common unit.',evidence:{summary:{documents:2,items:3,total_qty:105}}});
 assert.equal(certifyScenario('receiving_quantity_units',receipts).status,'PASS');
 assert.equal(certifyScenario('receiving_quantity_units',{...receipts,turn:{...receipts.turn,reply:receipts.turn.reply+' Total: 105 kg.'}}).status,'FAIL');
});

test('current Factory recipe standards and their historical versions are distinct source populations; stale owner captures are blocked',()=>{
 const std=[{id:'a',status:'draft'},{id:'b',status:'active'}];
 const all=[{id:'a1',status:'active'},{id:'a2',status:'draft'},{id:'b1',status:'active'}];
 const record=measuredTurn({id:'read_factory_recipe_versions',module:'factory_product_recipes',route:'/factory/master-data/product-recipes',
  scope:{mode:'summary',page:1,measure:'current_products',status:'active'},source:{current_standards:std,saved_versions:all},
  reply:'1 of 2 current product standards are active. 2 of 3 saved versions are active.',
  evidence:{aggregate_complete:true,total_matching:1,current_products:{total:2,by_status:{active:1,draft:1,archived:0}},recorded_versions:{total:3,by_status:{active:2,draft:1,archived:0}}}});
 const check=(r)=>certifyScenario('factory_recipe_standards_and_versions',r).status;
 assert.equal(check(record),'PASS');
 assert.equal(check({...record,turn:{...record.turn,reply:'1 active product (2 total), while 2 saved versions are active (3 total).'}}),'PASS');
 assert.equal(check({...record,turn:{...record.turn,reply:'2 active products (3 total), while 1 active saved version (2 total).'}}),'FAIL');
 const listed='There are a total of 2 current recipe standards.\n- Active: 1\n- Draft: 1\nFor saved recipe versions:\n- There are a total of 3 recorded versions.\n- Active: 2';
 assert.equal(check({...record,turn:{...record.turn,reply:listed}}),'PASS');
 assert.equal(check({...record,turn:{...record.turn,reply:listed+'\nConsider ingredient pricing and production efficiency.'}}),'FAIL');
 const alternate=(measure,status,total_matching)=>({...record,turn:{...record.turn,evidence:{...record.turn.evidence,
  requested_scope:{...record.source.scope,measure,status},total_matching}}});
 assert.equal(check(alternate('versions',null,3)),'PASS');
 assert.equal(check(alternate('current_products',null,1)),'FAIL');
 assert.equal(check(alternate('versions','draft',1)),'FAIL');
 assert.equal(check({...record,turn:{...record.turn,reply:'2 of 3 current product standards are active. 1 of 2 saved versions are active.'}}),'FAIL');
 assert.equal(check({...record,source:{...record.source,capture:{...record.source.capture,at:'2025-11-23T00:00:00Z'}}}),'BLOCKED');
 assert.equal(check({...record,turn:{...record.turn,created_at:'2026-12-23T01:00:00Z'}}),'BLOCKED');
});

test('cross-domain headcount and stock answers retain the unfiltered population and correct unit in Mandarin',()=>{
 const turn={request_id:'fixture',created_at:'2026-11-23T00:00:00Z',model:'fixture',state:'completed',tool_state:'completed',
  evidence:{items:[{capability:'read_employee_directory',requested_scope:{status:'all'},aggregate_complete:true,summary:{total:51}},
   {capability:'read_factory_finished_goods',rows:[{product_code:'S01',current_balance:62,uom:'kg'}]}]},
  reply:'可查看的员工总数为51人。工厂成品 S01 的库存余额为62公斤。'};
 const source={count:51,code:'S01',quantity:62,unit:'kg'};
 const check=t=>certifyScenario('employees_fg_scope',{turn:t,source}).status;
 assert.equal(check(turn),'PASS');
 assert.equal(check({...turn,reply:'共51名在职员工；S01 的库存为62公斤。'}),'FAIL');
 assert.equal(check({...turn,reply:'员工人数为51人。S01 的库存为62克。'}),'FAIL');
 assert.equal(check({...turn,evidence:{items:[{...turn.evidence.items[0],requested_scope:{status:'active'}},turn.evidence.items[1]]}}),'FAIL');
});

test('recorded supplier purchases require accurate month/amount pairs, annual total and missing-month disclosure',()=>{
 const scope={mode:'supplier_year',month:'2026-01-01',outlet_name:'Outlet A',supplier_name:null,page:1};
 const months=[{month:1,amount:100},{month:2,amount:75},{month:3,amount:0}];
 const missing=[4,5,6,7,8,9,10,11,12],annual=175;
 const reply='1月：RM 100；2月：RM 75；3月：RM 0。全年已记录采购总额为 RM 175。4至12月没有采购记录。';
 const record=measuredTurn({id:'read_purchase_comparison',module:'purchase-comparison',route:'/restaurant/purchases/comparison',scope,
  source:{outlet_name:'Outlet A',year:2026,months,annual_recorded_total:annual},reply,
  evidence:{outlet:{name:'Outlet A'},year:2026,currency:'MYR',aggregate_complete:true,period_complete:false,
   monthly_totals:[...months,...missing.map(month=>({month,amount:null}))],missing_months:missing,recorded_total:annual}});
 const check=(answer)=>certifyScenario('restaurant_supplier_monthly_recorded_purchases',{...record,turn:{...record.turn,reply:answer}});
 assert.deepEqual(check(reply).status,'PASS',JSON.stringify(check(reply)));
 assert.equal(check(reply.replace('1月：RM 100；2月：RM 75','1月：RM 75；2月：RM 100')).status,'FAIL');
 assert.equal(check(reply.replace('RM 175','RM 176')).status,'FAIL');
 const source={...record.source,outlet_id:'id-A',scope:{...scope,outlet_name:null,outlet_id:'id-A'}};
 const withScope=(month,id='id-A',name='Outlet A')=>certifyScenario('restaurant_supplier_monthly_recorded_purchases',{source,turn:{...record.turn,evidence:{...record.turn.evidence,
  outlet:{id,name},requested_scope:{...scope,month,outlet_name:name}}}}).status;
 assert.equal(withScope('2026-11-01'),'PASS');assert.equal(withScope('2025-11-01'),'FAIL');
 assert.equal(withScope('2026-11-01','other','Outlet A'),'FAIL');assert.equal(withScope('2026-11-01','id-A','Different'),'FAIL');
 assert.equal(check(reply.replace('4至12月没有采购记录','4至12月采购为 RM 0')).status,'FAIL');
});
