import {AssistantError} from '../assistantError.js';
import {normalizedEntity,resolveOutlet} from '../assistant/entityResolution.js';
import {invalidArgument,page,permittedOutlet,uuid} from '../assistant/readContract.js';
import {malaysiaPeriod} from './assistantBusinessPeriod.js';
import {getPurchaseTotal,sumAmount} from './analytics.js';

const textFilter={type:'string',nullable:true,maxLength:120};
export const purchaseOutletFields={outlet_id:{...uuid,nullable:true},outlet_name:textFilter};
export const supplierFilter={page,supplier_name:textFilter};
export const purchasePageSize=scope=>['supplier_year','supplier_month','supplier_totals'].includes(scope.mode)?10:20;
export function validatePurchaseScope(a){
 if(a.outlet_name!=null&&!a.outlet_name.trim())invalidArgument('nonblank_text_or_null','outlet_name');
 if(a.supplier_name!==null&&!a.supplier_name?.trim())invalidArgument('nonblank_text_or_null','supplier_name');
}
export async function purchaseOutlet(caller,a,signal){
 if(!a.outlet_name&&!a.outlet_id)throw new AssistantError('entity_scope_required',409);
 if(a.outlet_name){
  const found=await resolveOutlet(caller,a,signal);
  if(!found)throw new AssistantError('entity_unresolved',409);
  if(a.outlet_id&&a.outlet_id!==found.id)throw new AssistantError('entity_ambiguous',409);
  return found;
 }
 await permittedOutlet(caller,a.outlet_id,signal);
 return {id:a.outlet_id};
}
export function supplierPurchaseIntent(prompt){
 // Other FeedX authorities own purchase orders, Factory receipts and financial statements.
 if(/\b(?:factory|warehouse|purchase orders?|invoices?|payments?|accounts payable|cogs|gross profit|kilang|pesanan belian|invois|bayaran)\b|工厂|工廠|采购订单|採購訂單|付款|发票|發票|应付账|應付帳/iu.test(prompt))return null;
 const purchase=/\b(?:purchases?|purchasing|pembelian|belian)\b|采购|採購|进货|進貨/iu.test(prompt);
 const suppliers=/\b(?:suppliers?|vendors?|pembekal)\b|供应商|供應商/iu.test(prompt);
 const series=/\b(?:monthly|each month|every month|by month|month.by.month|annual(?:ly)?|yearly|this year|last year|bulanan|setiap bulan|mengikut bulan|tahunan|tahun ini|sepanjang tahun)\b|每个?月|每個月|逐月|按月|全年|一年|年度|今年|本年|去年/iu.test(prompt);
 const total=/\b(?:how much|total|spend|spent|amounts?|jumlah|amaun|berapa)\b|金额|金額|多少|总额|總額|合计|合計/iu.test(prompt);
 const year=/\b20\d{2}\b/u.test(prompt);
 if(!purchase||(!series&&!year&&(!suppliers||!total)))return null;
 return series||year?'supplier_year':'supplier_month';
}
function recordedPurchasePeriod(prompt){
 const years=[...new Set(prompt.match(/\b20\d{2}\b/gu)||[])];
 if(years.length>1||/\b(?:between|compare|versus|bandingkan|from .{1,40} to )\b|对比|對比/iu.test(prompt))return null;
 const year=years[0]||malaysiaPeriod(/\b(?:last year|previous year|tahun lepas)\b|去年|上年/iu.test(prompt)?'previous_year':'year').year;
 const iso=prompt.match(/\b20\d{2}-(0[1-9]|1[0-2])(?:-01)?\b/u);
 if(iso)return {mode:'supplier_month',month:year+'-'+iso[1]+'-01'};
 const relativeMonth=/\b(?:last month|bulan lepas)\b|上个?月|上個月/iu.test(prompt)?'previous_month':/\b(?:this month|bulan ini)\b|本月|[这這][个個]?月/iu.test(prompt)?'month':null;
 if(relativeMonth)return {mode:'supplier_month',month:malaysiaPeriod(relativeMonth).from};
 // Leave named-month and other range selection to validated explicit arguments.
 if(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|januari|februari|mac|mei|jun|julai|ogos|oktober|disember|quarter|suku|weeks?)\b|\d{1,2}\s*月|季度/iu.test(prompt))return null;
 if(!years.length&&!/\b(?:monthly|each month|every month|by month|month.by.month|annual(?:ly)?|yearly|this year|last year|tahun ini|tahun lepas|bulanan|setiap bulan|mengikut bulan|tahunan)\b|每个?月|每個月|逐月|按月|全年|今年|本年|去年|年度/iu.test(prompt))return null;
 return {mode:'supplier_year',month:year+'-01-01'};
}
export function prepareRecordedPurchases(prompt){
 if(!supplierPurchaseIntent(prompt)||/\b(?:by supplier|per supplier|each supplier|for (?:the )?supplier|supplier named|by vendor|top|rank|largest|highest|and (?:also )?(?:show|list|give)|categor\w*|efficiency|mengikut pembekal|kategori|from|daripada)\b|按供[应應]商|排名|最高|类别|類別|效率|来自|來自/iu.test(prompt))return null;
 const period=recordedPurchasePeriod(prompt);
 return period?{...period,supplier_name:null,page:1}:null;
}
export function followRecordedPurchases(prompt,evidence){
 if(!['supplier_year','supplier_month'].includes(evidence.requested_scope?.mode)||!evidence.outlet?.id)return null;
 const text=prompt.trim().replace(/[?？!.。]+$/u,'');
 const detail=/^(?:(?:and |also )?(?:(?:show|give) (?:me )?(?:the )?)?(?:monthly breakdown|breakdown by month|month by month)|每月明细|每个月呢|每個月呢|逐月明細|pecahan bulanan)$/iu.test(text);
 const periodOnly=/^(?:(?:and |what about |how about |for |dan |bagaimana dengan |那么|那) *)?(?:20\d{2}(?:-(?:0[1-9]|1[0-2]))?|this year|last year|this month|last month|tahun ini|tahun lepas|bulan ini|bulan lepas|今年|去年|本月|上月)\s*(?:呢)?$/iu.test(text);
 if(!detail&&!periodOnly)return null;
 const range=detail?{mode:'supplier_year',month:String(evidence.year)+'-01-01'}:recordedPurchasePeriod(text);
 return range?{...range,outlet_id:evidence.outlet.id,outlet_name:evidence.outlet.name??null,supplier_name:evidence.requested_scope.supplier_name??null,page:1}:null;
}
const money=value=>Number(value.toFixed(2));

// Same Purchase Input/Comparison source, SUM definition and outlet/month boundaries.
// A single exact-count statement prevents a truncated list from turning into a total.
export async function loadSupplierPurchases(caller,a,outlet,yearWide,signal){
 const year=Number(a.month.slice(0,4)),month=Number(a.month.slice(5,7));
 let query=caller.from('purchase_records').select('id,outlet_id,year,month,supplier_id,amount,supplier:suppliers(name)',{count:'exact'})
  .eq('outlet_id',outlet.id).eq('year',year);
 if(!yearWide)query=query.eq('month',month);
 const {data,count,error}=await query.order('id').limit(1000).abortSignal(signal);
 if(error||!Array.isArray(data)||!Number.isSafeInteger(count)||count<0)throw new AssistantError(error?.code==='42501'?'business_read_denied':'business_read_unavailable',error?.code==='42501'?403:503);
 if(count>1000||count>data.length)throw new AssistantError('business_result_limit',413);
 if(count!==data.length||new Set(data.map(r=>r.id)).size!==count||data.some(r=>!r.id||r.outlet_id!==outlet.id||r.year!==year||!Number.isInteger(r.month)||r.month<1||r.month>12||!yearWide&&r.month!==month||r.amount==null||!Number.isFinite(Number(r.amount))))throw new AssistantError('business_read_unavailable',503);
 const groups=new Map();
 for(const row of data){
  const id=row.supplier_id||null;
  if(!groups.has(id))groups.set(id,{id,name:row.supplier?.name||null,records:[]});
  groups.get(id).records.push(row);
 }
 let selected=[...groups.values()];
 if(a.supplier_name){
  // An assigned supplier with a hidden name cannot safely be included or excluded by name.
  if(selected.some(group=>group.id&&!group.name))throw new AssistantError('business_read_unavailable',503);
  const match=normalizedEntity(selected.filter(group=>group.id),a.supplier_name,['name']);
  selected=match?[match]:[];
 }
 const months=yearWide?Array.from({length:12},(_,index)=>index+1):[month];
 const records=a.supplier_name?selected.flatMap(group=>group.records):data;
 const monthly_totals=months.map(m=>{
  const entry_count=records.filter(row=>row.month===m).length;
  return {month:m,entry_count,amount:entry_count?money(getPurchaseTotal(records,outlet.id,m,year)):null};
 });
 const supplierRows=selected.map(group=>({supplier_name:group.name,...(!group.name?{supplier_label_state:group.id?'unavailable':'unassigned'}:{}),entry_count:group.records.length,
  amount:money(sumAmount(group.records))
 })).sort((a,b)=>b.amount-a.amount||String(a.supplier_name||'').localeCompare(b.supplier_name||''));
 // The input statement's stable ID order also resolves identical amount/name ties.
 const pageSize=purchasePageSize(a),offset=(a.page-1)*pageSize,rows=supplierRows.slice(offset,offset+pageSize);
 const missing_months=monthly_totals.filter(m=>m.amount===null).map(m=>m.month);
 return {outlet,year,currency:'MYR',monthly_totals,recorded_total:records.length?money(sumAmount(records)):null,
  match_status:records.length?'matched':'not_found',match_scope:'Recorded purchase entries in this outlet and period; no conclusion about supplier master existence.',
  entry_count:records.length,missing_months,period_complete:!missing_months.length,aggregate_complete:true,
  total_matching:supplierRows.length,page:a.page,page_size:pageSize,pageable:true,rows,returned_count:rows.length,truncated:offset+pageSize<supplierRows.length,
  count_scope:'Monthly and period totals use all matching saved purchase entries, independent of sales entries. Months without purchase entries are unavailable. Supplier rows show recorded purchase amounts; total_matching includes an unassigned group if present. A supplier is not a purchase category; category totals are unavailable in this projection.'};
}
// Return only literal monetary fields that the owning read actually observed.
// Numeric Postgres decimals on an entry may also arrive as strings.
export function purchaseAnswerAmounts(evidence){
 const amounts=[evidence.recorded_total,...(evidence.monthly_totals||[]).map(row=>row.amount),
  ...(evidence.rows||[]).map(row=>row.amount)];
 for(const month of evidence.months||[]){
  if(month.purchase_record_count>0)amounts.push(month.recorded_purchase_amount);
  const values=month.values;
  if(!values||!month.sales_record_count||!month.purchase_record_count)continue;
  amounts.push(values.netSales,values.totalPurchase,values.grossProfitEstimate);
  if(month.previous_sales_record_count>0)amounts.push(values.previousNetSales);
  if(month.previous_purchase_record_count>0)amounts.push(values.previousPurchase);
 }
 return amounts.flatMap(value=>Number.isFinite(value)?[value]:
  typeof value==='string'&&/^-?\d+(?:\.\d+)?$/u.test(value)&&Number.isFinite(Number(value))?[Number(value)]:[]);
}

function annualCategoryLimitation(e,prompt=''){
 if(e.requested_scope?.mode!=='supplier_year'||!/(?:\bcategor(?:y|ies)\b|\bkategori\b|分类|分類|类别|類別)/iu.test(prompt))return null;
 const name=e.outlet?.name||e.requested_scope.outlet_name;
 const amount=e.recorded_total==null?null:'RM '+new Intl.NumberFormat('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}).format(e.recorded_total);
 const periods=12-e.missing_months.length;
 if(/\p{Script=Han}/u.test(prompt))return (name||'该门店')+' '+e.year+' 年'+(amount===null?'没有采购记录。':'有 '+periods+' 个月的采购记录，共 '+amount+'。')+'这项年度汇总可按供应商查看，暂不提供采购类别明细。';
 if(/\b(?:kategori|pembelian|belian|pembekal)\b/iu.test(prompt))return (name||'Cawangan ini')+' ('+e.year+')'+(amount===null?' tiada rekod pembelian.':' merekodkan pembelian '+amount+' sepanjang '+periods+' bulan.')+' Pecahan tahunan mengikut kategori tidak tersedia dalam ringkasan pembekal ini.';
 return (name||'This outlet')+' ('+e.year+') '+(amount===null?'has no recorded purchases.':'recorded '+amount+' in purchases across '+periods+' months with entries.')+' The annual supplier summary does not provide a purchase-category breakdown.';
}

function monthRanges(months,label,range){
 const groups=[];
 for(const month of months){
  const last=groups.at(-1);
  if(last&&month===last[1]+1)last[1]=month;
  else groups.push([month,month]);
 }
 return groups.map(([start,end])=>start===end?label(start):label(start)+range+label(end));
}

// This owner can answer its period figures without trusting the order, rounding
// or omission of a provider's proposed amounts. The separate supplier page is
// not a purchase-entry count. Never use it to reconstruct these totals.
export function formatSupplierPurchases(e,prompt='',{medium='text'}={}){
 const category=annualCategoryLimitation(e,prompt);
 if(category)return category;
 const scope=e.requested_scope||{};
 if(!['supplier_year','supplier_month','supplier_totals'].includes(scope.mode)||e.currency!=='MYR'||e.aggregate_complete!==true)return null;
 const annual=scope.mode==='supplier_year';
 const month=Number(scope.month?.slice(5,7));
 if(!/^20\d\d-(?:0[1-9]|1[0-2])-01$/u.test(scope.month)||e.year!==Number(scope.month.slice(0,4))||!e.outlet?.id||
  (scope.outlet_id&&scope.outlet_id!==e.outlet.id))return null;
 // Supplier rankings, comparisons and detail pages need their own evidence
 // synthesis; a period total alone would discard those requested dimensions.
 if(/\b(?:top|rank(?:ed|ing)?|by supplier|each supplier|per supplier|largest|highest|list|compare|difference|why|kategori|ikut pembekal|setiap pembekal|tertinggi|bandingkan)\b|排名|排行|按供应商|按供應商|每[个個家]供[应應]商|最高|明细|明細|对比|對比|原因/iu.test(prompt)||scope.page>1)return null;
 const rows=e.monthly_totals;
 if(!Array.isArray(rows)||rows.length!==(annual?12:1)||!rows.every((r,i)=>r.month===(annual?i+1:month)&&Number.isSafeInteger(r.entry_count)&&r.entry_count>=0&&
   (r.entry_count===0?r.amount===null:Number.isFinite(r.amount))))return null;
 const entered=rows.filter(r=>r.entry_count>0),missing=rows.filter(r=>r.entry_count===0).map(r=>r.month);
 if(!Array.isArray(e.missing_months)||missing.length!==e.missing_months.length||missing.some((m,i)=>m!==e.missing_months[i])||
  e.entry_count!==rows.reduce((n,r)=>n+r.entry_count,0)||
  (entered.length?!Number.isFinite(e.recorded_total)||Math.round(e.recorded_total*100)!==entered.reduce((n,r)=>n+Math.round(r.amount*100),0):e.recorded_total!==null))return null;
 const zh=/\p{Script=Han}/u.test(prompt),ms=!zh&&/\b(?:pembelian|pembekal|belian|jumlah|bulan|tahun|berapa(?:kah)?)\b/iu.test(prompt);
 const locale=zh?'zh-MY':ms?'ms-MY':'en-MY';
 const name=e.outlet.name||scope.outlet_name||(zh?'该门店':ms?'Cawangan ini':'This outlet');
 const subject=scope.supplier_name?name+' · '+scope.supplier_name:name;
 const fmt=new Intl.NumberFormat(locale,{minimumFractionDigits:2,maximumFractionDigits:2});
 const money=n=>'RM '+fmt.format(n);
 const labeler=new Intl.DateTimeFormat(locale,{month:'long',timeZone:'UTC'});
 const label=m=>zh?m+'月':labeler.format(new Date(Date.UTC(e.year,m-1,1)));
 const period=annual?e.year:zh?e.year+' 年 '+label(month):label(month)+' '+e.year;
 if(!entered.length)return zh?`${subject} ${period} 没有采购记录。`:ms?`Tiada pembelian direkodkan untuk ${subject} pada ${period}.`:`No purchases were recorded for ${subject} in ${period}.`;
 const total=money(e.recorded_total);
 const main=zh?`${subject} ${period}${annual?' 年全年':''}已记录的采购额为 ${total}。`:ms?`Jumlah pembelian yang direkodkan untuk ${subject} pada ${period} ialah ${total}.`:`${subject} recorded ${annual?'an annual total of ':''}${total} in purchases in ${period}.`;
 if(!annual)return main;
 const list=medium!=='voice'||/\b(?:monthly|month.by.month|by month|every month|each month|bulanan|setiap bulan)\b|每个?月|每個月|按月|逐月/iu.test(prompt);
 const parts=[main];
 if(list||/breakdown|pecahan|明细|明細/iu.test(prompt))parts.push(entered.map(row=>label(row.month)+' '+money(row.amount)).join(zh?'，':', ')+(zh?'。':'.'));
 if(missing.length){
  const periods=monthRanges(missing,label,zh?'至':ms?' hingga ':' to ').join(zh?'、':', ');
  parts.push(zh?periods+'没有采购记录。':ms?'Tiada rekod pembelian untuk '+periods+'.':'No purchase entries for '+periods+'.');
 }
 if(/\b(?:analy[sz]e|trend|analisis|analisa)\b|分析|趋势|趨勢/iu.test(prompt)&&entered.length>1){
  const peak=entered.reduce((a,b)=>b.amount>a.amount?b:a);
  parts.push(zh?'有记录的月份中，'+label(peak.month)+'最高（'+money(peak.amount)+'）。':ms?label(peak.month)+' mencatat jumlah tertinggi ('+money(peak.amount)+').':label(peak.month)+' was the highest recorded month ('+money(peak.amount)+').');
 }
 return parts.join(medium==='voice'?' ':'\n');
}

export const supplierPurchaseMetrics={
 recorded_purchases_myr:{field:'recorded_total',unit:'MYR',definition:'Sum of all recorded purchase entries for the selected outlet and period, optionally narrowed to one named supplier.'},
 monthly_purchases_myr:{field:'monthly_totals[].amount',unit:'MYR',definition:'Recorded purchase total for the calendar month. No purchase entries gives null, while a saved zero amount remains zero.'},
 supplier_purchases_myr:{field:'rows[].amount',unit:'MYR',definition:'Recorded amount by supplier across the selected period. Multiple categories for a supplier contribute once each.'},
};
