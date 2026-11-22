import {AssistantError} from '../assistantError.js';
import {normalizedEntity,resolveOutlet} from '../assistant/entityResolution.js';
import {invalidArgument,page,permittedOutlet,uuid} from '../assistant/readContract.js';
import {getPurchaseTotal,sumAmount} from './analytics.js';

const textFilter={type:'string',nullable:true,maxLength:120};
export const purchaseOutletFields={outlet_id:{...uuid,nullable:true},outlet_name:textFilter};
export const supplierFilter={page,supplier_name:textFilter};
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
 const series=/\b(?:monthly|each month|every month|by month|month.by.month|annual(?:ly)?|yearly|this year|last year|bulanan|setiap bulan|mengikut bulan|tahunan|tahun ini|sepanjang tahun)\b|每个?月|每個月|逐月|按月|全年|一年|年度/iu.test(prompt);
 const total=/\b(?:how much|total|spend|spent|amounts?|jumlah|amaun|berapa)\b|金额|金額|多少|总额|總額|合计|合計/iu.test(prompt);
 if(!purchase||(!series&&!suppliers)||(!series&&!total))return null;
 return series?'supplier_year':'supplier_month';
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
 const pageSize=10,offset=(a.page-1)*pageSize,rows=supplierRows.slice(offset,offset+pageSize);
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

export function annualCategoryLimitation(e,prompt=''){
 if(e.requested_scope?.mode!=='supplier_year'||!/(?:\bcategor(?:y|ies)\b|\bkategori\b|分类|分類|类别|類別)/iu.test(prompt))return null;
 const name=e.outlet?.name||e.requested_scope.outlet_name;
 const amount=e.recorded_total==null?null:'RM '+new Intl.NumberFormat('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}).format(e.recorded_total);
 const periods=12-e.missing_months.length;
 if(/\p{Script=Han}/u.test(prompt))return (name||'该门店')+' '+e.year+' 年'+(amount===null?'没有采购记录。':'有 '+periods+' 个月的采购记录，共 '+amount+'。')+'这项年度汇总可按供应商查看，暂不提供采购类别明细。';
 if(/\b(?:kategori|pembelian|belian|pembekal)\b/iu.test(prompt))return (name||'Cawangan ini')+' ('+e.year+')'+(amount===null?' tiada rekod pembelian.':' merekodkan pembelian '+amount+' sepanjang '+periods+' bulan.')+' Pecahan tahunan mengikut kategori tidak tersedia dalam ringkasan pembekal ini.';
 return (name||'This outlet')+' ('+e.year+') '+(amount===null?'has no recorded purchases.':'recorded '+amount+' in purchases across '+periods+' months with entries.')+' The annual supplier summary does not provide a purchase-category breakdown.';
}

export const supplierPurchaseMetrics={
 recorded_purchases_myr:{field:'recorded_total',unit:'MYR',definition:'Sum of all recorded purchase entries for the selected outlet and period, optionally narrowed to one named supplier.'},
 monthly_purchases_myr:{field:'monthly_totals[].amount',unit:'MYR',definition:'Recorded purchase total for the calendar month. No purchase entries gives null, while a saved zero amount remains zero.'},
 supplier_purchases_myr:{field:'rows[].amount',unit:'MYR',definition:'Recorded amount by supplier across the selected period. Multiple categories for a supplier contribute once each.'},
};
