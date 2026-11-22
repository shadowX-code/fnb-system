import {malaysiaPeriod,relativeBusinessPeriod} from './assistantBusinessPeriod.js';
import {operatingExpenseAmount} from './operatingExpenseAmounts.js';
import {AssistantError} from '../assistantError.js';
import {resolveOutlet,sourceRows} from '../assistant/entityResolution.js';
import {invalidArgument,month,page,pick,readContract,uuid} from '../assistant/readContract.js';

const subject=/\b(?:operating expenses?|operational expenses?|opex|perbelanjaan operasi|kos operasi)\b|营运开支|營運開支|运营开支|營運費用|营运费用|运营费用|營業費用|营业费用/iu;
const accounting=/\b(?:p&l|profit and loss|net profit|financial statements?|cash flow|cash movements?|accounts? payable)\b|损益|損益|现金流|現金流/iu;
const fields=['id','year','month','amount','updated_at'];

export const operatingExpenseRead=readContract({
 id:'read_operating_expenses',version:2,module_id:'operating-expenses',label:'Restaurant Operating Expenses',
 permission:'operating_expenses.view',source:'/restaurant/operations/operating-expenses',
 answerAmounts:e=>[e.total_amount,...e.rows.map(row=>row.amount==null?null:Number(row.amount))],
 nextCheck(e,language){
  const now=malaysiaPeriod('month',new Date(e.as_of)).from;
  const elapsed=e.missing_months.filter(month=>e.year+'-'+String(month).padStart(2,'0')+'-01'<now).length;
  if(language==='zh')return elapsed?'先核对已过但未录入的 '+elapsed+' 个月，再比较费用。该来源只有月度录入总额。':'比较同一门店已有记录的同等期间。这里只记录每月总额，不能确定具体变动原因。';
  if(language==='ms')return elapsed?'Semak '+elapsed+' bulan lepas tanpa rekod sebelum membandingkan kos. Sumber ini hanya merekodkan jumlah bulanan.':'Bandingkan tempoh setara yang telah direkodkan bagi cawangan yang sama. Jumlah bulanan sahaja tidak menjelaskan puncanya.';
  return elapsed?'Check the '+elapsed+' past month'+(elapsed===1?'':'s')+' without entries before comparing costs. This source records monthly totals only.':
   'Compare equivalent recorded periods at the same outlet. Monthly totals alone cannot establish what caused a change.';
 },
 analysisObservations(e){
  // Annual entries can be incomplete; the recorded sum is not a comparable full year.
  if(!e.period_complete||!e.aggregate_complete||e.currency!=='MYR')return [];
  const month=e.requested_scope.month;
  return [{metric:'Recorded operating expense',unit:e.currency,outlet:e.outlet,population:'all entered operating expenses',
   grain:month?'month':'year',period:month?month.slice(0,7):String(e.year),value:e.total_amount}];
 },
 scope:'Recorded monthly Restaurant Operating Expenses amounts for one authorized outlet and one calendar year or month.',
 discoveryPhrases:['restaurant operating expenses','outlet operating expenses','opex','perbelanjaan operasi','运营费用','營運費用'],
 queryIntent(prompt){
  if(subject.test(prompt)&&!accounting.test(prompt))return 'recorded_operating_expenses';
  return null;
 },
 description:'Read Restaurant Operating Expenses entered for an outlet. Use year for totals and recorded month amounts; use month in YYYY-MM-01 format for one month. Amounts are MYR. Report missing months separately. Category breakdowns and transaction details are not stored by Operating Expenses. Do not substitute accounting expenses, cash movements or P&L.',
 properties:{page,outlet_id:{...uuid,nullable:true},outlet_name:{type:'string',maxLength:120,nullable:true},
  month:{...month,nullable:true},year:{type:'integer',minimum:2000,maximum:2099,nullable:true}},
 normalizeArguments(args){
  if(!args||typeof args!=='object'||Array.isArray(args))return args;
  return {page:1,outlet_id:null,outlet_name:null,month:null,year:null,...args};
 },
 check(args){
  if(args.page!==1)invalidArgument('unsupported_value','page');
  if(!args.month&&!args.year)invalidArgument('missing_field','year');
  if(args.month&&args.year&&Number(args.month.slice(0,4))!==args.year)invalidArgument('invalid_date_range','month');
 },
 prepareArguments(prompt){
  if(/\b(?:categor(?:y|ies)|transactions?|compared?|versus|quarter|between|through|since|until|ytd|year.to.date)\b|分类|分類|交易|对比|對比|季度|截至|至今/iu.test(prompt))return null;
  const years=[...new Set(prompt.match(/\b20\d{2}\b/g)||[])];
  if(years.length>1||/\b(?:January|February|March|April|May|June|July|August|September|October|November|December|monthly|last month|this month)\b|\d+\s*月|上月|本月/iu.test(prompt))return null;
  if(years.length===1)return {year:Number(years[0]),month:null,page:1};
  if(/\b(?:current year|this year|tahun ini)\b|今年|本年/iu.test(prompt))return {year:malaysiaPeriod('year').year,month:null,page:1};
  return null;
 },
 followUp(prompt,evidence){
  if(evidence.version!==2||!evidence.outlet?.id)return null;
  const wording=prompt.replace(/^(?:what about |how about |only |for |那|那么|那麼)/iu,'');
  const relative=relativeBusinessPeriod(wording);
  if(!relative)return null;
  const period=malaysiaPeriod(relative);
  return {outlet_id:evidence.outlet.id,year:period.year,month:relative.endsWith('month')?period.from:null,page:1};
 },
 async load(caller,args,signal){
  if(!args.outlet_name&&!args.outlet_id)throw new AssistantError('entity_scope_required',409);
  const outlet=await resolveOutlet(caller,args,signal);
  if(!outlet)throw new AssistantError('entity_unresolved',409);
  const year=args.year??Number(args.month.slice(0,4));
  const months=args.month?[Number(args.month.slice(5,7))]:Array.from({length:12},(_,i)=>i+1);
  const rows=await sourceRows(caller.from('operating_expenses').select(fields.join(',')).eq('outlet_id',outlet.id)
   .eq('year',year).in('month',months).order('month').limit(13),signal);
  const recorded=new Set(rows.map(row=>row.month));
  if(rows.length!==recorded.size||rows.some(row=>!months.includes(row.month)||row.amount==null||!Number.isFinite(Number(row.amount))))
   throw new AssistantError('business_read_unavailable',503);
  return {outlet,year,currency:'MYR',rows:rows.map(row=>pick(row,fields)),recorded_months:rows.length,missing_months:months.filter(m=>!recorded.has(m)),
   total_amount:rows.length?rows.reduce((sum,row)=>sum+operatingExpenseAmount(row.amount),0):null,aggregate_complete:true,
   period_complete:rows.length===months.length,match_status:rows.length?'matched':'not_found'};
 },
 project:data=>data,
 format(evidence,prompt=''){
  if(/\b(?:categor(?:y|ies)|transactions?|compared?|versus|quarter|between|through|since|until|ytd|year.to.date)\b|分类|分類|交易|对比|對比|季度|截至|至今/iu.test(prompt))return null;
  const {outlet,year,recorded_months:count,missing_months:missing,requested_scope:scope}=evidence;
  const period=scope.month?.slice(0,7)||year;
  const amount=new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR'}).format(evidence.total_amount);
  if(/\p{Script=Han}/u.test(prompt))return count
   ?outlet.name+' '+period+' 已记录的营业费用为 '+amount+'（'+count+' 个月有记录，'+missing.length+' 个月未录入）。'
   :outlet.name+' '+period+' 没有已记录的营业费用。';
  if(/\b(?:perbelanjaan|tahun ini|kos operasi)\b/iu.test(prompt))return count
   ?'Perbelanjaan operasi '+outlet.name+' untuk '+period+' ialah '+amount+' berdasarkan '+count+' bulan yang direkodkan.'
   :'Tiada perbelanjaan operasi direkodkan untuk '+outlet.name+' bagi '+period+'.';
  return count
   ?outlet.name+' recorded '+amount+' in operating expenses for '+period+
    (scope.month?'.':' ('+count+' of '+(count+missing.length)+' months recorded).')
   :'No operating expenses were recorded for '+outlet.name+' in '+period+'.';
 },
 interface:{authority:'Restaurant Operating Expenses service · operating_expenses, unique outlet/year/month',
  fields,queryKinds:['summary','list','detail','filter'],semantics:{
   entities:['monthly operating expense','outlet'],time:'Calendar month or year of entry. A missing month is unknown.',
   relationships:['Each outlet has at most one recorded expense amount per month. The source does not store transaction or category detail.'],
   metrics:{
    recorded_operating_expense_myr:{field:'total_amount',unit:'MYR',definition:'Sum of entered monthly amounts in the selected period, with missing months reported separately.'},
    months_recorded:{field:'recorded_months',unit:'months',definition:'Number of distinct months with an entered amount in the selected period.'},
   }},
  aggregates:'complete_recorded_period',pagination:'Unique outlet-month inputs; up to 12 records per year. Missing months are not zero.',
  unsupported:['Category amounts, underlying transactions, accounting expense classifications, cash movements and P&L are not in this source.']},
});
