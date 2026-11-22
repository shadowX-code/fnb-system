import {AssistantError} from '../assistantError.js';
import {invalidArgument,readContract,uuid} from '../assistant/readContract.js';

const year={type:'number',minimum:2000,maximum:2100};
const month={type:'number',minimum:1,maximum:12};
const rpc='reporting_monthly_scope_financials';
const argsFor=(outlet,year,month)=>({p_outlet_id:outlet,p_year:year,p_month:month});

export const reportRead=readContract({
 id:'read_operational_financials',module_id:'finance_overview',version:2,
 related_module_ids:['finance_statements','finance_analysis','finance_costs','dashboard','outlet-pnl','sp-dashboard'],
 label:'Operational monthly financials',permission:'reports.view',scope:'Canonical Reporting authorized outlets, MYR',source:'/finance/overview',
 discoveryPhrases:['monthly financials','operational revenue','monthly revenue','hasil bulanan','laporan kewangan bulanan','月度营收','月度營收','月度财务','月度財務'],
 description:'Use operational monthly reports for revenue, purchase-based costs, expenses and net profit. Set both compare_year and compare_month for a different period at one named outlet, or set both to null for a single report. Use a null outlet only for a single monthly report over the authorized Reporting scope. Preserve unavailable or incomplete values. No statutory or cash metrics.',
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
   if(error||!data)throw new AssistantError('business_read_unavailable',503);
   return data;
  }
  const report=await read(a.year,a.month);
  if(!a.compare_year)return {report};
  const comparison_report=await read(a.compare_year,a.compare_month);
  const first=report.outlet,second=comparison_report.outlet;
  if(!first||!second||first.scope!==second.scope||first.id!==second.id||first.outlet_count!==second.outlet_count||
   report.period?.year!==a.year||report.period?.month!==a.month||
   comparison_report.period?.year!==a.compare_year||comparison_report.period?.month!==a.compare_month)
   throw new AssistantError('business_read_unavailable',503);
  return {report,comparison_report};
 },
 project:data=>({...data,limitations:'Operational reporting only. Preserve missing/partial source indicators. A comparison needs recorded values from both periods; missing data is not zero.'}),
 interface:{queryKinds:['summary','period_comparison'],authority:rpc,fields:['report','comparison_report','limitations'],
  aggregates:'source_reported',pagination:'Two explicit periods at most. Each canonical report retains its own missing/partial flags.',
  unavailable:'Source incompleteness stays unavailable. No audit, statutory or cash-balance authority.'},
});
