import {readContract, page} from '../assistant/readContract.js';
import {AssistantError} from '../assistantError.js';
import {loadStockCatalogue, rawMaterialStockStatus, stockPage, stockQueryFields, stockSku, stockUnit, validateRecordedStockUnit, validateStockQuery} from './stockCatalogue.js';

const stockFields='id,material_code,name,name_en,name_cn,name_bm,category,uom,current_balance,min_stock_level,status,updated_at';
const {sku,uom}=stockQueryFields;

export const rawMaterialRead=readContract({
 id:'read_factory_raw_catalogue',module_id:'factory_raw_inventory',label:'Raw Material Inventory stock and rankings',
 discoveryPhrases:['raw materials','raw material inventory'],
 discoveryFamily:'factory_stock_catalogue',
 permission:'factory_raw_inventory.view',source:'/factory/raw-materials/inventory',version:2,
 scope:'Factory shared raw-material catalogue under current human permission and row visibility.',
 description:'Read Raw Material Inventory (RM): current stock, search, exact SKU detail and complete filtered counts. For highest or lowest stock use list and balance sort in one recorded unit. No costs, site stock, historical stock, reserved stock or ATP.',
 properties:{...stockQueryFields,page:{...page,type:'integer',description:'Use 1 except in list mode.'},query:{type:'string',maxLength:80},
  sku:{...sku,type:'string',nullable:true},uom:{...uom,type:'string',nullable:true},
  status:{type:'string',enum:['all','active','archived']},availability:{type:'string',enum:['all','low','out_of_stock']}},
 normalizeArguments:a=>a&&typeof a==='object'&&!Array.isArray(a)?{mode:'list',page:1,query:'',sku:null,status:'all',availability:'all',sort:'name',uom:null,...a}:a,
 check:validateStockQuery,
 query:caller=>({abortSignal:async signal=>({data:await loadStockCatalogue(caller,{
  entity:'raw_materials',table:'factory_raw_materials',fields:stockFields,
 },signal)})}),
 interface:{semantics:{
  entities:['raw material','material SKU'],time:'Current raw-material master balances.',
  relationships:['Each material has a recorded stock unit and its own minimum.'],
  metrics:{
   material_count:{field:'total_matching',unit:'materials',definition:'Material records matching all requested filters.'},
   recorded_balance:{field:'rows[].current_balance',unit_field:'rows[].uom',definition:'Current master balance of one material. Compare only within the same unit.'},
   low_stock_count:{field:'low_stock_count',unit:'materials',definition:'Positive balance at or below a positive minimum. Zero or negative is out of stock.'},
  }},queryKinds:['summary','count','list','search','detail','filter','rank'],authority:'factory_get_master_id_snapshot + factory_raw_materials',
  fields:stockFields.split(','),aggregates:'complete_filtered_scope',pagination:'Complete identity-checked catalogue (up to 1000 records), paginated at 20 after filtering and ranking.',
  unavailable:'Snapshot drift fails the read. Mixed units need an explicit stock unit. No inventory cost, location, historical stock or ATP authority.'},
 project(data,a){
  validateRecordedStockUnit(a,data);
  const scoped=data.filter(r=>(a.status==='all'||r.status===a.status)&&(a.uom===null||stockUnit(r.uom)===stockUnit(a.uom))
   &&(a.sku===null||stockSku(r.material_code)===stockSku(a.sku))
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
