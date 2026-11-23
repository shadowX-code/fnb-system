import test from 'node:test';
import assert from 'node:assert/strict';
import {reportRead} from '../_shared/finance/reportRead.js';
import {createBusinessDispatcher,operations} from './business.js';
import {generateText} from './provider.js';
import {dispatch} from './handler.js';
import {certifyScenario,generateSourceCases} from '../../../qa/staging/nativeAssistantCertification.mjs';

const outlet={id:'10000000-0000-4000-8000-000000000001',name:'QA Corner',code:'QC'};
const direct={outlet_id:outlet.id,year:2026,month:2,compare_year:null,compare_month:null,measure:'cost_trend_6m'};
const actor='fixture-operator';
const config={enabled:true,model:'gpt-4o-mini',capability_connections:{[reportRead.id]:true}};
const access={permissions:{'reports.view':true}};
const present=amount=>({amount,presence:'present'});
// Independent chart capture: six months shown by the operational Costs view.
const chart_rows=[
 ['2025-09',18.25,null],['2025-10',0,91],['2025-11',null,83],
 ['2025-12',70.75,null],['2026-01',41,0],['2026-02',null,null],
].map(([period,cogs,opex])=>({period,cogs,labour:null,opex}));
function callerFixture({allowed=true,scope=true,onRead,changeReport}={}){
 const rpcCalls=[],concurrency={active:0,max:0};
 const cogs={9:18.25,10:0,12:70.75,1:41},opex={10:91,11:83,1:0};
 return {rpcCalls,concurrency,
  from(table){
   assert.equal(table,'outlets');
   return {select(){return this;},order(){return this;},limit(){return this;},ilike(){return this;},
    abortSignal:async()=>({data:[outlet]})};
  },
  rpc(name,args){
   return {abortSignal:async signal=>{
    if(name==='current_user_has_permission'){assert.equal(args.permission_code,'reports.view');return {data:allowed};}
    if(name==='current_user_can_access_outlet')return {data:scope&&args.target_outlet_id===outlet.id};
    assert.equal(name,'reporting_monthly_scope_financials');rpcCalls.push(args);
    assert.equal(args.p_outlet_id,outlet.id);
    const m=args.p_month;
    concurrency.max=Math.max(concurrency.max,++concurrency.active);
    try{
     await new Promise(resolve=>setImmediate(resolve));
     const failure=onRead?.(args,signal);
     if(failure)return failure;
     const report={outlet:{...outlet,scope:'outlet',outlet_count:1},period:{year:args.p_year,month:m},
      financials:{purchase_based_cogs:Object.hasOwn(cogs,m)?present(cogs[m]):{amount:9999,presence:'missing'},
       opex:Object.hasOwn(opex,m)?present(opex[m]):{amount:8888,presence:'missing'},labour:present(654321)},
      extra_private_value:'not-in-evidence'};
     return {data:changeReport?changeReport(report):report};
    }finally{concurrency.active--;}
   }};
  },
 };
}

test('Finance Costs Text answers and saved scope reconcile against independent monthly Admin chart values',async()=>{
 const caller=callerFixture(),business=createBusinessDispatcher({caller,access,config});
 const prompt='Show the six-month operational cost trend for QA Corner ending February 2026. Give the monthly purchase-based COGS and recorded OPEX.';
 assert.equal((await business.planTurn(prompt)).intent,'cost_trend_6m');
 let evidence,steps=0;
 const result=await generateText({kind:'turn',model:config.model,prompt},'fixture',{
  business,onTool:(state,value)=>{if(state==='completed')evidence=value;},
  transport:async(_,init)=>{
   const body=JSON.parse(init.body);
   if(++steps===1){
    assert(body.tools.some(t=>t.name===reportRead.id));
    return Response.json({status:'completed',usage:{input_tokens:10,output_tokens:3},output:[{type:'function_call',name:reportRead.id,call_id:'read',
     arguments:JSON.stringify({...direct,measure:'financials',outlet_id:null,outlet_name:outlet.name})}]});
   }
   const value=JSON.parse(body.input.at(-1).output);
   assert.equal(value.cost_trend.months.length,6);assert.equal(value.report,undefined);
   assert.doesNotMatch(JSON.stringify(value),/654321|9999|8888|not-in-evidence/);
   return Response.json({status:'completed',usage:{input_tokens:10,output_tokens:3},output:[
    {type:'message',content:[{type:'output_text',text:'Labour costs were RM654321.'}]}]});
  },
 });
 assert.equal(steps,2);assert.equal(caller.rpcCalls.length,6);assert.equal(caller.concurrency.max,3);
 assert.equal(evidence.query_outcome,'SUCCESS');
 const source={scope:direct,chart_rows,outlet_name:outlet.name,provider:'feedx_reporting',capture:{environment:'staging',method:'admin_view',
  module_id:'finance_costs',authority:'/finance/costs',actor_ref:actor,at:evidence.as_of}};
 const turn={...result,evidence,actor_ref:actor,model:config.model,request_id:'fixture',state:'completed',tool_state:'completed',created_at:evidence.as_of};
 const check=(t=turn,s=source)=>certifyScenario('finance_operational_cost_trend',{turn:t,source:s});
 assert.equal(check().status,'PASS',JSON.stringify(check()));
 const [queued]=generateSourceCases({registerAnswers:[{...source,scenario:'finance_operational_cost_trend',scope_label:'For QA Corner in the six months ending February 2026'}]});
 assert.equal((await business.planTurn(queued.question))?.intent,'cost_trend_6m');
 assert.equal(check({...turn,reply:turn.reply.replace('RM0.00','unavailable')}).status,'FAIL');
 assert.equal(check(turn,{...source,chart_rows:chart_rows.slice(1)}).status,'FAIL');
 assert.equal(check(turn,{...source,provider:'demo'}).status,'FAIL');
 assert.equal(check(turn,{...source,capture:{...source.capture,module_id:'finance_overview',authority:'/finance/overview'}}).status,'FAIL');
 assert.equal(check(turn,{...source,chart_rows:chart_rows.map((row,index)=>index===0?{...row,labour:0}:row)}).status,'FAIL');
 assert.equal(check({...turn,reply:turn.reply.replace('| RM0.00 | RM91.00 |','| RM91.00 | RM0.00 |')}).status,'FAIL');
 assert.equal(check({...turn,reply:turn.reply.replace('Purchase-based COGS | Recorded OPEX','Recorded OPEX | Purchase-based COGS')}).status,'FAIL');
 assert.equal(check({...turn,reply:turn.reply+' Labour cost was RM4500.'}).status,'FAIL');
 const spoken=business.format(reportRead.id,evidence,prompt,{medium:'voice'});
 assert.match(spoken,/2026-01, Purchase-based COGS RM41.00, Recorded OPEX RM0.00/);
 assert.match(spoken,/Labour is not separately classified/);
 assert.doesNotMatch(spoken,/\||654321/);
 assert.deepEqual(reportRead.answerAmounts(evidence),[18.25,0,91,83,70.75,41,0]);
 assert.equal(reportRead.analysisObservations(evidence).length,7);
 let saved;
 const uuid=outlet.id;
 const voice=await dispatch({action:'realtime_tool',provider:'openai',session_id:uuid,request_id:uuid,turn_id:uuid,
  operation:reportRead.id,arguments:{...direct,measure:'financials',outlet_id:null,outlet_name:outlet.name}},{
  caller:callerFixture(),access,get:()=>undefined,reserveRealtime:async()=>{},
  rpc:async action=>action==='history'?{turns:[{request_id:uuid,voice_input_available:true,state:'running',prompt}]}:{config},
  voiceHistory:async(fields)=>{saved=fields.evidence;},
 });
 assert.deepEqual(saved.cost_trend,evidence.cost_trend);assert.equal(voice.answer_hint,spoken);assert.equal(voice.goal,undefined);
});

test('a local chart measure list leaves independently scoped or cross-domain goals intact',()=>{
 const b=createBusinessDispatcher({access:{permissions:Object.fromEntries(operations.map(op=>[op.permission,true]))},
  config:{...config,capability_connections:Object.fromEntries(operations.map(op=>[op.id,true]))}});
 const query='Show the six-month operational cost trend for QA Corner and ';
 for(const [clause,other] of [
  ['the 2026 operating expenses for Other Corner.','read_operating_expenses'],
  ['how many employees do we have?','read_employee_directory'],
  ['its recorded monthly supplier purchases for 2026.','read_purchase_comparison'],
 ])assert.deepEqual(b.planGoal(query+clause)?.map(step=>step.operation),[reportRead.id,other]);
 assert.equal(b.plan('Show six-month operational costs and recorded OPEX in MYR.')?.operation,reportRead.id);
 assert.deepEqual(b.planGoal('Show the operating expense amount for 2026 at QA Corner and the six-month operational cost trend for another outlet.')?.map(step=>step.operation),['read_operating_expenses',reportRead.id]);
 const financeOnly=createBusinessDispatcher({access,config});
 assert.equal(financeOnly.plan(query+'how many employees do we have?'),null);
});

test('rolling twelve months preserve monthly scope, prior compatibility, request bounds and authorization failures',async()=>{
 const caller=callerFixture();
 const trend=(await reportRead.execute(caller,{...direct,measure:'cost_trend_12m'})).cost_trend;
 assert.equal(trend.months.at(0).period,'2025-03');assert.equal(trend.months.at(-1).period,'2026-02');
 assert.equal(new Set(trend.months.map(row=>row.period)).size,12);assert.equal(caller.concurrency.max,3);
 assert.equal(reportRead.queryIntent('QA Corner 十二个月的运营成本趋势如何？'),'cost_trend_12m');
 assert.equal(reportRead.queryIntent('Tunjukkan trend kos operasi untuk enam bulan di QA Corner.'),'cost_trend_6m');
 const noScope=callerFixture();
 for(const change of [{outlet_id:null},{compare_year:2025,compare_month:1},{year:2000,month:1}]){
  await assert.rejects(reportRead.execute(noScope,{...direct,...change}),{code:'tool_arguments_invalid'});
 }
 assert.equal(noScope.rpcCalls.length,0);
 const noRole=callerFixture({allowed:false});
 await assert.rejects(reportRead.execute(noRole,direct),{code:'business_read_denied'});assert.equal(noRole.rpcCalls.length,0);
 const blocked=callerFixture({onRead:a=>a.p_month===10?{error:{code:'42501'}}:null});
 await assert.rejects(reportRead.execute(blocked,direct),{code:'business_read_denied'});assert.equal(blocked.rpcCalls.length,3);
 const crossed=callerFixture({changeReport:report=>({...report,outlet:{...report.outlet,id:'different'}})});
 await assert.rejects(reportRead.execute(crossed,direct),{code:'business_read_unavailable'});assert.equal(crossed.rpcCalls.length,3);
 const malformed=callerFixture({changeReport:report=>({...report,financials:{...report.financials,opex:present('')}})});
 await assert.rejects(reportRead.execute(malformed,direct),{code:'business_read_unavailable'});
 const controller=new AbortController(),cancelled=callerFixture({onRead:()=>controller.abort()});
 await assert.rejects(reportRead.execute(cancelled,direct,controller.signal),{name:'AbortError'});assert.equal(cancelled.rpcCalls.length,3);
 const original=await reportRead.execute(callerFixture(),{outlet_id:outlet.id,year:2026,month:2});
 assert.deepEqual(original.requested_scope,{...direct,measure:'financials'});assert.equal(original.cost_trend,undefined);
});
