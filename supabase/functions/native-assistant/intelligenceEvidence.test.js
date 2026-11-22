import test from 'node:test';
import assert from 'node:assert/strict';
import {formatMonetaryComparisons,operationalAnalysis,verifiedAnswerAmounts,verifyReadEvidence} from '../_shared/assistant/evidence.js';
import {compareOperationalReports} from '../_shared/finance/operationalComparison.js';
import {assistantQuery} from './business.js';
import {generateText} from './provider.js';

const operation=assistantQuery('read_factory_finished_goods');
const args={mode:'list',page:2};
const e={capability:operation.id,source:operation.moduleInterface.source,version:operation.version,
 scope:'Factory',as_of:'2026-11-22T04:00:00Z',requested_scope:args,aggregate_complete:true,page:2,page_size:20,
 total_matching:21,truncated:false,rows:[{current_balance:5,uom:'kg'}],returned:1};

test('user-visible evidence must agree with its source identity, unit, actual page and scope',()=>{
 const verify=row=>verifyReadEvidence(operation.moduleInterface,operation.id,row,args);
 assert.equal(verify(e),e);
 for(const change of [{source:'/finance'},{capability:'other'},{as_of:'invalid'},{version:0},
  {returned:2},{rows:[],returned:0},{truncated:true},{requested_scope:{mode:'list',page:1}},
  {ranking:{status:'ranked',unit:'pack',ranked_count:21}}]){
  assert.throws(()=>verify({...e,...change}),{code:'business_read_unavailable'});
 }
});

const outlet={id:'first',name:'Corner'};
const owner=assistantQuery('read_operating_expenses');
const expense=(month,amount)=>({source:owner.moduleInterface.source,version:owner.version,capability:owner.id,
 period_complete:true,aggregate_complete:true,query_outcome:'SUCCESS',currency:'MYR',total_amount:amount,
 requested_scope:{month},outlet,year:2026});

test('compares complete like-for-like evidence from independent authorized reads once, in date order',()=>{
 const first=expense('2026-01-01',80),next=expense('2026-02-01',125);
 const analyze=rows=>operationalAnalysis(rows,assistantQuery);
 const [comparison]=analyze([next,first,first]).comparisons;
 assert.equal(comparison.basis,'period');
 assert.equal(comparison.baseline.value,80);
 assert.equal(comparison.difference,45);
 assert.equal(comparison.unit,'MYR');
 for(const change of [{query_outcome:'UNAUTHORIZED'},{period_complete:false},{currency:'USD'},
  {source:'/finance'},{outlet:{id:'other',name:'Hill'}},{total_amount:null}]){
  assert.equal(analyze([first,{...next,...change}]),null);
 }
 assert.equal(analyze([first,next,{...first,total_amount:85}]),null);
});

test('multi-outlet catalogue differences use the same status filter; complete records are not units on hand',()=>{
 const master=assistantQuery('read_inventory_items');
 const evidence={capability:master.id,version:master.version,source:master.source,query_outcome:'SUCCESS',aggregate_complete:true,
  requested_scope:{mode:'summary',status:'active'},by_outlet:[{outlet,total_matching:8},{outlet:{id:'second',name:'Hill'},total_matching:12}]};
 const other={...evidence,requested_scope:{mode:'summary',status:'archived'},by_outlet:[{outlet,total_matching:2}]};
 const result=operationalAnalysis([evidence,other],assistantQuery);
 assert.equal(result.comparisons.length,1);
 assert.equal(result.comparisons[0].difference,4);
 assert.equal(result.comparisons[0].unit,'item types');
 assert.equal(result.comparisons[0].population,'active');
});

test('explicit currency claims must come from owner measures even when months are missing',()=>{
 const recorded={...expense(null,10000),rows:[{month:1,amount:10000}],period_complete:false};
 assert.equal(verifiedAnswerAmounts('Only January has MYR 10,000.00 recorded.',[recorded],assistantQuery),true);
 assert.equal(verifiedAnswerAmounts('The annual total was RM120,000.',[recorded],assistantQuery),false);
 assert.equal(verifiedAnswerAmounts('The cost was 2,026 ringgit.',[recorded],assistantQuery),false);
 assert.equal(verifiedAnswerAmounts('RM10k has been entered.',[recorded],assistantQuery),true);
 for(const text of ['Expenses were -RM10,000.', 'Expenses were −MYR10,000.', 'Expenses were (RM10,000).']){
  assert.equal(verifiedAnswerAmounts(text,[recorded],assistantQuery),false);
 }
 assert.equal(verifiedAnswerAmounts('- RM10,000 recorded.',[recorded],assistantQuery),true);
 assert.equal(verifiedAnswerAmounts('There are 5 assets.',[recorded],assistantQuery),null);
});

test('Text preserves signed changes and actual period associations even when the proposed monetary answer swaps them',async()=>{
 const periods=[['2026-01-01',1000],['2026-02-01',600]];
 const business={tools:[owner.tool],
  execute:async(_name,args)=>{
   const [month,amount]=periods[args.index];
   return {...expense(month,amount),rows:[{month,amount}]};
  },
  validAnswerAmounts:(reply,evidence)=>verifiedAnswerAmounts(reply,evidence,assistantQuery),
 };
 for(const wording of ['Expenses fell by RM400.','Expenses rose from RM600 in January to RM1,000 in February.']){
  let step=0;
  const result=await generateText({kind:'turn',model:'gpt-4o-mini',prompt:'Why did expenses change?'},'fixture-credential',{business,
   transport:async()=>{
    const output=step<2?[{type:'function_call',name:owner.id,call_id:'c'+step,arguments:JSON.stringify({index:step})}]:
     [{type:'message',content:[{type:'output_text',text:wording}]}];
    step++;
    return Response.json({status:'completed',output,usage:{input_tokens:10,output_tokens:5}});
   },
  });
  assert.equal(step,3);
  assert.match(result.reply,/Corner · 2026-01 RM1,000.00 → Corner · 2026-02 RM600.00 · Difference −RM400.00/);
  assert.match(result.reply,/Check the supporting records/);
  assert.doesNotMatch(result.reply,/could not be verified|rose from/);
 }
});

test('Finance comparisons retain source classifications, unavailable operands and partial Restaurant scopes',()=>{
 const finance=assistantQuery('read_operational_financials');
 const report=(month,values)=>({outlet,period:{year:2026,month},financials:Object.fromEntries(
  ['revenue','purchase_based_cogs','opex','net_profit'].map((key,i)=>[key,{presence:values[i]===null?'missing':'present',amount:values[i]}]))});
 const previous=report(1,[1000,500,300,200]),current=report(2,[800,null,350,null]);
 const evidence={capability:finance.id,source:finance.source,version:finance.version,report:current,comparison_report:previous,
  analysis:compareOperationalReports(current,previous)};
 const review=verifiedAnswerAmounts('Revenue increased by RM200.',[evidence],assistantQuery);
 const text=formatMonetaryComparisons(review,'Why did revenue change?');
 assert.match(text,/Difference −RM200\.00/);
 assert.match(text,/2026-02\nPurchase-based cost of goods · Unavailable/);
 assert.match(text,/Performance zone · Insufficient evidence/);
 assert.match(text,/Revenue growth · -20\.00%/);
 assert.match(text,/EBITDA change attribution · EBITDA movement cannot be fully attributed/);
 const complete=report(2,[800,400,350,50]);
 const paired={...evidence,report:complete,analysis:compareOperationalReports(complete,previous)};
 const full=formatMonetaryComparisons(verifiedAnswerAmounts('Revenue changed by RM200.',[paired],assistantQuery),'Compare');
 assert.match(full,/Performance zone · Profitable but slowing/);
 assert.match(full,/Contribution to EBITDA change · Reported operating expenses · −RM50\.00/);
 const expenseMonth=(month,amount)=>({...expense(month,amount),rows:[{amount}]});
 const jan=expenseMonth('2026-01-01',1000),feb=expenseMonth('2026-02-01',600);
 const partial={...expenseMonth(null,1600),period_complete:false};
 assert.deepEqual(verifiedAnswerAmounts('Expenses changed by RM400.',[jan,feb,partial],assistantQuery).coveredEvidence,[jan,feb]);
});
