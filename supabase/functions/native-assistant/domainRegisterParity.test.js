import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantQuery} from './business.js';
import {monthlyFinancialDataset} from '../_shared/finance/monthlyReporting.js';

const outlet='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
function fixture({tables={},rpcs={},denied=false}={}){
 const calls=[];
 return {calls,rpc(name,args){
  calls.push([name,args]);
  const data=name==='current_user_has_permission'?true:name==='current_user_can_access_outlet'?args.target_outlet_id===outlet&&!denied:rpcs[name];
  return {abortSignal:async()=>({data})};
 },from(table){
  calls.push([table]);
  let rows=[...(tables[table]||[])],count,head=false;
  return {
   select(fields,options){head=options?.head;calls.push(['select',fields]);return this;},
   eq(key,v){rows=rows.filter(row=>row[key]===v);return this;},
   ilike(key,v){rows=rows.filter(row=>String(row[key]).toLowerCase()===v.toLowerCase());return this;},
   in(key,ids){rows=rows.filter(row=>ids.includes(row[key]));return this;},
   gt(key,v){rows=rows.filter(row=>row[key]>v);return this;},
   gte(key,v){rows=rows.filter(row=>row[key]>=v);return this;},
   lte(key,v){rows=rows.filter(row=>row[key]<=v);return this;},
   order(){return this;},limit(n){rows=rows.slice(0,n);return this;},
   range(lo,hi){count=rows.length;rows=rows.slice(lo,hi+1);return this;},
   async abortSignal(){return {data:head?null:rows,count:count??rows.length};},
  };
 }};
}

test('Factory records count statuses, business code and dates under their own permission without exposing unrelated fields',async()=>{
 const source=fixture({tables:{
  factory_suppliers:[{id:'a',supplier_code:'A-1',supplier_name:'Ingredients',status:'active',email:'hidden'},
   {id:'b',supplier_code:'B-1',supplier_name:'Packaging',status:'archived'}],
  factory_productions:[{id:'p1',batch_no:'P1',status:'completed',production_date:'2026-05-01',good_output_qty:0,uom:'kg'},
   {id:'p2',batch_no:'P1',status:'completed',production_date:'2026-06-01',good_output_qty:10,uom:'kg'}]}});
 const supplier=assistantQuery('read_factory_suppliers');
 const count=await supplier.execute(source,{mode:'summary',status:'active'});assert.equal(count.total_matching,1);assert.deepEqual(count.rows,[]);
 const detail=await supplier.execute(source,{code:'a-1'});assert.equal(detail.rows[0].supplier_name,'Ingredients');assert.equal(detail.rows[0].email,undefined);
 assert(source.calls.some(([fn,arg])=>fn==='current_user_has_permission'&&arg.permission_code==='factory_suppliers.view'));
 const production=assistantQuery('read_factory_production_records');
 const may=await production.execute(source,{batch:'P1',from:'2026-05-01',to:'2026-05-31'});
 assert.equal(may.rows[0].good_output_qty,0);assert.equal(may.rows[0].uom,'kg');assert.equal(may.total_matching,1);
 assert.throws(()=>production.validate({from:'2026-05-01'}),{code:'tool_arguments_invalid'});
});

test('Restaurant record counts use the same outlet, date and field filters as the page',async()=>{
 const rows=Array.from({length:23},(_,i)=>({id:i,outlet_id:outlet,waste_date:'2026-03-01',waste_type:'Damage',unit:'kg',quantity:i,notes:'private'}));
 const caller=fixture({tables:{inventory_waste_records:[...rows,{...rows[0],outlet_id:other},{...rows[0],waste_type:'Expired'}]}});
 const op=assistantQuery('read_inventory_waste'),args={outlet_id:outlet,from:'2026-03-01',to:'2026-03-01',waste_type:'damage'};
 const count=await op.execute(caller,{...args,mode:'summary'});
 const second=await op.execute(caller,{...args,page:2});
 assert.equal(count.total_matching,23);assert.equal(second.total_matching,23);assert.equal(second.rows.length,3);
 assert.equal(second.rows[0].quantity,20);assert.equal(second.rows[0].notes,undefined);
 await assert.rejects(op.execute(caller,{...args,outlet_id:other}),{code:'business_read_denied'});
});

test('Factory Product Recipes chooses current standards before filtering status and preserves independent version counts',async()=>{
 const source=fixture({tables:{factory_product_recipes:[
  {id:'a',product_family_id:'family',version:'v2',status:'active',product_name:'Sauce',notes:'private'},
  {id:'b',finished_good_id:'sku',finished_good:{product_family_id:'family',product_family:{name_en:'Sauce'}},version:'v10',status:'draft',items:['private']},
  {id:'c',finished_good_id:'solo',version:'v1',status:'active',product_name:'Standalone',manual_unit_cost:23},
  {id:'d',version:'v1',status:'active',product_name:'Legacy'},
  {id:'e',version:'v1',status:'archived',product_name:'Legacy'},
 ]}});
 const op=assistantQuery('read_factory_recipe_versions');
 const summary=await op.execute(source,{measure:'current_products',mode:'summary',status:'active'});
 assert.deepEqual(summary.current_products,{total:4,by_status:{active:2,draft:1,archived:1}});
 assert.deepEqual(summary.recorded_versions,{total:5,by_status:{active:3,draft:1,archived:1}});
 assert.equal(summary.total_matching,2);assert.deepEqual(summary.rows,[]);
 const raw=await op.execute(source,{mode:'summary',status:'active'});
 assert.equal(raw.total_matching,3);assert.deepEqual(raw.current_products,summary.current_products);
 const draft=await op.execute(source,{measure:'current_products',mode:'list',status:'draft',product_name:'Sauce'});
 assert.deepEqual(draft.rows.map(r=>[r.version,r.version_count,r.product_name]),[['v10',2,'Sauce']]);
 assert(!JSON.stringify(draft.rows).includes('private'));assert(!source.calls.some(([fn])=>fn==='factory_raw_material_receivings'));
 const incomplete=fixture({tables:{factory_product_recipes:[{id:'r',product_name:'name'}]}});
 const from=incomplete.from;
 incomplete.from=key=>{const q=from(key);q.abortSignal=async()=>({data:[],count:1001});return q;};
 await assert.rejects(op.execute(incomplete,{measure:'current_products',mode:'summary'}),{code:'business_result_limit'});
});

test('Dashboard labels and stock counts respect evidence state; Par measures only configuration',async()=>{
 const rpcs={inventory_dashboard_stock_evidence:{position_count:2,positions:[
  {outlet_id:outlet,item_id:'flour',state:'below_par',actual_count:1,current_par:10},
  {outlet_id:outlet,item_id:'old',state:'unverified',actual_count:45,current_par:15}]}};
 const items=[{id:'flour',item_name:'Flour',sku_code:'F',unit:'kg'},{id:'old',item_name:'Tin',sku_code:'T',unit:'boxes'}];
 const caller=fixture({rpcs,tables:{outlets:[{id:outlet,name:'Outlet'}],inventory_items:items,
  inventory_item_outlets:[{id:'f',inventory_item_id:'flour',outlet_id:outlet,par_level:10,item:items[0]},
   {id:'o',inventory_item_id:'old',outlet_id:outlet,par_level:0,item:items[1]}]}});
 const dashboard=assistantQuery('read_inventory_stock_evidence');
 const e=await dashboard.execute(caller,{outlet_id:outlet});
 assert.equal(e.rows[0].sku,'F');assert.equal(e.rows[0].confirmed_count,1);assert.equal(e.rows[0].quantity_unit,'kg');
 assert.equal(e.rows[1].confirmed_count,null);assert.equal(e.rows[1].quantity_unit,null);
 assert.deepEqual(e.state_counts,{below_par:1,sufficient:0,changed:0,unverified:1});
 const below=await dashboard.execute(caller,{outlet_id:outlet,mode:'summary',state:'below_par'});
 assert.equal(below.total_matching,1);assert.deepEqual(below.rows,[]);assert.equal(below.state_counts.unverified,0);
 const configured=await assistantQuery('read_inventory_par_levels').execute(caller,{outlet_id:outlet,par_scope:'positive'});
 assert.equal(configured.total_matching,1);assert.equal(configured.rows[0].par_level,10);assert.equal(configured.rows[0].sku,'F');
});

const entry={id:'check',outlet_id:outlet,stock_check_type:'audit',audit_type:'Month-End Closing',status:'submitted',accounting_month:'2026-10-01'};
const publication={id:'p',source_audit_id:'corrected',revision:2,valuation_status:'partial',amount:8.25,valued_item_count:1,
 total_item_count:2,actual_count_date:null,approved_at:'2026-11-04T00:00:00Z',approved_by:'private'};
test('Stock Check follows only a submitted outlet/month into the authorized current publication and excludes financial/actor fields',async()=>{
 const op=assistantQuery('read_inventory_checks'),args={outlet_id:outlet,month:'2026-10-01',mode:'closing'};
 const otherScope=[{...entry,outlet_id:other},{...entry,accounting_month:'2026-09-01'},{...entry,status:'draft'}];
 const empty=fixture({tables:{inventory_stock_checks:otherScope}});
 assert.equal((await op.execute(empty,args)).publication_state,'no_submitted_audit');
 assert(!empty.calls.some(([fn])=>fn==='inventory_closing_context'));
 await assert.rejects(op.execute(empty,{...args,outlet_id:other}),{code:'business_read_denied'});
 for(const record of [null,publication]){
  const caller=fixture({tables:{inventory_stock_checks:[entry,...otherScope]},rpcs:{inventory_closing_context:{published:record}}});
  const result=await op.execute(caller,args);assert(caller.calls.some(([fn,p])=>fn==='inventory_closing_context'&&p.p_check_id==='check'));
  assert.equal(result.publication_state,record?'published':'submitted_unpublished');
  if(record){assert.equal(result.publication.revision,2);assert.equal(result.publication.valued_item_count,1);
   assert.equal(result.publication.actual_count_date,null);assert(!('amount' in result.publication));assert(!('approved_by' in result.publication));}
 }
});

test('Reporting explicit closing values match Outlet P&L and distinguish published zero, partial value, no amount and scope failure',async()=>{
 const report=assistantQuery('read_operational_financials'),args={outlet_id:outlet,year:2026,month:10,measure:'closing_stock'};
 const raw={outlet:{id:outlet,name:'Outlet',scope:'outlet',outlet_count:1},period:{year:2026,month:10},financials:{}};
 for(const value of [null,publication,{...publication,amount:null,valued_item_count:0},
  {...publication,amount:0,valuation_status:'complete',valued_item_count:2}]){
  const source={...raw,closing_stock_evidence:value,closing_stock:value?.valuation_status==='complete'?value.amount:null};
  const e=await report.execute(fixture({rpcs:{reporting_monthly_scope_financials:source}}),args);
  const canonical=monthlyFinancialDataset(source);
  assert.equal(e.closing_stock.amount,canonical.closingStock);assert.equal(e.closing_stock.status,value?.valuation_status||'unavailable');
  assert.equal(e.closing_stock.valued_items,canonical.closingStockEvidence?.valuedItemCount??null);
  const answer=report.format(e,'What is closing stock?');
  assert.match(answer,/Outlet · 2026-10/);
  if(!value||value.amount==null)assert.doesNotMatch(answer,/RM0/);
  if(value?.valuation_status==='partial')assert.match(answer,/Partial closing valuation/);
  if(value?.amount===0)assert.match(answer,/Complete closing valuation · RM0.00/);
 }
 await assert.rejects(report.execute(fixture({rpcs:{reporting_monthly_scope_financials:{...raw,period:{year:2026,month:9}}}}),args),{code:'business_read_unavailable'});
});
