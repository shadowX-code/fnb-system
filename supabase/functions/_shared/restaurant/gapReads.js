import {readContract,uuid,month,page,pick,permitted,rowsEvidence,invalidArgument} from '../assistant/readContract.js';
import {AssistantError} from '../assistantError.js';
import {readCompleteRows} from '../completeRows.js';
import {buildAlerts,getSalesBreakdown,getMonthlyPurchaseEfficiency,getPurchaseTotal,getPreviousPeriod} from './analytics.js';
import {formatSupplierPurchases,loadSupplierPurchases,purchaseAnswerAmounts,purchaseOutlet,purchaseOutletFields,purchasePageSize,supplierFilter,supplierPurchaseIntent,supplierPurchaseMetrics,validatePurchaseScope} from './supplierPurchases.js';
import {buildDataHealth} from './dataHealth.js';
// Fixed, human-RLS domain sources; no caller-selected tables, filters or columns.
async function requireAnalyticsAccess(caller,signal){
 for(const permission of ['sales_input.view','purchase_input.view','sales_channels.view','suppliers.view','tax_settings.view','operating_expenses.view'])await permitted(caller,permission,signal);
}
async function snapshot(c,a,signal){
 await requireAnalyticsAccess(c,signal);
 const year=Number(a.month.slice(0,4)),m=Number(a.month.slice(5,7));
 async function read(table,select,scope){
  return (await readCompleteRows(table,async(offset,end)=>{
   signal?.throwIfAborted();let q=c.from(table).select(select,{count:'exact'}).order('id');q=scope(q);
   const r=await q.range(offset,end).abortSignal(signal);
   if(r.count>5000)throw new AssistantError('business_result_limit',413);
   return r;
  })).data;
 }
 const outlet=q=>q.eq('outlet_id',a.outlet_id);
 const records=q=>outlet(q).gte('year',year-1).lte('year',year);
 const [salesRecords,purchaseRecords,salesChannels,suppliers,outletTaxConfigs,operatingExpenses]=await Promise.all([
  read('sales_records','id,outlet_id,year,month,channel_id,channel_name,amount,updated_at',records),
  read('purchase_records','id,outlet_id,year,month,supplier_id,category_id,amount,updated_at',records),
  read('sales_channels','id,name,type',q=>q),read('suppliers','id,name,category,default_category_id',q=>q),
  read('outlet_tax_configs','id,outlet_id,tax_type,enabled,rate,effective_from,effective_until',outlet),
  read('operating_expenses','id,outlet_id,year,month,amount,updated_at',q=>outlet(q).eq('year',year).eq('month',m))]);
 return {store:{salesRecords,purchaseRecords,salesChannels,suppliers,outletTaxConfigs,operatingExpenses,specialMonths:[]},filters:{outletId:a.outlet_id,year,month:m}};
}
function salesPeriod(store,outletId,month,year){
 const count=store.salesRecords.filter(r=>r.outlet_id===outletId&&r.month===month&&r.year===year).length;
 return {source_record_count:count,values:count?getSalesBreakdown(store.salesRecords,store.salesChannels,outletId,month,year):null};
}
function purchasePeriod(store,filters){
 const matches=r=>r.outlet_id===filters.outletId&&r.month===filters.month&&r.year===filters.year;
 const sales=store.salesRecords.filter(matches).length,purchases=store.purchaseRecords.filter(matches).length;
 const previous=getPreviousPeriod(filters.month,filters.year);
 const matchesPrevious=row=>row.outlet_id===filters.outletId&&row.year===previous.year&&row.month===previous.month;
 return {month:filters.month,sales_record_count:sales,purchase_record_count:purchases,
  previous_sales_record_count:store.salesRecords.filter(matchesPrevious).length,previous_purchase_record_count:store.purchaseRecords.filter(matchesPrevious).length,
  recorded_purchase_amount:purchases?getPurchaseTotal(store.purchaseRecords,filters.outletId,filters.month,filters.year):null,values:sales&&purchases?getMonthlyPurchaseEfficiency({...store,...filters}):null};
}
const purchaseComparisonRead=readContract({
 id:'read_purchase_comparison',module_id:'purchase-comparison',version:2,label:'Restaurant purchase comparison and monthly supplier purchases',
 permission:'purchase_comparison.view',source:'/restaurant/purchases/comparison',
 scope:'One authorized Restaurant outlet and reporting year, with the original Sales Input, Purchase Input, Sales Channels, Suppliers, Tax Settings and Operating Expenses permission checks.',
 discoveryPhrases:['purchase comparison','monthly supplier purchases','annual supplier purchases','purchases by month','每月供应商采购','每個月的採購','采购对比','pembelian bulanan','belian mengikut bulan'],
 queryIntent:prompt=>supplierPurchaseIntent(prompt)==='supplier_year'?'recorded_purchases_by_month':null,
 narrowerReads:{recorded_purchases_by_month:['read_purchase_records']},
 answerAmounts:purchaseAnswerAmounts,format:formatSupplierPurchases,fixedPageSize:purchasePageSize,
 description:'For monthly purchase amounts across a year, supplier spend by month, recorded annual total or months without entries use supplier_year; month in YYYY-MM-01 selects the year. Use supplier_month for only one month. Both return period and monthly totals without any sales requirement, plus largest supplier totals first; optionally filter by a recorded supplier name. Use efficiency only for net sales and purchase-efficiency analysis.',
 properties:{...supplierFilter,...purchaseOutletFields,month,mode:{type:'string',enum:['efficiency','supplier_month','supplier_year']}},
 normalizeArguments:a=>a&&typeof a==='object'&&!Array.isArray(a)?{mode:'efficiency',page:1,supplier_name:null,outlet_id:null,outlet_name:null,...a}:a,
 check(a){validatePurchaseScope(a);if(a.mode==='efficiency'){if(a.page!==1)invalidArgument('unsupported_value','page');if(a.supplier_name)invalidArgument('unsupported_value','supplier_name');}},
 async load(c,a,signal){
  const outlet=await purchaseOutlet(c,a,signal);
  if(a.mode!=='efficiency'){
   await requireAnalyticsAccess(c,signal);
   return loadSupplierPurchases(c,a,outlet,a.mode==='supplier_year',signal);
  }
  return {outlet,...await snapshot(c,{...a,outlet_id:outlet.id},signal)};
 },
 project(data){
  if(!data.store)return data;
  return {outlet:data.outlet,months:Array.from({length:12},(_,i)=>purchasePeriod(data.store,{...data.filters,month:i+1})),limitations:'Efficiency needs sales and purchase records. Use supplier_year for recorded monthly purchases independent of sales. This is not accounting COGS.'};
 },
 interface:{authority:'Restaurant Purchase Comparison yearly purchase records, Purchase Input and shared Restaurant analytics',
  fields:['monthly_totals','recorded_total','missing_months','entry_count','supplier_name','amount','months'],
  queryKinds:['summary','list','group','filter','rank','period_comparison'],aggregates:'complete_filtered_scope',
  pagination:'Supplier rows are ranked by recorded amount and paged ten at a time. Recorded totals cover all matching entries; supplier reporting requires a complete snapshot of at most 1,000 entries.',
  semantics:{entities:['recorded supplier purchases','monthly purchases','purchase efficiency'],time:'One calendar month or the reporting year containing the requested month. Missing monthly purchases are unknown.',
   relationships:['A saved purchase entry contributes once to its outlet, month and recorded supplier. Sales are needed for efficiency, not for recorded purchase amounts.'],metrics:supplierPurchaseMetrics},
  unsupported:['Payments, supplier invoices, unentered purchases, category-specific expense breakdowns and statutory accounting values are outside this read.']},
});
const information='Complete count-checked RLS records for requested and previous calendar years; requires Sales Input, Purchase Input, Sales Channels, Suppliers, Tax Settings and Operating Expenses view in addition to module permission. No stored forecast or statutory accounting.';
export const restaurantGapReads=[
 readContract({id:'read_recipe_ingredients',module_id:'recipe_intelligence',label:'Recipe ingredient quantities and yield metadata',permission:'recipe_intelligence.view',source:'/inventory/recipe-intelligence',scope:'Authorized outlet; ten recipes per page; saved ingredients, no inferred cost or sales attribution',description:'Read recipe ingredients, quantities, units, wastage allowance and serving size from the same RLS sources as Recipe Intelligence. No fabricated costs when item costs or sales mappings are unavailable.',properties:{outlet_id:uuid,page},outletScope:true,query:(c,a)=>c.from('inventory_recipes').select('id,outlet_id,recipe_name,recipe_code,serving_size,selling_price,status,updated_at,inventory_recipe_items(id,inventory_item_id,quantity_used,unit,wastage_percent,updated_at)').eq('outlet_id',a.outlet_id).order('id').range((a.page-1)*10,a.page*10),project:d=>rowsEvidence(d.map(r=>({...pick(r,['id','outlet_id','recipe_name','recipe_code','serving_size','selling_price','status','updated_at']),ingredients:rowsEvidence(r.inventory_recipe_items,['id','inventory_item_id','quantity_used','unit','wastage_percent','updated_at'],30)})),['id','outlet_id','recipe_name','recipe_code','serving_size','selling_price','status','updated_at','ingredients'],10)}),
 ...[
  ['read_restaurant_alerts','alerts','alerts.view','Operational alert evidence',({store,filters})=>({source_record_count:store.salesRecords.length+store.purchaseRecords.length,...rowsEvidence(buildAlerts({...store,...filters}),['id','alert_type','severity','priority','title','description','current_value','comparison_value','percentage_change','confidence_score','created_at']),limitations:'Shared page calculation; planned special-month annotations have no persistent authority and are excluded. Two-year source window; not complete all-time risk assessment.'})],
  ['read_restaurant_data_health','data-health','data_health.view','Operational source checks',({store,filters})=>{const d=buildDataHealth(store,filters);return {warnings:d.warnings,sales_score:d.salesScore,purchase_score:d.purchaseScore,overall_score:d.overallScore,status:d.monthStatus,channel_count:d.uniqueSalesChannelCount,limitations:'Source completeness only, not financial closure. Special-month annotations excluded.'};}],
  ['read_sales_comparison','sales-comparison','sales_comparison.view','Monthly sales comparison',({store,filters})=>({months:Array.from({length:12},(_,i)=>({month:i+1,current:salesPeriod(store,filters.outletId,i+1,filters.year),previous_year:salesPeriod(store,filters.outletId,i+1,filters.year-1)})),limitations:'Canonical gross/net and deduction calculations. Missing monthly rows are not proof of zero business activity; no forecast.'})],
 ].map(([id,module_id,permission,label,project])=>readContract({interface:{queryKinds:id.includes('comparison')?['summary','period_comparison']:['summary'],authority:'shared Restaurant analytics and completeRows',aggregates:'complete_filtered_scope',pagination:'Complete count-checked fixed sources, bounded at5000 each; missing months remain unavailable.'},id,module_id,permission,label,source:'/sales-purchase',scope:information,description:label+'. '+information,properties:{outlet_id:uuid,month},outletScope:true,query:(c,a)=>({abortSignal:async signal=>({data:await snapshot(c,a,signal),error:null})}),project})),
 purchaseComparisonRead,
];
