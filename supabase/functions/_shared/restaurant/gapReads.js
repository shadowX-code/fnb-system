import {readContract,uuid,month,page,pick,permitted,rowsEvidence} from '../assistant/readContract.js';
import {AssistantError} from '../assistantError.js';
import {readCompleteRows} from '../completeRows.js';
import {buildAlerts,getSalesBreakdown,getMonthlyPurchaseEfficiency} from './analytics.js';
import {buildDataHealth} from './dataHealth.js';
// Fixed, human-RLS domain sources; no caller-selected tables, filters or columns.
async function snapshot(c,a,signal){
 for(const permission of ['sales_input.view','purchase_input.view','sales_channels.view','suppliers.view','tax_settings.view','operating_expenses.view'])await permitted(c,permission,signal);
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
const information='Complete count-checked RLS records for requested and previous calendar years; requires Sales Input, Purchase Input, Sales Channels, Suppliers, Tax Settings and Operating Expenses view in addition to module permission. No stored forecast or statutory accounting.';
export const restaurantGapReads=[
 readContract({id:'read_recipe_ingredients',module_id:'recipe_intelligence',label:'Recipe ingredient quantities and yield metadata',permission:'recipe_intelligence.view',source:'/inventory/recipe-intelligence',scope:'Authorized outlet; ten recipes per page; saved ingredients, no inferred cost or sales attribution',description:'Read recipe ingredients, quantities, units, wastage allowance and serving size from the same RLS sources as Recipe Intelligence. No fabricated costs when item costs or sales mappings are unavailable.',properties:{outlet_id:uuid,page},outletScope:true,query:(c,a)=>c.from('inventory_recipes').select('id,outlet_id,recipe_name,recipe_code,serving_size,selling_price,status,updated_at,inventory_recipe_items(id,inventory_item_id,quantity_used,unit,wastage_percent,updated_at)').eq('outlet_id',a.outlet_id).order('id').range((a.page-1)*10,a.page*10),project:d=>rowsEvidence(d.map(r=>({...pick(r,['id','outlet_id','recipe_name','recipe_code','serving_size','selling_price','status','updated_at']),ingredients:rowsEvidence(r.inventory_recipe_items,['id','inventory_item_id','quantity_used','unit','wastage_percent','updated_at'],30)})),['id','outlet_id','recipe_name','recipe_code','serving_size','selling_price','status','updated_at','ingredients'],10)}),
 ...[
  ['read_restaurant_alerts','alerts','alerts.view','Operational alert evidence',({store,filters})=>({...rowsEvidence(buildAlerts({...store,...filters}),['id','alert_type','severity','priority','title','description','current_value','comparison_value','percentage_change','confidence_score','created_at']),limitations:'Shared page calculation; planned special-month annotations have no persistent authority and are excluded. Two-year source window; not complete all-time risk assessment.'})],
  ['read_restaurant_data_health','data-health','data_health.view','Operational source checks',({store,filters})=>{const d=buildDataHealth(store,filters);return {warnings:d.warnings,sales_score:d.salesScore,purchase_score:d.purchaseScore,overall_score:d.overallScore,status:d.monthStatus,channel_count:d.uniqueSalesChannelCount,limitations:'Source completeness only, not financial closure. Special-month annotations excluded.'};}],
  ['read_sales_comparison','sales-comparison','sales_comparison.view','Monthly sales comparison',({store,filters})=>({months:Array.from({length:12},(_,i)=>({month:i+1,current:getSalesBreakdown(store.salesRecords,store.salesChannels,filters.outletId,i+1,filters.year),previous_year:getSalesBreakdown(store.salesRecords,store.salesChannels,filters.outletId,i+1,filters.year-1)})),limitations:'Canonical gross/net and deduction calculations. Missing monthly rows are not proof of zero business activity; no forecast.'})],
  ['read_purchase_comparison','purchase-comparison','purchase_comparison.view','Monthly purchase efficiency comparison',({store,filters})=>({months:Array.from({length:12},(_,i)=>({month:i+1,...getMonthlyPurchaseEfficiency({...store,...filters,month:i+1})})),limitations:'Canonical purchase efficiency, not accounting COGS. Supplier-level drilldown remains in source records.'})]
 ].map(([id,module_id,permission,label,project])=>readContract({id,module_id,permission,label,source:'/sales-purchase',scope:information,description:label+'. '+information,properties:{outlet_id:uuid,month},outletScope:true,query:(c,a)=>({abortSignal:async signal=>({data:await snapshot(c,a,signal),error:null})}),project})),
];
