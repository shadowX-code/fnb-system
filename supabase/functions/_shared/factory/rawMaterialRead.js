import {readContract, page} from '../assistant/readContract.js';
import {AssistantError} from '../assistantError.js';
import {loadStockCatalogue, rawMaterialStockStatus, stockPage, stockRankFields, stockUnit, validateStockRanking} from './stockCatalogue.js';

const stockFields='id,material_code,name,name_en,name_cn,name_bm,category,uom,current_balance,min_stock_level,status,updated_at';
const {uom,sort}=stockRankFields;

export const rawMaterialRead=readContract({
 id:'read_factory_raw_catalogue',module_id:'factory_raw_inventory',label:'Raw Material Inventory stock and rankings',
 discoveryPhrases:['raw material inventory'],
 permission:'factory_raw_inventory.view',source:'/factory',version:2,
 scope:'Factory shared raw-material catalogue under current human permission and row visibility.',
 description:'Read Raw Material Inventory (RM): current stock, search, exact SKU detail and complete filtered counts. For highest or lowest stock use list and balance sort in one recorded unit. No costs, site stock, historical stock, reserved stock or ATP.',
 properties:{mode:{type:'string',enum:['summary','list','detail']},page,query:{type:'string',maxLength:80},
  sku:{type:'string',nullable:true,maxLength:80}, status:{type:'string',enum:['all','active','archived']},
  availability:{type:'string',enum:['all','low','out_of_stock']},sort,uom:{...uom,type:'string',nullable:true}},
 normalizeArguments:a=>a&&typeof a==='object'&&!Array.isArray(a)?{mode:'list',page:1,query:'',sku:null,status:'all',availability:'all',sort:'name',uom:null,...a}:a,
 check(a){
  validateStockRanking(a);
  if((a.mode==='detail')!==(a.sku!==null)||a.sku!==null&&!a.sku.trim()||a.mode!=='list'&&a.page!==1)throw new AssistantError('tool_arguments_invalid',400);
 },
 query:caller=>({abortSignal:async signal=>({data:await loadStockCatalogue(caller,{
  entity:'raw_materials',table:'factory_raw_materials',fields:stockFields,
 },signal)})}),
 interface:{queryKinds:['summary','count','list','search','detail','filter','rank'],authority:'factory_get_master_id_snapshot + factory_raw_materials',
  fields:stockFields.split(','),aggregates:'complete_filtered_scope',pagination:'Complete identity-checked catalogue (up to 1000 records), paginated at 20 after filtering and ranking.',
  unavailable:'Snapshot drift fails the read. Mixed units need an explicit stock unit. No inventory cost, location, historical stock or ATP authority.'},
 project(data,a){
  const scoped=data.filter(r=>(a.status==='all'||r.status===a.status)&&(a.uom===null||stockUnit(r.uom)===stockUnit(a.uom))
   &&(a.sku===null||r.material_code===a.sku)
   &&[r.material_code,r.name,r.name_en,r.name_cn,r.name_bm].join(' ').toLowerCase().includes(a.query.toLowerCase()))
   .map(r=>({...r,stock_status:r.current_balance===null?'Unknown':rawMaterialStockStatus(r.current_balance,r.min_stock_level)}));
  const matching=scoped.filter(r=>a.availability==='all'||r.stock_status===(a.availability==='low'?'Low Stock':'Out of Stock'));
  if(a.mode==='detail'&&matching.length>1)throw new AssistantError('inventory_detail_ambiguous',409);
  const page=stockPage(matching,a,'name');
  return {...page,returned:page.rows.length,mode:a.mode,page:a.page,page_size:20,
   total_scoped_materials:scoped.length,low_stock_count:scoped.filter(r=>r.stock_status==='Low Stock').length,
   out_of_stock_count:scoped.filter(r=>r.stock_status==='Out of Stock').length,
   unknown_minimum_count:scoped.filter(r=>r.min_stock_level===null||r.min_stock_level<=0).length,
   limitations:'Raw Material Inventory counts active masters when status=active. Low means positive balance at or below the recorded positive minimum; zero or negative is out of stock. Missing balances are unknown. No cross-unit ranking, valuation or per-location attribution.'};
 },
});
