import {declareReadInterface} from '../assistant/moduleInterface.js';
import {AssistantError} from '../assistantError.js';
import {loadStockCatalogue, stockPage, stockRankFields, stockSku, stockUnit, validateStockRanking} from './stockCatalogue.js';
export const inventoryTool={type:'function',name:'read_factory_finished_goods',description:'Read current Factory shared Finished Goods stock. Use detail for an exact SKU with page 1, query empty and sort name. Use summary for counts, and list with balance_desc or balance_asc for rankings within one stock unit. Re-read for follow-ups. No Company or Outlet scope exists in this catalogue.',strict:true,parameters:{type:'object',properties:{...stockRankFields,mode:{type:'string',enum:['summary','list','detail']},page:{type:'integer',minimum:1,maximum:50},sku:{type:['string','null'],maxLength:80},query:{type:'string',description:'Name substring; use an empty string when supplying an exact SKU'},availability:{type:'string',enum:['all','low','out_of_stock']}},required:['mode','page','sku','query','availability','sort','uom'],additionalProperties:false}};
export function inventoryArguments(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['query','availability','mode','page','sku','sort','uom'].includes(k)))throw new AssistantError('tool_arguments_invalid',400);
 const a={query:'',availability:'all',mode:'list',page:1,sku:null,sort:'name',uom:null,...value};
 // A model can combine an exact SKU with summary/list mode on a mixed query.
 // A supplied SKU narrows the read to the same single record as detail mode.
 if((a.mode==='summary'||a.mode==='list'||a.mode==='detail')&&a.page===1&&typeof a.sku==='string'&&a.sku.trim()){
  a.mode='detail';
  if(a.query===null||typeof a.query==='string'&&a.query.toLowerCase()===a.sku.toLowerCase())a.query='';
  if(stockRankFields.sort.enum.includes(a.sort))a.sort='name';
  if(a.uom==='')a.uom=null;
 }
 if(typeof a.query!=='string'||a.query.length>80||!['all','low','out_of_stock'].includes(a.availability)||!['summary','list','detail'].includes(a.mode)||!Number.isInteger(a.page)||a.page<1||a.page>50||(a.sku!==null&&(typeof a.sku!=='string'||!a.sku.trim()||a.sku.length>80))||(a.mode==='detail')!==(a.sku!==null)||(a.mode!=='list'&&a.page!==1))throw new AssistantError('tool_arguments_invalid',400);
 validateStockRanking(a);
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
 const rows=await loadStockCatalogue(caller,{entity:'finished_goods',table:'factory_finished_goods',fields:'id,product_code,product_name,product_name_en,uom,current_balance,min_stock_level,status,updated_at'},signal);
 if((await callerAccess(caller)).scope_key!==access.scope_key)throw new AssistantError('inventory_scope_changed',409);
 const queryRows=rows.filter(x=>(args.uom===null||stockUnit(x.uom)===stockUnit(args.uom))&&(args.sku===null||stockSku(x.product_code)===stockSku(args.sku))&&(!args.query||`${x.product_name} ${x.product_name_en||''} ${x.product_code||''}`.toLowerCase().includes(args.query.toLowerCase())));
 const isLow=x=>x.current_balance!==null&&x.min_stock_level>0&&x.current_balance<x.min_stock_level;
 const isOut=x=>x.current_balance!==null&&x.current_balance<=0;
 const matching=queryRows.filter(x=>args.availability==='all'||args.availability==='out_of_stock'&&isOut(x)||args.availability==='low'&&isLow(x));
 const page=stockPage(matching,args,'product_name');
 if(args.mode==='detail'&&matching.length>1)throw new AssistantError('inventory_detail_ambiguous',409);
 return {mode:args.mode,page:args.page,page_size:20,sku:args.sku,detail_found:args.mode==='detail'?matching.length===1:null,aggregate_complete:true,
  capability:'read_factory_finished_goods',version:3,source:'/factory/warehouse/finished-goods',scope:'Factory shared catalogue · current Admin permissions',as_of:new Date().toISOString(),
  query:args.query,availability:args.availability,uom:args.uom,total_scoped_products:queryRows.length,low_stock_count:queryRows.filter(isLow).length,
  out_of_stock_count:queryRows.filter(isOut).length,unknown_minimum_count:queryRows.filter(x=>x.min_stock_level===null||x.min_stock_level<=0).length,
  ...page,returned:page.rows.length,
  completeness:{aggregate_scope:'complete_filtered_scope',row_scope:'bounded_projection',total_assertion:'Use explicit catalogue totals and ranking metadata. Rows are paginated at 20; summary has no rows.'},
  limitations:'Current aggregate balance, not reserved/ATP stock. Low means strictly below a recorded positive minimum; absent/zero minimum is unknown. No Company/Outlet attribution. Snapshot and row read are not atomic.'};

}

// Stock classifications are canonical tool facts, never free-form model inference.
export function lowStockSummary(evidence){
 const shown=evidence.rows.slice(0,10);
 return [`${evidence.total_matching} product(s) below a recorded positive minimum.`,...shown.map(x=>`• ${String(x.product_name||x.product_code).slice(0,80)}: ${x.current_balance} ${x.uom||''}; minimum ${x.min_stock_level} ${x.uom||''}.`),...(evidence.total_matching>shown.length?[`Showing ${shown.length} of ${evidence.total_matching} matches.`]:[]),`${evidence.unknown_minimum_count} product(s) have no valid minimum threshold. Their low-stock status is UNKNOWN; they are not classified as low or healthy.`,`Scope: ${evidence.scope}. Read at ${evidence.as_of}.`,`Source: ${evidence.source}. Current aggregate balances, not reserved or available-to-promise stock.`].join('\n');
}

// Factory owns the schema, permission, bounded read and evidence semantics.
export const finishedGoodsRead = Object.freeze({
 moduleInterface:declareReadInterface({module_id:'factory_finished_goods',version:3,permission:'factory_finished_goods.view',scope:'Factory shared catalogue',source:'/factory/warehouse/finished-goods',properties:inventoryTool.parameters.properties,interface:{queryKinds:['summary','count','list','search','detail','filter','rank'],authority:'factory_get_master_id_snapshot + scoped inventory rows',aggregates:'complete_filtered_scope',fields:['rows','total_scoped_products','total_matching','unknown_minimum_count','low_stock_count','out_of_stock_count','ranking'],pagination:'Complete identity/count-checked catalogue; rows paginated at20. Non-atomic source snapshot.'}}),
 id:inventoryTool.name, module_id:'factory_finished_goods', kind:'READ', version:3,
 label:'Factory Finished Goods', permission:'factory_finished_goods.view',
 discoveryPhrases:['finished goods'],
 discoveryFamily:'factory_stock_catalogue',
 scope:'Factory shared catalogue · current Admin permissions',
 scopeTextArguments(args,prompt){
  if(!args||typeof args!=='object'||Array.isArray(args))return args;
  const explicit=[...new Set([...prompt.matchAll(/\bSKU\s+["“']?([a-z0-9][a-z0-9_-]{0,79})/gi)].map(match=>match[1]))];
  if(explicit.length!==1||!/[0-9]/.test(explicit[0])||
   !/\b(?:finished goods|FG)\b[^.?!;\n]{0,40}\b(?:balance|stock|availability)\b[^.?!;\n]{0,24}\bSKU\b/i.test(prompt)||
   /\b(?:rank|highest|lowest|top|compare|versus)\b/i.test(prompt))return args;
  return {...args,mode:'detail',page:1,sku:explicit[0],query:'',sort:'name',uom:args.uom===''?null:args.uom??null};
 },
 tool:inventoryTool, validate:inventoryArguments, execute:readInventory,
 testArguments:{query:'',availability:'all'}, authorized:access=>!!access.factory, deniedCode:'factory_read_denied',
 format:evidence=>evidence.availability==='low'?lowStockSummary(evidence):null,
});
