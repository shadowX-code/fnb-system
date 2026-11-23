import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessDispatcher,operations} from './business.js';
import {generateText} from './provider.js';
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
   let start=0,end;
   const q={select:()=>q,order:()=>q,limit:()=>q,eq(k,v){rows=rows.filter(r=>r[k]===v);return q;},ilike(k,v){rows=rows.filter(r=>r[k].toLowerCase()===v.toLowerCase());return q;},
    range(first,last){start=first;end=last+1;return q;},abortSignal:async()=>({data:rows.slice(start,end),count:rows.length+extra})};return q;
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
 assert.match(op.format(grouped,'Monthly supplier purchases?'),/January RM 800.00, June RM 900.00/);
 for(const text of ['年度采购 0.17 万令吉。','共计 RM 0.17万。','全年记录 1\u202f700.00 馬幣。','全年记录 RM１，７００。'])
  assert.equal(verify(text,grouped),true,text);
 for(const text of ['0.18 万令吉','1800 馬幣','RM 1.7万','RM 800\nRM 901'])
  assert.equal(verify(text,grouped),false,text);
 assert.equal(verify('2026 MYR 1,700.00',grouped),true,'The reporting year is not an amount');
});

test('Text renders a source-verified period series when proposed amounts are wrong or assigned to the wrong months',async()=>{
 const operation='read_purchase_comparison',owner=read(operation);
 const business=createBusinessDispatcher({config:{enabled:true,capability_connections:{[operation]:true}},access:{permissions:{[owner.permission]:true}}});
 const caller=scopedCaller({entries:[entry('one',1,500),entry('two',1,14),entry('zero',2,0,'second','Second'),entry('six',6,32)]});
 const args={...annual,month:'2026-01-01'};
 const e=await owner.execute(caller,args);
 const evidence={...e,query_outcome:'SUCCESS'};
 assert.equal(evidence.total_matching,2);assert.equal(evidence.entry_count,4);
 const prompt='请列出 Example Shop 2026 年每个月的 supplier 采购额、全年总额和没有采购记录的月份。';
 const confirmed=[];
 for(const proposed of ['采购额 RM 888.88。','1月 RM32.00，6月 RM514.00。']){
  let step=0;
  const result=await generateText({kind:'turn',model:'fixture-model',prompt},'fixture-token',{
   business:{...business,resolvedArguments:async()=>null,execute:async(id,received)=>{assert.equal(id,operation);assert.deepEqual(received,args);return evidence;}},
   onTool:async(state,source)=>{if(state==='completed')confirmed.push(source);},
   transport:async()=>Response.json({status:'completed',usage:{input_tokens:1,output_tokens:1},output:++step===1?
    [{type:'function_call',call_id:'purchase',name:operation,arguments:JSON.stringify(args)}]:
    [{type:'message',content:[{type:'output_text',text:proposed}]}]}),
  });
  assert.equal(step,2);assert.equal(confirmed.at(-1),evidence);
  assert.match(result.reply,/Example Shop 2026.*全年.*RM 546\.00/u);
  assert.match(result.reply,/1月 RM 514\.00，2月 RM 0\.00，6月 RM 32\.00/u);
  assert.match(result.reply,/3月至5月、7月至12月没有采购记录/u);
  assert.doesNotMatch(result.reply,/无法核实|符合条件|888\.88/u);
 }
 const one=await owner.execute(caller,{...args,supplier_name:'Second'});
 const voice=business.format(operation,one,'What were annual supplier purchases?',{medium:'voice'});
 assert.match(voice,/Example Shop · Second recorded an annual total of RM 0.00/);
 assert.match(voice,/January, March to December/);assert.doesNotMatch(voice,/February RM/u);
 assert.match(business.format(operation,one,'What were monthly supplier purchases?',{medium:'voice'}),/February RM 0.00/);
 const empty=await owner.execute(caller,{...args,supplier_name:'Absent'});
 assert.match(owner.format(empty,prompt),/Example Shop · Absent.*没有采购记录/u);
 const monthly=await read('read_purchase_records').execute(caller,{...args,mode:'supplier_totals',supplier_name:'First'});
 assert.match(business.format(monthly.capability,monthly,'Berapa jumlah pembelian pembekal?'),/Example Shop · First.*Januari 2026.*RM 514.00/);
 for(const partial of [{aggregate_complete:false},{monthly_totals:e.monthly_totals.slice(1)},{missing_months:[]},{recorded_total:99},{entry_count:2}])
  assert.equal(owner.format({...e,...partial},prompt),null);
 for(const other of ['List the top suppliers by annual purchases','Compare purchase amounts with last year'])
  assert.equal(owner.format(e,other),null);
});

test('purchase entry and supplier-group page continuations retain their distinct fixed sizes, complete scope and model-assisted list answers',async()=>{
 const entries=Array.from({length:25},(_,i)=>entry('p'+i,1,100+i,'s'+i,'Supplier '+i));
 const caller=scopedCaller({entries});
 const input=read('read_purchase_records'),comparison=read('read_purchase_comparison');
 const business=createBusinessDispatcher({caller,config:{capability_connections:{[input.id]:true,[comparison.id]:true}},
  access:{permissions:{[input.permission]:true,[comparison.permission]:true}}});
 for(const [owner,mode,size] of [[input,'list',20],[input,'supplier_totals',10],[comparison,'supplier_year',10]]){
  const request={mode,outlet_name:shop.name,month:'2026-01-01',page:1};
  const first=await owner.execute(caller,request);
  assert.equal(first.rows.length,size);assert.equal(first.page_size,size);
  assert.equal(owner.format(first,'List the suppliers and their amounts'),null);
  const history=async()=>({turns:[{state:'completed',tool_state:'completed',evidence:first}]});
  const next=await business.planTurn('next page',history);
  assert.deepEqual(next.page.args,{...first.requested_scope,page:2});
  assert.equal(await business.resolvedArguments(next,'next page',history),null,'A summary formatter does not own list pages');
  let calls=0;
  const committed=[];
  const result=await generateText({kind:'turn',model:'fixture-model',prompt:'next page'},'fixture-token',{business,history,
   onTool:async(state,evidence)=>{if(state==='completed')committed.push(evidence);},
   transport:async()=>Response.json({status:'completed',usage:{input_tokens:1,output_tokens:1},output:++calls===1?
    [{type:'function_call',call_id:'page',name:owner.id,arguments:JSON.stringify({...request,outlet_name:'Wrong suggestion',page:1})}]:
    [{type:'message',content:[{type:'output_text',text:'The second page lists '+(mode==='list'?'purchase entries.':'recorded supplier groups.')}]}]}),
  });
  assert.match(result.reply,/^The second page lists /);assert.equal(calls,2);assert.equal(committed.length,1);
  const e=committed[0];
  assert.deepEqual(e.requested_scope,next.page.args);assert.equal(e.total_matching,25);
  assert.equal(e.rows.length,mode==='list'?5:10);assert.equal(e.page,2);
  const key=row=>mode==='list'?row.id:row.supplier_name;
  const firstKeys=new Set(first.rows.map(key));assert(e.rows.every(row=>!firstKeys.has(key(row))));
  const broken={...first,page_size:size===10?20:10};
  const ambiguous=await business.planTurn('next page',async()=>({turns:[{state:'completed',tool_state:'completed',evidence:broken}]}));
  assert.equal(ambiguous.query_outcome,'AMBIGUOUS');
 }
});

test('saved Voice failure and correction replay through the authorized read, with provider-free Text parity',async()=>{
 const {dispatch}=await import('./handler.js');
 const id='260aeb0d-e6ab-40ed-a14a-df93bd29aa18';
 const owner=read('read_purchase_comparison');
 const config={enabled:true,capability_connections:{[owner.id]:true,read_purchase_records:true}};
 const access={admin:true,permissions:{[owner.permission]:true,'purchase_input.view':true}};
 const amounts=[5859,4859,2888,555,888,900];
 const rows=amounts.map((amount,i)=>entry(String(i),i+1,amount));
 const context=[];
 let caller=scopedCaller({entries:rows}),prompt;
 const saved=[];
 const deps={access,get:()=>undefined,reserveRealtime:async()=>{},rpc:async action=>action==='history'?{turns:[...context,{request_id:id,voice_input_available:true,prompt}]}:{config},
  voiceHistory:async command=>{saved.push(command.evidence);return {evidence:command.evidence};},get caller(){return caller;}};
 const find=()=>dispatch({action:'realtime_tool',provider:'openai',request_id:id,session_id:id,turn_id:id,operation:'find_business_queries',arguments:{search:'supplier',page:1}},deps);
 prompt='你帮我查看French Shop这间门店在今年的那个purchase，帮我分析一下。';
 const unclear=await find();
 assert.equal(unclear.preferred_operation,owner.id);assert(unclear.discovery_only);assert(!caller.tables.includes('purchase_records'));
 context.push({state:'completed',prompt},{state:'completed',prompt:'你看不到门店的采购数据吗？'});
 prompt='我是说Example Shop哦';
 const corrected=await find();
 assert.equal(corrected.capability,owner.id);assert.match(corrected.answer_hint,/RM 15,949\.00/);
 assert.equal(saved.length,1);
 context.splice(0,context.length,{state:'completed',tool_state:'completed',evidence:corrected});
 prompt='monthly breakdown';
 const detail=await find();
 assert.deepEqual(detail.monthly_totals.map(m=>m.amount),[...amounts,null,null,null,null,null,null]);
 assert.match(detail.answer_hint,/January RM 5,859\.00.*June RM 900\.00.*July to December/);
 for(const question of ['Show Example Shop monthly supplier purchases for 2026','列出 Example Shop 2026 年每个月的 supplier 采购金额','Berapa jumlah pembelian pembekal setiap bulan di Example Shop pada 2026?']){
  caller=scopedCaller({entries:rows});prompt=question;
  const voice=await find();
  const textEvidence=[];
  const business=createBusinessDispatcher({caller,access,config});
  const text=await generateText({kind:'turn',model:'unused',prompt},'unused',{business,transport:()=>assert.fail('No provider call'),
   onTool:(state,e)=>{if(state==='completed')textEvidence.push(e);}});
  assert.match(text.reply,/15,949/);
  assert.deepEqual(voice.monthly_totals,textEvidence[0].monthly_totals);
 }
 config.capability_connections[owner.id]=false;
 const disabled=await find();assert.equal(disabled.error,'capability_disconnected');
 config.capability_connections[owner.id]=true;
 access.permissions[owner.permission]=false;
 assert.equal((await find()).error,'business_read_denied');
 access.permissions[owner.permission]=true;
 caller=scopedCaller({entries:[]});assert.equal((await find()).query_outcome,'NO_MATCH');
 caller=scopedCaller({deny:'suppliers.view'});await assert.rejects(find(),{code:'business_read_denied'});
 caller=scopedCaller({extra:1});await assert.rejects(find(),{code:'business_result_limit'});
});
