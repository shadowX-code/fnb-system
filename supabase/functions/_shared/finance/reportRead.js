import {compareOperationalReports} from './operationalComparison.js';
import {AssistantError} from '../assistantError.js';
import {invalidArgument,readContract,uuid} from '../assistant/readContract.js';

const year={type:'number',minimum:2000,maximum:2100};
const month={type:'number',minimum:1,maximum:12};
const rpc='reporting_monthly_scope_financials';
const argsFor=(outlet,year,month)=>({p_outlet_id:outlet,p_year:year,p_month:month});
const financialMeasures={revenue:'Operational revenue',purchase_based_cogs:'Purchase-based cost of goods',
 opex:'Reported operating expenses',net_profit:'Operational management EBITDA'};
const reportMonth=report=>report.period.year+'-'+String(report.period.month).padStart(2,'0');

export const reportRead=readContract({
 answerAmounts(e){
  const amounts=[e.report,e.comparison_report].filter(Boolean).flatMap(report=>
   Object.values(report.financials).filter(value=>value.presence==='present').map(value=>value.amount));
  for(const [key,value] of Object.entries(e.analysis||{})){
   if(key==='ebitda_contributions_myr'&&value)amounts.push(...Object.values(value));
   else if(key.endsWith('_change_myr'))amounts.push(value);
  }
  return amounts;
 },
 analysisObservations(e){
  return [e.report,e.comparison_report].filter(report=>report?.outlet?.id).flatMap(report=>
   Object.entries(financialMeasures).filter(([key])=>report.financials?.[key]?.presence==='present').map(([key,metric])=>({
    metric,unit:'MYR',population:'reported outlet',grain:'month',
    period:reportMonth(report),outlet:report.outlet,
    value:report.financials[key].amount,
   })));
 },
 comparisonFacts(e){
  if(!e.comparison_report)return [];
  const reports=[e.comparison_report,e.report];
  const facts=[];
  for(const [key,label] of Object.entries(financialMeasures)){
   if(reports.every(r=>r.financials[key]?.presence==='present'))continue;
   for(const r of reports)facts.push({label,scope:r.outlet.name+' · '+reportMonth(r),unit:'MYR',
    value:r.financials[key]?.presence==='present'?r.financials[key].amount:null});
  }
  const scope=e.report.outlet.name+' · '+reportMonth(e.comparison_report)+' → '+reportMonth(e.report);
  const analysis=e.analysis;
  if(!analysis)return [...facts,{label:'Finance analysis',scope,value:e.analysis_limitation}];
  facts.push({label:'Performance zone',scope,value:analysis.performance_zone},
   {label:'Revenue growth',scope,value:analysis.revenue_growth_percent,unit:'%'},
   {label:'Management EBITDA margin',scope,value:analysis.ebitda_margin_percent,unit:'%'});
  const drivers=analysis.ebitda_contributions_myr;
  if(drivers){
   for(const [key,amount] of Object.entries(drivers))facts.push({label:'Contribution to EBITDA change · '+
    ({revenue:financialMeasures.revenue,purchase_based_cogs:financialMeasures.purchase_based_cogs,recorded_opex:financialMeasures.opex})[key],
    scope,value:amount,unit:'MYR'});
  }else facts.push({label:'EBITDA change attribution',scope,value:analysis.attribution});
  return facts;
 },
 id:'read_operational_financials',module_id:'finance_overview',version:2,
 related_module_ids:['finance_statements','finance_analysis','finance_costs','dashboard','outlet-pnl','sp-dashboard'],
 label:'Operational monthly financials',permission:'reports.view',scope:'Canonical Reporting authorized outlets, MYR',source:'/finance/overview',
 discoveryPhrases:['monthly financials','operational revenue','monthly revenue','hasil bulanan','laporan kewangan bulanan','月度营收','月度營收','月度财务','月度財務'],
 description:'Read monthly operational revenue, purchase-based costs, recorded operating expenses and management EBITDA. A current month and an earlier comparison month at one outlet also return its Finance performance zone, cost movements and reconciled EBITDA driver contributions when supported. Driver arithmetic does not establish business causation. Set both compare_year and compare_month for a different period at one named outlet, or set both to null for a single report. Use a null outlet only for a single monthly report over the authorized Reporting scope. Preserve unavailable or incomplete values. No statutory or cash metrics.',
 properties:{outlet_id:{...uuid,nullable:true},year,month,compare_year:{...year,nullable:true},compare_month:{...month,nullable:true}},
 normalizeArguments:args=>args&&typeof args==='object'&&!Array.isArray(args)
  ?{compare_year:null,compare_month:null,...args}:args,
 check(args){
  if((args.compare_year===null)!==(args.compare_month===null))
   invalidArgument('paired_period_required',args.compare_year===null?'compare_year':'compare_month');
  if(args.compare_year!==null&&!args.outlet_id)invalidArgument('comparison_requires_outlet','outlet_id');
  if(args.compare_year===args.year&&args.compare_month===args.month)
   invalidArgument('different_period_required','compare_month');
 },
 rpc,arguments:a=>argsFor(a.outlet_id,a.year,a.month),
 async load(caller,a,signal){
  async function read(y,m){
   const {data,error}=await caller.rpc(rpc,argsFor(a.outlet_id,y,m)).abortSignal(signal);
   if(error?.code==='42501')throw new AssistantError('business_read_denied',403);
   const outlet=data?.outlet;
   if(error||!outlet||outlet.id!==a.outlet_id||outlet.scope!==(a.outlet_id?'outlet':'all')||
    !Number.isSafeInteger(outlet.outlet_count)||outlet.outlet_count<1||(a.outlet_id&&outlet.outlet_count!==1)||
    data.period?.year!==y||data.period?.month!==m)throw new AssistantError('business_read_unavailable',503);
   return data;
  }
  const report=await read(a.year,a.month);
  if(!a.compare_year)return {report};
  const comparison_report=await read(a.compare_year,a.compare_month);
  const currentFollowsComparison = a.year*12+a.month > a.compare_year*12+a.compare_month;
  if(!currentFollowsComparison)return {report,comparison_report,analysis:null,
   analysis_limitation:'Finance performance analysis requires a comparison month before the current month.'};
  return {report,comparison_report,analysis:compareOperationalReports(report,comparison_report)};
 },
 project:data=>({...data,limitations:'Operational reporting only. Preserve missing/partial source indicators. A comparison needs recorded values from both periods; missing data is not zero.'}),
 interface:{semantics:{
  entities:['monthly operational report','outlet'],time:'Selected Reporting calendar month; compare the same outlet across explicit months.',
  relationships:['Reporting aggregates the Restaurant sales, purchase and expense authorities within the reporting scope.'],
  metrics:{
   revenue:{field:'report.financials.revenue.amount',unit:'MYR',definition:'Recorded sales amount for the reporting scope and month.'},
   purchase_based_cogs:{field:'report.financials.purchase_based_cogs.amount',unit:'MYR',definition:'Purchase-based operational cost. This basis differs from statutory COGS.'},
   operating_expenses:{field:'report.financials.opex.amount',unit:'MYR',definition:'Reported monthly outlet operating expense when the scope has recorded inputs.'},
   net_profit:{field:'report.financials.net_profit.amount',unit:'MYR',definition:'Operational management EBITDA, recorded as net_profit for compatibility: revenue less purchase-based costs and recorded operating expenses. Requires complete inputs.'},
   revenue_growth:{field:'analysis.revenue_growth_percent',unit:'percent',definition:'Current revenue growth relative to complete positive earlier revenue at the same outlet.'},
   ebitda_margin:{field:'analysis.ebitda_margin_percent',unit:'percent',definition:'Operational EBITDA as a share of complete positive current revenue.'},
   opex_change:{field:'analysis.recorded_opex_change_myr',unit:'MYR',definition:'Current minus comparison recorded operating expense when both amounts are complete.'},
   purchase_cost_change:{field:'analysis.purchase_based_cogs_change_myr',unit:'MYR',definition:'Current minus comparison posted purchase-based cost when both amounts are complete.'},
  }},queryKinds:['summary','period_comparison'],authority:rpc,fields:['report','comparison_report','analysis','analysis_limitation','limitations'],
  aggregates:'source_reported',pagination:'Two explicit periods at most. Each canonical report retains its own missing/partial flags.',
  unavailable:'Source incompleteness stays unavailable. No audit, statutory or cash-balance authority.'},
});
