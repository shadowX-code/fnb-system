import test from 'node:test';
import assert from 'node:assert/strict';
import {operations} from './business.js';
import {getPurchaseTotal,getSupplierPurchaseAmount} from '../_shared/restaurant/analytics.js';
import {supplierPurchaseIntent} from '../_shared/restaurant/supplierPurchases.js';

const read=id=>operations.find(op=>op.id===id);
const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002';
const shop={id:a,name:'Example Shop',code:'EX'};
const entry=(id,month,amount,supplier_id='first',name='First')=>({id,month,amount,supplier_id,supplier:{name},outlet_id:a,year:2026});
const records=[entry('a',1,4),entry('b',1,2),entry('z',6,0),entry('c',6,3,'second','Second'),
 {...entry('foreign',6,999),outlet_id:b},{...entry('old',6,999),year:2025}];
function scopedCaller({entries=records,deny=null,extra=0}={}){
 const tables=[];
 return {tables,rpc(n,p){return {abortSignal:async()=>({data:n==='current_user_has_permission'?deny!==p.permission_code:deny!=='outlet'&&p.target_outlet_id===a})};},
  from(table){tables.push(table);assert(['purchase_records','outlets'].includes(table));
   let rows=table==='outlets'?[shop]:entries;
   const q={select:()=>q,order:()=>q,limit:()=>q,eq(k,v){rows=rows.filter(r=>r[k]===v);return q;},ilike(k,v){rows=rows.filter(r=>r[k].toLowerCase()===v.toLowerCase());return q;},
    abortSignal:async()=>({data:rows,count:rows.length+extra})};return q;
  }};
}
const annual={mode:'supplier_year',outlet_name:shop.name,month:'2026-11-01'};
test('annual supplier year uses the complete Purchase Comparison source even in months without sales and distinguishes recorded zero',async()=>{
 const op=read('read_purchase_comparison'),caller=scopedCaller();
 const e=await op.execute(caller,annual);
 assert.deepEqual(caller.tables,['outlets','purchase_records']);assert.equal(e.outlet.name,shop.name);assert.equal(e.entry_count,4);
 assert.equal(e.recorded_total,9);assert.equal(e.period_complete,false);assert.equal(e.aggregate_complete,true);
 assert.deepEqual(e.monthly_totals.filter(r=>r.entry_count),[1,6].map(month=>({month,entry_count:2,amount:getPurchaseTotal(records,a,month,2026)})));
 assert.deepEqual(e.rows,[{supplier_name:'First',entry_count:3,amount:6},{supplier_name:'Second',entry_count:1,amount:3}]);
 assert.equal(e.monthly_totals[1].amount,null);assert.deepEqual(e.missing_months,[2,3,4,5,7,8,9,10,11,12]);
 const one=await op.execute(scopedCaller(),{...annual,supplier_name:'First'});
 assert.equal(one.monthly_totals[5].amount,getSupplierPurchaseAmount(records,a,'first',6,2026));
 assert.equal(one.monthly_totals[5].amount,0);assert.equal(one.missing_months.includes(6),false);
 const absent=await op.execute(scopedCaller(),{...annual,supplier_name:'Different'});
 assert.equal(absent.recorded_total,null);assert.equal(absent.entry_count,0);assert.equal(absent.match_status,'not_found');assert.match(absent.match_scope,/no conclusion about supplier master existence/u);
 assert.equal(absent.monthly_totals.every(r=>r.amount===null),true);
 const requested=await read('read_purchase_records').execute(scopedCaller(),{outlet_id:a,mode:'supplier_totals',month:'2026-01-01'});
 assert.equal(requested.recorded_total,6);assert.equal(requested.rows.length,1);assert.equal(requested.period_complete,true);
});
test('supplier scope, data completeness, ambiguous supplier identity and policy prerequisites fail closed',async()=>{
 const op=read('read_purchase_comparison');
 for(const deny of ['purchase_comparison.view','outlet','suppliers.view','operating_expenses.view']){
  const caller=scopedCaller({deny});await assert.rejects(op.execute(caller,{...annual,outlet_id:a,outlet_name:null}),{code:'business_read_denied'});
  assert.equal(caller.tables.includes('purchase_records'),false);
 }
 await assert.rejects(op.execute(scopedCaller(),{...annual,outlet_id:b}),{code:'entity_ambiguous'});
 await assert.rejects(op.execute(scopedCaller({extra:1}),annual),{code:'business_result_limit'});
 await assert.rejects(op.execute(scopedCaller({entries:[entry('1',1,10),entry('2',1,20,'different','First')]}),{...annual,supplier_name:'First'}),{code:'entity_ambiguous'});
 const unnamed=[entry('1',1,3,'hidden',null),entry('2',1,7,null,null)];
 const all=await op.execute(scopedCaller({entries:unnamed}),annual);assert.equal(all.recorded_total,10);
 assert.deepEqual(all.rows.map(r=>[r.supplier_name,r.supplier_label_state,r.amount]),[[null,'unassigned',7],[null,'unavailable',3]]);
 await assert.rejects(op.execute(scopedCaller({entries:unnamed}),{...annual,supplier_name:'First'}),{code:'business_read_unavailable'});
 const multi=Array.from({length:12},(_,i)=>entry('r'+i,1,i,'s'+i,'Supplier '+i));
 const page2=await op.execute(scopedCaller({entries:multi}),{...annual,page:2});
 assert.equal(page2.total_matching,12);assert.equal(page2.rows.length,2);assert.equal(page2.recorded_total,66);
 assert.deepEqual(page2.rows.map(r=>r.amount),[1,0]);
});
test('multilingual supplier purchase intents distinguish a month from a monthly series',()=>{
 for(const q of ['每个月的 supplier 采购金额，全年一共多少？','What were monthly supplier purchases this year?','Berapa jumlah pembelian pembekal setiap bulan?']){
  assert.equal(supplierPurchaseIntent(q),'supplier_year');assert.equal(read('read_purchase_comparison').queryIntent(q),'recorded_purchases_by_month');assert.equal(read('read_purchase_records').queryIntent(q),null);
 }
 for(const q of ['11月供应商的采购金额是多少？','How much did we spend on supplier purchases this month?','Berapa jumlah pembelian pembekal bulan ini?'])assert.equal(supplierPurchaseIntent(q),'supplier_month');
 for(const q of ['What operating expenses were recorded?','What were monthly Factory warehouse purchases?','Which supplier purchase orders were issued this year?','今年工厂供应商采购订单有多少？'])assert.equal(supplierPurchaseIntent(q),null);
});

test('shared answer amount guard accepts recorded purchases and literal efficiency amounts but excludes unsupported numbers',async()=>{
 const {verifiedAnswerAmounts}=await import('../_shared/assistant/evidence.js');
 const op=read('read_purchase_comparison');
 const grouped=await op.execute(scopedCaller({entries:[entry('jan',1,800),entry('jun',6,900)]}),annual);
 const verify=(reply,e)=>verifiedAnswerAmounts(reply,[e],read);
 assert.equal(verify('六月采购 RM900.00，全年记录 RM1,700.00。',grouped),true);
 for(const wrong of ['RM 899.99','RM 2026','RM 2','RM 0'])assert.equal(verify(wrong,grouped),false);
 const eff={...grouped,recorded_total:null,rows:[],monthly_totals:[],months:[{month:5,sales_record_count:1,purchase_record_count:1,
  previous_sales_record_count:1,previous_purchase_record_count:0,recorded_purchase_amount:210,values:{netSales:1400,totalPurchase:210,grossProfitEstimate:1190,
   previousNetSales:1365,previousPurchase:0,cogsMargin:15,purchaseChange:99,salesChange:23}},{month:6,purchase_record_count:1,sales_record_count:0,values:null,recorded_purchase_amount:900}]};
 for(const n of [1400,210,1190,1365,900])assert.equal(verify('RM '+n,eff),true);
 for(const n of [0,15,99,23,6,5,1])assert.equal(verify('RM '+n,eff),false);
 const input=read('read_purchase_records');
 const e={capability:input.id,source:input.source,version:input.version,rows:[{id:99,amount:'12.30'},{id:20,amount:null}],entry_count:2};
 assert.equal(verify('RM 12.30',e),true);for(const n of [0,2,99,20])assert.equal(verify('RM '+n,e),false);
 assert.equal(op.format(grouped,'按类别显示全年采购金额'), 'Example Shop 2026 年有 2 个月的采购记录，共 RM 1,700.00。这项年度汇总可按供应商查看，暂不提供采购类别明细。');
 assert.equal(op.format(grouped,'Monthly supplier purchases?'),null);
});
