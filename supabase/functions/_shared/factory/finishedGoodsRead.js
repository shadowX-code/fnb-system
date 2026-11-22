import {declareReadInterface} from '../assistant/moduleInterface.js';
import {invalidArgument,requireArgumentValues,validateFields} from '../assistant/readContract.js';
import {AssistantError} from '../assistantError.js';
import {groupFinishedGoods} from './finishedGoodsGroups.js';
import {loadStockCatalogue, stockPage, stockQueryFields, stockSku, stockUnit, validateRecordedStockUnit, validateStockQuery} from './stockCatalogue.js';
const groupedProductSummary={measure:'product',mode:'summary',page:1,sku:null,query:'',availability:'all',status:'all',sort:'name',uom:null};
const properties={...stockQueryFields,
 page:{type:'integer',minimum:1,maximum:50,description:'Use 1 except in list mode.'},
 query:{type:'string',maxLength:80,description:'Name substring; use an empty string for an unfiltered query or exact SKU.'},
 availability:{type:'string',enum:['all','low','out_of_stock']},
 status:{type:'string',enum:['all','active','inactive','archived']},
 measure:{type:'string',enum:['sku','product']},
};
export const inventoryTool={type:'function',name:'read_factory_finished_goods',strict:true,
 description:'Read current Factory Finished Goods. Count all grouped products (families and standalone products) with exactly '+JSON.stringify(groupedProductSummary)+
  '. For packaging SKUs use measure=sku, optional recorded status, detail for exact SKU, or list and balance sorting for rankings in one unit. No Company or Outlet scope.',
 parameters:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}};
export function inventoryArguments(value){
 if(!value||typeof value!=='object'||Array.isArray(value))invalidArgument('object_required');
 const a={query:'',availability:'all',mode:'list',page:1,sku:null,sort:'name',uom:null,status:'all',measure:'sku',...value};
 // A model can combine an exact SKU with summary/list mode on a mixed query.
 // A supplied SKU narrows the read to the same single record as detail mode.
 if((a.mode==='summary'||a.mode==='list'||a.mode==='detail')&&a.page===1&&typeof a.sku==='string'&&a.sku.trim()){
  a.mode='detail';
  if(a.query===null||typeof a.query==='string'&&a.query.toLowerCase()===a.sku.toLowerCase())a.query='';
  if(stockQueryFields.sort.enum.includes(a.sort))a.sort='name';
  if(a.uom==='')a.uom=null;
 }
 validateFields(properties,a);
 if(a.measure==='product')requireArgumentValues(a,groupedProductSummary);
 else validateStockQuery(a);
 return a;
}
export async function callerAccess(caller){
 const [{data:role,error:r},{data:allowed,error:e}]=await Promise.all([caller.rpc('current_user_role_id'),caller.rpc('current_user_has_permission',{permission_code:'factory_finished_goods.view'})]);
 if(r||e||!role)throw new AssistantError('admin_required',403);
 return {scope_key:`factory-global:${role}:${allowed===true?'read':'denied'}`,factory:allowed===true};
}
export async function readInventory(caller,args,signal){
 args=inventoryArguments(args);
 const access=await callerAccess(caller);if(!access.factory)throw new AssistantError('factory_read_denied',403);
 const rows=await loadStockCatalogue(caller,{entity:'finished_goods',table:'factory_finished_goods',
  fields:'id,product_code,product_name,product_name_en,product_name_cn,product_name_bm,uom,current_balance,min_stock_level,status,updated_at'+(args.measure==='product'?',product_family_id':'')},signal);
 const families=args.measure==='product'
  ?await loadStockCatalogue(caller,{entity:'product_families',table:'factory_product_families',fields:'id'},signal):null;
 if((await callerAccess(caller)).scope_key!==access.scope_key)throw new AssistantError('inventory_scope_changed',409);
 validateRecordedStockUnit(args,rows);
 if(families){
  const familyIds=new Set(families.map(family=>family.id));
  if(rows.some(sku=>sku.product_family_id&&!familyIds.has(sku.product_family_id)))throw new AssistantError('inventory_scope_changed',409);
  return {mode:'summary',measure:'product',aggregate_complete:true,total_matching:groupFinishedGoods(families,rows).length,rows:[],
   capability:'read_factory_finished_goods',version:4,source:'/factory/warehouse/finished-goods',scope:'Factory shared grouped catalogue · current Admin permissions',
   as_of:new Date().toISOString(),completeness:{aggregate_scope:'complete_filtered_scope',row_scope:'summary_only'},
   limitations:'Counts configured product families and standalone SKUs using the Admin grouped view. This is not the total packaging SKU count. Source snapshots are non-atomic.'};
 }
 const queryRows=rows.filter(x=>(args.status==='all'||x.status===args.status)&&(args.uom===null||stockUnit(x.uom)===stockUnit(args.uom))&&(args.sku===null||stockSku(x.product_code)===stockSku(args.sku))&&
  [x.product_name,x.product_name_en,x.product_name_cn,x.product_name_bm,x.product_code].join(' ').toLowerCase().includes(args.query.toLowerCase()));
 const isLow=x=>x.current_balance!==null&&x.min_stock_level>0&&x.current_balance<x.min_stock_level;
 const isOut=x=>x.current_balance!==null&&x.current_balance<=0;
 const matching=queryRows.filter(x=>args.availability==='all'||args.availability==='out_of_stock'&&isOut(x)||args.availability==='low'&&isLow(x));
 const page=stockPage(matching,args,'product_name');
 if(args.mode==='detail'&&matching.length>1)throw new AssistantError('inventory_detail_ambiguous',409);
 return {mode:args.mode,page:args.page,page_size:20,sku:args.sku,detail_found:args.mode==='detail'?matching.length===1:null,aggregate_complete:true,
  capability:'read_factory_finished_goods',version:4,source:'/factory/warehouse/finished-goods',scope:'Factory shared catalogue · current Admin permissions',as_of:new Date().toISOString(),
  measure:'sku',query:args.query,availability:args.availability,uom:args.uom,status:args.status,total_scoped_products:queryRows.length,low_stock_count:queryRows.filter(isLow).length,
  out_of_stock_count:queryRows.filter(isOut).length,unknown_minimum_count:queryRows.filter(x=>x.min_stock_level===null||x.min_stock_level<=0).length,
  ...page,returned:page.rows.length,
  completeness:{aggregate_scope:'complete_filtered_scope',row_scope:'bounded_projection',total_assertion:'Use explicit catalogue totals and ranking metadata. Rows are paginated at 20; summary has no rows.'},
  limitations:'Counts here are packaging SKUs. Current aggregate balance, not reserved/ATP stock. Low means strictly below a recorded positive minimum; absent/zero minimum is unknown. Category/tag filters and Company/Outlet attribution are outside this read. Snapshot and row read are not atomic.'};

}

// Stock classifications are canonical tool facts, never free-form model inference.
export function lowStockSummary(evidence){
 const shown=evidence.rows.slice(0,10);
 return [`${evidence.total_matching} product(s) below a recorded positive minimum.`,...shown.map(x=>`• ${String(x.product_name||x.product_code).slice(0,80)}: ${x.current_balance} ${x.uom||''}; minimum ${x.min_stock_level} ${x.uom||''}.`),...(evidence.total_matching>shown.length?[`Showing ${shown.length} of ${evidence.total_matching} matches.`]:[]),`${evidence.unknown_minimum_count} product(s) have no valid minimum threshold. Their low-stock status is UNKNOWN; they are not classified as low or healthy.`,`Scope: ${evidence.scope}. Read at ${evidence.as_of}.`,`Source: ${evidence.source}. Current aggregate balances, not reserved or available-to-promise stock.`].join('\n');
}

// Factory owns the schema, permission, bounded read and evidence semantics.
export const finishedGoodsRead = Object.freeze({
 moduleInterface:declareReadInterface({module_id:'factory_finished_goods',version:4,permission:'factory_finished_goods.view',scope:'Factory shared catalogue',source:'/factory/warehouse/finished-goods',properties:inventoryTool.parameters.properties,interface:{queryKinds:['summary','count','list','search','detail','filter','rank'],authority:'factory_get_master_id_snapshot + scoped SKU and product-family tables',aggregates:'complete_filtered_scope',fields:['measure','rows','total_scoped_products','total_matching','unknown_minimum_count','low_stock_count','out_of_stock_count','ranking'],pagination:'Complete identity/count-checked SKU and grouped catalogues; SKU rows paginated at 20. Non-atomic source snapshots.',unsupported:['Filtered family counts, category, tags, valuation and per-location stock are outside this read.']}}),
 id:inventoryTool.name, module_id:'factory_finished_goods', kind:'READ', version:4,
 label:'Factory Finished Goods', permission:'factory_finished_goods.view',
 discoveryPhrases:['finished goods','produk siap','成品库存','成品庫存'],
 discoveryFamily:'factory_stock_catalogue',
 scope:'Factory shared catalogue · current Admin permissions',
 scopeTextArguments(args,prompt){
  if(!args||typeof args!=='object'||Array.isArray(args))return args;
  const explicit=[...new Set([...prompt.matchAll(/\bSKU\s+["“']?([a-z0-9][a-z0-9_-]{0,79})/gi)].map(match=>match[1]))];
  if(explicit.length!==1||!/[0-9]/.test(explicit[0])||
   !/\b(?:finished goods|FG)\b[^.?!;\n]{0,40}\b(?:balance|stock|availability)\b[^.?!;\n]{0,24}\bSKU\b/i.test(prompt)||
   /\b(?:rank|highest|lowest|top|compare|versus)\b/i.test(prompt))return args;
  return {...args,mode:'detail',measure:'sku',page:1,sku:explicit[0],query:'',sort:'name',uom:args.uom===''?null:args.uom??null};
 },
 tool:inventoryTool, validate:inventoryArguments, execute:readInventory,
 testArguments:{query:'',availability:'all'}, authorized:access=>!!access.factory, deniedCode:'factory_read_denied',
 format:evidence=>evidence.availability==='low'?lowStockSummary(evidence):null,
});
