import {declareReadInterface} from '../assistant/moduleInterface.js';
import {AssistantError} from '../assistantError.js';
export const inventoryTool={type:'function',name:'read_factory_finished_goods',description:'Read current Factory shared Finished Goods stock. Use for stock, availability and low-stock questions; re-read for follow-ups. Use mode summary for complete counts, list with page for subsequent results, detail with exact sku for one product. No Company or Outlet scope exists in this catalogue.',strict:true,parameters:{type:'object',properties:{mode:{type:'string',enum:['summary','list','detail']},page:{type:'integer',minimum:1,maximum:50},sku:{type:['string','null'],maxLength:80},query:{type:'string',description:'Product name substring, empty for all products'},availability:{type:'string',enum:['all','low','out_of_stock']}},required:['mode','page','sku','query','availability'],additionalProperties:false}};
export function inventoryArguments(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['query','availability','mode','page','sku'].includes(k)))throw new AssistantError('tool_arguments_invalid',400);
 const a={query:'',availability:'all',mode:'list',page:1,sku:null,...value};
 if(typeof a.query!=='string'||a.query.length>80||!['all','low','out_of_stock'].includes(a.availability)||!['summary','list','detail'].includes(a.mode)||!Number.isInteger(a.page)||a.page<1||a.page>50||(a.sku!==null&&(typeof a.sku!=='string'||!a.sku.trim()||a.sku.length>80))||(a.mode==='detail')!==(a.sku!==null)||(a.mode!=='list'&&a.page!==1))throw new AssistantError('tool_arguments_invalid',400);
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
 const {data:ids,error:snapshotError}=await caller.rpc('factory_get_master_id_snapshot',{p_entity:'finished_goods'}).abortSignal(signal);
 if(snapshotError||!Array.isArray(ids))throw new AssistantError('inventory_unavailable',503);
 if(ids.length>1000)throw new AssistantError('inventory_result_limit',413);
 const records=[];
 for(let i=0;i<ids.length;i+=100){
  const {data,error}=await caller.from('factory_finished_goods').select('id,product_code,product_name,product_name_en,uom,current_balance,min_stock_level,status,updated_at').in('id',ids.slice(i,i+100)).abortSignal(signal);
  if(error||!Array.isArray(data))throw new AssistantError('inventory_unavailable',503);records.push(...data);
 }
 if(records.length!==ids.length||new Set(records.map(x=>x.id)).size!==ids.length)throw new AssistantError('inventory_scope_changed',409);
 if((await callerAccess(caller)).scope_key!==access.scope_key)throw new AssistantError('inventory_scope_changed',409);
 const number=x=>x==null?null:Number.isFinite(Number(x))?Number(x):null;
 const rows=records.map(x=>({...x,current_balance:number(x.current_balance),min_stock_level:number(x.min_stock_level)}));
 const queryRows=rows.filter(x=>(args.sku===null||x.product_code===args.sku)&&(!args.query||`${x.product_name} ${x.product_name_en||''} ${x.product_code||''}`.toLowerCase().includes(args.query.toLowerCase())));
 const matching=queryRows.filter(x=>(args.availability==='all'||args.availability==='out_of_stock'&&x.current_balance!==null&&x.current_balance<=0||args.availability==='low'&&x.current_balance!==null&&x.min_stock_level>0&&x.current_balance<x.min_stock_level)).sort((a,b)=>a.product_name.localeCompare(b.product_name)||a.id.localeCompare(b.id));
 const offset=(args.page-1)*20;const pageRows=args.mode==='summary'?[]:matching.slice(offset,offset+20);
 if(args.mode==='detail'&&matching.length>1)throw new AssistantError('inventory_detail_ambiguous',409);
 return {mode:args.mode,page:args.page,page_size:20,sku:args.sku,detail_found:args.mode==='detail'?matching.length===1:null,aggregate_complete:true,capability:'read_factory_finished_goods',source:'/factory/warehouse/finished-goods',scope:'Factory shared catalogue · current Admin permissions',as_of:new Date().toISOString(),query:args.query,availability:args.availability,total_scoped_products:queryRows.length,unknown_minimum_count:queryRows.filter(x=>x.min_stock_level===null||x.min_stock_level<=0).length,total_matching:matching.length,returned:pageRows.length,truncated:args.mode!=='summary'&&matching.length>offset+20,rows:pageRows,completeness:{aggregate_scope:'complete_filtered_scope',row_scope:'bounded_projection',total_assertion:'Use explicit catalogue totals only; rows are paginated at20; summary contains no rows.'},limitations:'Current aggregate balance, not reserved/ATP stock. Low means strictly below a recorded positive minimum; absent/zero minimum is unknown, not healthy. No Company/Outlet attribution. At most 20 matching products per page; use page to continue. Snapshot and row read are not an atomic transaction.'};
}

// Stock classifications are canonical tool facts, never free-form model inference.
export function lowStockSummary(evidence){
 const shown=evidence.rows.slice(0,10);
 return [`${evidence.total_matching} product(s) below a recorded positive minimum.`,...shown.map(x=>`• ${String(x.product_name||x.product_code).slice(0,80)}: ${x.current_balance} ${x.uom||''}; minimum ${x.min_stock_level} ${x.uom||''}.`),...(evidence.total_matching>shown.length?[`Showing ${shown.length} of ${evidence.total_matching} matches.`]:[]),`${evidence.unknown_minimum_count} product(s) have no valid minimum threshold. Their low-stock status is UNKNOWN; they are not classified as low or healthy.`,`Scope: ${evidence.scope}. Read at ${evidence.as_of}.`,`Source: ${evidence.source}. Current aggregate balances, not reserved or available-to-promise stock.`].join('\n');
}

// Factory owns the schema, permission, bounded read and evidence semantics.
export const finishedGoodsRead = Object.freeze({
 moduleInterface:declareReadInterface({module_id:'factory_finished_goods',permission:'factory_finished_goods.view',scope:'Factory shared catalogue',source:'/factory/warehouse/finished-goods',properties:inventoryTool.parameters.properties,interface:{queryKinds:['summary','count','list','search','detail','filter'],authority:'factory_get_master_id_snapshot + scoped inventory rows',aggregates:'complete_filtered_scope',fields:['rows','total_scoped_products','total_matching','unknown_minimum_count'],pagination:'Complete identity/count-checked catalogue; rows paginated at20. Non-atomic source snapshot.'}}),
 id:inventoryTool.name, module_id:'factory_finished_goods', kind:'READ', version:2,
 label:'Factory Finished Goods', permission:'factory_finished_goods.view',
 scope:'Factory shared catalogue · current Admin permissions',
 tool:inventoryTool, validate:inventoryArguments, execute:readInventory,
 testArguments:{query:'',availability:'all'}, authorized:access=>!!access.factory, deniedCode:'factory_read_denied',
 format:evidence=>evidence.availability==='low'?lowStockSummary(evidence):null,
});
