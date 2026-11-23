import {monthlyFinancialDataset} from './monthlyReporting.js';
import {operationalEvidence} from './operationalComparison.js';
import {AssistantError} from '../assistantError.js';

export const costWindows={cost_trend_6m:6,cost_trend_12m:12};

export function costTrendIntent(prompt) {
 // An inventory price, supplier's purchases or a statutory expense series is a different authority.
 if(!/\b(?:purchase[- ]based COGS|COGS|OPEX|operational cost(?:s)?|finance cost(?:s)?|cost trend|trend kos|kos operasi)\b|运营成本|營運成本|经营成本|經營成本|采购成本.{0,10}(?:费用|費用)|财务成本|財務成本/iu.test(prompt) ||
    /\b(?:statutory|accounting|inventory valuation|per unit|percent|percentage|forecast|by category|margin|supplier|all outlets)\b|%|法定|会计|會計|预测|預測|按类别|按類別|供应商|供應商|全部门店|所有门店/iu.test(prompt))return null;
 const six=/\b(?:six|6|enam)[ -]?(?:month|bulan)s?\b|(?:六|6)\s*[个個]?月/iu.test(prompt);
 const twelve=/\b(?:twelve|12|dua belas)[ -]?(?:month|bulan)s?\b|(?:十二|12)\s*[个個]?月/iu.test(prompt);
 return six!==twelve?(six?'cost_trend_6m':'cost_trend_12m'):null;
}

// In the Costs chart, COGS and recorded OPEX are columns of the same outlet
// and period series. A separately qualified expense or other request remains
// eligible for independent planning and authorization.
export function ownsCostMeasureList(prompt,clauses,competitors) {
 if(!costTrendIntent(prompt)||competitors.some(id=>id!=='read_operating_expenses'))return false;
 const parts=clauses.flatMap(clause=>clause.split(/[.!。]+/u)).map(s=>s.trim()).filter(Boolean);
 if(parts.length<2||!costTrendIntent(parts[0]))return false;
 const measure=/^(?:(?:show|give|include|list|monthly|the|any|both|corresponding|recorded)\s+)*(?:purchase[- ]based COGS|COGS|(?:recorded )?(?:OPEX|operating expenses)|(?:separate )?labou?r(?: cost)?(?: limitation)?|(?:已记录|已記錄)?(?:营运费用|營運費用)|采购口径成本|採購口徑成本|人工成本|kos belian|belanja operasi(?: direkod)?|kos buruh)(?:\s+(?:by month|in MYR))?[,，]?$/iu;
 return parts.slice(1).every(part=>measure.test(part));
}

export async function readCostTrend(args,read,signal) {
 const length=costWindows[args.measure],months=[];
 const end=12*args.year+args.month-1;
 const controller=new AbortController();
 const batchSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 let outlet;
 try {
  for(let start=end-length+1;start<=end;start+=3){
   batchSignal.throwIfAborted();
   const results=await Promise.all(Array.from({length:Math.min(3,end-start+1)},(_,index)=>{
    const position=start+index;
    return read(Math.floor(position/12),position%12+1,batchSignal);
   }));
   batchSignal.throwIfAborted();
   for(const report of results){
    const metrics=[report.financials?.purchase_based_cogs,report.financials?.opex];
    if(typeof report.outlet.name!=='string'||!report.outlet.name.trim()||
     metrics.some(m=>!m||!['present','partial','missing'].includes(m.presence)||m.presence==='present'&&!Number.isFinite(m.amount)))
     throw new AssistantError('business_read_unavailable',503);
    const {financials}=monthlyFinancialDataset(report);
    const values=operationalEvidence(financials,[{semantic:'OPERATIONAL'}]);
    outlet={id:report.outlet.id,name:report.outlet.name};
    months.push({period:report.period.year+'-'+String(report.period.month).padStart(2,'0'),
     purchase_based_cogs:values.cogs.value,recorded_opex:values.opex.value});
   }
  }
 }catch(error){controller.abort();throw error;}
 return {outlet,currency:'MYR',window_months:length,months,labour:'unavailable'};
}

export function formatCostTrend(trend,prompt='',options={}) {
 const zh=/\p{Script=Han}/u.test(prompt),ms=!zh&&/\b(?:kos|bulan|cawangan|trend bulanan)\b/iu.test(prompt);
 const missing=zh?'无可用数据':ms?'tiada data':'unavailable';
 const cogs=zh?'采购口径成本':ms?'Kos berasaskan belian':'Purchase-based COGS';
 const opex=zh?'已记录营运费用':ms?'Belanja operasi direkod':'Recorded OPEX';
 const labour=zh?'没有单独核算的人工成本。':ms?'Kos buruh tidak diasingkan.':'Labour is not separately classified.';
 const money=n=>n===null?missing:'RM'+new Intl.NumberFormat('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
 const first=trend.months[0],last=trend.months.at(-1);
 const title=trend.outlet.name+' · '+first.period+' – '+last.period;
 if(options.medium==='voice'){
  const latest=trend.months.findLast(m=>m.purchase_based_cogs!==null||m.recorded_opex!==null);
  if(!latest)return title+(zh?'：这段期间没有可用的月度成本数据。':ms?' — Tiada kos bulanan tersedia.':' — No monthly cost figures available.')+' '+labour;
  return title+' — '+(zh?'最近有数据的月份':ms?'Bulan terkini dengan data':'Latest month with figures')+' '+latest.period+
   ', '+cogs+' '+money(latest.purchase_based_cogs)+', '+opex+' '+money(latest.recorded_opex)+'. '+labour;
 }
 const header=[zh?'月份':ms?'Bulan':'Month',cogs,opex];
 const rows=trend.months.map(m=>[m.period,money(m.purchase_based_cogs),money(m.recorded_opex)]);
 return title+'\n\n'+[header,['---','---','---'],...rows].map(row=>'| '+row.join(' | ')+' |').join('\n')+'\n\n'+labour;
}
