import {declareReadInterface} from '../assistant/moduleInterface.js';
import {invalidArgument,requireArgumentValues,validateFields} from '../assistant/readContract.js';
import {AssistantError} from '../assistantError.js';
import {filterFinishedGoods} from './finishedGoodsGroups.js';
import {normalizedEntity} from '../assistant/entityResolution.js';
import {loadStockCatalogue, stockPage, stockQueryFields, stockSku, stockUnit, validateRecordedStockUnit, validateStockQuery} from './stockCatalogue.js';
const groupedProductSummary={measure:'product',mode:'summary',page:1,sku:null,query:'',availability:'all',status:'all',sort:'name',uom:null,category_name:null,tag_name:null};
const dimensionLabel={type:['string','null'],maxLength:80,description:'A recorded human-readable label explicitly requested by the user, otherwise null.'};
const skuFields='id,product_code,product_name,product_name_en,product_name_cn,product_name_bm,uom,current_balance,min_stock_level,status,updated_at';
const properties={...stockQueryFields,
 page:{type:'integer',minimum:1,maximum:100,description:'Use 1 except in list mode. Packaging SKUs have at most 50 pages and product groups at most 100.'},
 query:{type:'string',maxLength:80,description:'Name substring; use an empty string for an unfiltered query or exact SKU.'},
 availability:{type:'string',enum:['all','low','out_of_stock']},
 status:{type:'string',enum:['all','active','inactive','archived']},
 measure:{type:'string',enum:['sku','product']},
 category_name:dimensionLabel,tag_name:dimensionLabel,
};
export const inventoryTool={type:'function',name:'read_factory_finished_goods',strict:true,
 description:'Read current Factory Finished Goods. Unfiltered grouped-product count (families and standalone SKUs): '+JSON.stringify(groupedProductSummary)+
  '. To list product families including standalone products, use measure=product and mode=list. Each group has a name and matching packaging SKU count. For explicit group filters use name/SKU substring, a category or tag name, or the Admin status (active/archived or availability=out_of_stock). Group status can also match a packaging SKU. Use no unrequested filters. For packaging SKUs use measure=sku, optional recorded status/category/tag, detail for exact SKU, or list and balance sorting for rankings in one unit. No Company or Outlet scope.',
 parameters:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}};
export function inventoryArguments(value){
 if(!value||typeof value!=='object'||Array.isArray(value))invalidArgument('object_required');
 const a={...groupedProductSummary,mode:'list',measure:'sku',...value};
 // A model can combine an exact SKU with summary/list mode on a mixed query.
 // A supplied SKU narrows the read to the same single record as detail mode.
 if((a.mode==='summary'||a.mode==='list'||a.mode==='detail')&&a.page===1&&typeof a.sku==='string'&&a.sku.trim()){
  a.mode='detail';
  if(a.query===null||typeof a.query==='string'&&a.query.toLowerCase()===a.sku.toLowerCase())a.query='';
  if(stockQueryFields.sort.enum.includes(a.sort))a.sort='name';
  if(a.uom==='')a.uom=null;
 }
 validateFields(properties,a);
 for(const field of ['category_name','tag_name'])if(a[field]!==null&&!a[field].trim())invalidArgument('nonblank_text_or_null',field);
 if(a.measure==='product'){
  requireArgumentValues(a,{sku:null,sort:'name',uom:null});
  if(a.mode==='detail')invalidArgument('unsupported_value','mode');
  if(a.mode==='summary'&&a.page!==1)invalidArgument('unsupported_value','page');
  if(a.availability==='low')invalidArgument('unsupported_value','availability');
  if(a.status==='inactive'||a.availability==='out_of_stock'&&a.status!=='all')invalidArgument('unsupported_value','status');
 }
 else{
  if(a.page>50)invalidArgument('unsupported_value','page');
  validateStockQuery(a);
 }
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
 const grouped=args.measure==='product';
 const rows=await loadStockCatalogue(caller,{entity:'finished_goods',table:'factory_finished_goods',
  fields:skuFields+(grouped||args.tag_name?',product_family_id':'')+(grouped?',variant_name':'')+(args.category_name?',category_id':'')},signal);
 const families=grouped
  ?await loadStockCatalogue(caller,{entity:'product_families',table:'factory_product_families',fields:'id,name_en,name_cn,name_bm,status'+(args.category_name?',category_id':'')},signal):null;
 const categories=args.category_name?await loadStockCatalogue(caller,{entity:'finished_good_categories',table:'factory_finished_good_categories',fields:'id,name'},signal):[];
 let tagSnapshot;
 if(args.tag_name){
  const {data,error}=await caller.rpc('factory_get_finished_good_tags').abortSignal(signal);
  if(error||!Array.isArray(data?.tags)||!Array.isArray(data?.assignments))throw new AssistantError(error?.code==='42501'?'factory_read_denied':'inventory_unavailable',error?.code==='42501'?403:503);
  if(data.tags.length>1000||data.assignments.length>10000)throw new AssistantError('inventory_result_limit',413);
  const ids=new Set(data.tags.map(tag=>tag?.id));
  if(ids.size!==data.tags.length||data.tags.some(tag=>!tag?.id||typeof tag.name!=='string'||!tag.name.trim())||
   data.assignments.some(row=>!row?.product_family_id||!ids.has(row.tag_id)))throw new AssistantError('inventory_unavailable',503);
  tagSnapshot=data;
 }
 if((await callerAccess(caller)).scope_key!==access.scope_key)throw new AssistantError('inventory_scope_changed',409);
 validateRecordedStockUnit(args,rows);
 const category=args.category_name&&normalizedEntity(categories,args.category_name,['name']);
 const tag=args.tag_name&&normalizedEntity(tagSnapshot.tags,args.tag_name,['name']);
 if((args.category_name&&!category)||(args.tag_name&&!tag))throw new AssistantError('entity_unresolved',409);
 const labelScope={...(category?{category_name:category.name}:{}),...(tag?{tag_name:tag.name}:{})};
 const filters={product:grouped?args.query:'',category:category?.id,tag:tag?.id,status:grouped?(args.availability==='out_of_stock'?'out_of_stock':args.status==='all'?'':args.status):''};
 let scoped=rows;
 if(grouped){
  const byId=new Map(families.map(f=>[f.id,f]));
  if(rows.some(sku=>sku.product_family_id&&!byId.has(sku.product_family_id)))throw new AssistantError('inventory_scope_changed',409);
  const products=rows.map(row=>({...row,status:row.status||'active',product_family_name:byId.get(row.product_family_id)?.name_en||''}));
  const catalogue=filterFinishedGoods(families.map(f=>({...f,status:f.status||'active'})),products,categories,filters,tagSnapshot);
  const listing=args.mode==='list',offset=(args.page-1)*20,total=catalogue.groups.length;
  let pageRows=[];
  if(listing){
   if(catalogue.groups.some(g=>!g.product_group_name))throw new AssistantError('inventory_unavailable',503);
   const compare=(a,b)=>a.product_group_name.localeCompare(b.product_group_name,'en')||a.groupKey.localeCompare(b.groupKey,'en');
   pageRows=catalogue.groups.sort(compare).slice(offset,offset+20).map(g=>({
    id:g.groupKey,product_group_name:g.product_group_name,matching_packaging_skus:g.skus.length,
   }));
  }
  return {mode:args.mode,measure:'product',query:args.query,status:args.status,availability:args.availability,...labelScope,aggregate_complete:true,total_matching:total,rows:pageRows,
   ...(listing?{page:args.page,page_size:20,pageable:true,returned_count:pageRows.length,truncated:offset+pageRows.length<total}:{}),
   capability:'read_factory_finished_goods',version:4,source:'/factory/warehouse/finished-goods',scope:'Factory shared grouped catalogue · current Admin permissions',
   as_of:new Date().toISOString(),completeness:{aggregate_scope:'complete_filtered_scope',row_scope:listing?'bounded_projection':'summary_only'},
   limitations:'Counts configured product families and standalone SKUs using the Admin grouped view. This is not the total packaging SKU count. Source snapshots are non-atomic.'};
 }
 if(category||tag)scoped=filterFinishedGoods([],rows,categories,filters,tagSnapshot).rows;
 const queryRows=scoped.filter(x=>(args.status==='all'||x.status===args.status)&&(args.uom===null||stockUnit(x.uom)===stockUnit(args.uom))&&(args.sku===null||stockSku(x.product_code)===stockSku(args.sku))&&
  [x.product_name,x.product_name_en,x.product_name_cn,x.product_name_bm,x.product_code].join(' ').toLowerCase().includes(args.query.toLowerCase()));
 const isLow=x=>x.current_balance!==null&&x.min_stock_level>0&&x.current_balance<x.min_stock_level;
 const isOut=x=>x.current_balance!==null&&x.current_balance<=0;
 const matching=queryRows.filter(x=>args.availability==='all'||args.availability==='out_of_stock'&&isOut(x)||args.availability==='low'&&isLow(x));
 const page=stockPage(matching,args,'product_name');
 if(category||tag)page.rows=page.rows.map(row=>Object.fromEntries(skuFields.split(',').map(key=>[key,row[key]])));
 if(args.mode==='detail'&&matching.length>1)throw new AssistantError('inventory_detail_ambiguous',409);
 return {mode:args.mode,page:args.page,page_size:20,sku:args.sku,detail_found:args.mode==='detail'?matching.length===1:null,aggregate_complete:true,
  capability:'read_factory_finished_goods',version:4,source:'/factory/warehouse/finished-goods',scope:'Factory shared catalogue · current Admin permissions',as_of:new Date().toISOString(),
  measure:'sku',query:args.query,availability:args.availability,uom:args.uom,status:args.status,...labelScope,total_scoped_products:queryRows.length,low_stock_count:queryRows.filter(isLow).length,
  out_of_stock_count:queryRows.filter(isOut).length,unknown_minimum_count:queryRows.filter(x=>x.min_stock_level===null||x.min_stock_level<=0).length,
  ...page,returned:page.rows.length,
  completeness:{aggregate_scope:'complete_filtered_scope',row_scope:'bounded_projection',total_assertion:'Use explicit catalogue totals and ranking metadata. Rows are paginated at 20; summary has no rows.'},
  limitations:'Counts here are packaging SKUs. Current aggregate balance, not reserved/ATP stock. Low means strictly below a recorded positive minimum; absent/zero minimum is unknown. Company/Outlet attribution is outside this read. Snapshot and row read are not atomic.'};

}

// Stock classifications are canonical tool facts, never free-form model inference.
export function lowStockSummary(evidence){
 const shown=evidence.rows.slice(0,10);
 return [`${evidence.total_matching} product(s) below a recorded positive minimum.`,...shown.map(x=>`• ${String(x.product_name||x.product_code).slice(0,80)}: ${x.current_balance} ${x.uom||''}; minimum ${x.min_stock_level} ${x.uom||''}.`),...(evidence.total_matching>shown.length?[`Showing ${shown.length} of ${evidence.total_matching} matches.`]:[]),`${evidence.unknown_minimum_count} product(s) have no valid minimum threshold. Their low-stock status is UNKNOWN; they are not classified as low or healthy.`,`Scope: ${evidence.scope}. Read at ${evidence.as_of}.`,`Source: ${evidence.source}. Current aggregate balances, not reserved or available-to-promise stock.`].join('\n');
}

function unfilteredSkuList(evidence){
 return evidence?.capability==='read_factory_finished_goods'&&evidence.mode==='list'&&evidence.measure==='sku'&&
  evidence.aggregate_complete===true&&evidence.status==='all'&&evidence.availability==='all'&&
  evidence.query===''&&evidence.sku===null&&evidence.uom===null&&!evidence.ranking&&!evidence.category_name&&!evidence.tag_name;
}

async function planTextPage(prompt,history){
 const page=Number(prompt.match(/^\s*(?:please\s+)?(?:show|list|display)\s+(?:me\s+)?page\s+(\d+)\b/i)?.[1]);
 if(!Number.isInteger(page)||page<1||page>50||!(/\bSKUs?\b/i.test(prompt)&&/\bbalances?\b/i.test(prompt))||
  /\b(?:and|also|then)\s+(?:what|how|which|why|show|list|find|explain|compare|calculate)\b|\b(?:rank|sort|compare|minimum|forecast|value|cost|except|excluding|only)\b/i.test(prompt))
  return null;
 if(page===1&&(!/\bFinished Goods\b/i.test(prompt)||!/\b(?:including inactive|all statuses|unfiltered)\b/i.test(prompt)))return null;
 let previousTotal;
 if(page>1){
  if(!/\b(?:Finished Goods|(?:those|these|the same)\s+(?:products|SKUs?))\b/i.test(prompt))return null;
  const turns=(await history?.())?.turns;
  const previous=turns?.filter(turn=>turn.state==='completed').at(-1);
  if(previous?.tool_state!=='completed'||!unfilteredSkuList(previous.evidence)||previous.evidence.page!==page-1)return null;
  previousTotal=previous.evidence.total_matching;
 }
 return {args:{...groupedProductSummary,mode:'list',measure:'sku',page},previousTotal};
}

function completeTextPage(evidence,plan){
 if(!unfilteredSkuList(evidence)||evidence.page!==plan.args.page||
  plan.previousTotal!==undefined&&plan.previousTotal!==evidence.total_matching)return null;
 const {rows,total_matching:total,page_size:size}=evidence;
 const page=evidence.page;
 if(!Number.isSafeInteger(total)||size!==20||!Array.isArray(rows)||
  rows.length!==Math.min(size,Math.max(0,total-(page-1)*size))||rows.some(row=>!row.product_code))return null;
 const items=rows.map(row=>'- '+row.product_code+': '+(row.current_balance==null?'balance unavailable':
  [row.current_balance,row.uom].filter(value=>value!=null&&value!=='').join(' ')));
 return ['Page '+page+': '+rows.length+' packaging SKU'+(rows.length===1?'':'s')+'. Catalogue total: '+total+' packaging SKUs.',...items].join('\n');
}

function groupedCountIntent(prompt){
 if(!/\b(?:factory|finished goods|FG|kilang|produk siap)\b|工厂|工廠|成品/iu.test(prompt)||
  !/\b(?:grouped|product groups?|product famil(?:y|ies)|keluarga produk|kumpulan produk)\b|成品分组|成品分組|产品组|產品組|产品系列|產品系列/iu.test(prompt)||
  /\b(?:packaging SKUs?|how many SKUs?|SKU count|number of SKUs?)\b|(?:包装|包裝)\s*SKU|\b(?:and|versus|vs|serta)\b[^?。]{0,35}\bSKUs?\b|(?:和|与|與|以及).{0,10}SKU/iu.test(prompt))return null;
 if(/\b(?:list|names?|senarai(?:kan)?)\b|列出|列举|列舉|清单|清單/iu.test(prompt))return 'grouped_product_list';
 return /\b(?:how many|count|number of|jumlah|berapa)\b|多少|几[个個种種]|幾[个個种種]|数量|數量/iu.test(prompt)?'grouped_product_count':null;
}
function groupAnswer(e,prompt,{medium='text'}={}){
 if(e.measure!=='product'||!e.aggregate_complete||!Number.isSafeInteger(e.total_matching))return null;
 const zh=/\p{Script=Han}/u.test(prompt),ms=!zh&&/\b(?:berapa|jumlah|kilang|kumpulan|produk)\b/iu.test(prompt);
 const scope=[e.query,e.category_name,e.tag_name,e.status!=='all'&&e.status,
  e.availability==='out_of_stock'&&(zh?'缺货':ms?'habis stok':'out of stock')].filter(Boolean).join(' · ');
 const text=zh?e.total_matching+' 个成品组':ms?e.total_matching+' kumpulan produk':e.total_matching+' grouped product'+(e.total_matching===1?'':'s');
 const summary=text+(scope?' ('+scope+')':'')+(zh?'。':'.');
 if(e.mode!=='list')return summary;
 if(!Array.isArray(e.rows)||e.rows.some(row=>!row.product_group_name||!Number.isSafeInteger(row.matching_packaging_skus)))return null;
 const page=zh?'第 '+e.page+' 页':ms?'Halaman '+e.page:'Page '+e.page;
 if(!e.rows.length)return summary+' '+page+(zh?'没有记录。':ms?' tiada rekod.':' has no matching records.');
 const rows=medium==='voice'?e.rows.slice(0,3):e.rows;
 const entries=rows.map(r=>{
  const count=r.matching_packaging_skus,unit=zh?'个匹配的包装 SKU':ms?'SKU pembungkusan sepadan':'matching packaging SKU'+(count===1?'':'s');
  return r.product_group_name+' ('+count+' '+unit+')';
 });
 const sample=rows.length<e.rows.length?(zh?'，前 '+rows.length+' 个':ms?', '+rows.length+' pertama':', first '+rows.length):'';
 return summary+' '+page+sample+' · '+entries.join(medium==='voice'?', ':'\n');
}

// Factory owns the schema, permission, bounded read and evidence semantics.
export const finishedGoodsRead = Object.freeze({
 moduleInterface:declareReadInterface({module_id:'factory_finished_goods',version:4,permission:'factory_finished_goods.view',scope:'Factory shared catalogue',source:'/factory/warehouse/finished-goods',properties:inventoryTool.parameters.properties,interface:{semantics:{
  entities:['packaging SKU','finished product family'],time:'Current Factory shared catalogue; separate identity and row reads.',
  relationships:['A product groups its packaging SKUs. A SKU outside a family is one standalone product.'],
  metrics:{
   product_count:{field:'total_matching',unit:'products',definition:'Admin grouped-view count after the selected product/SKU name, status, category and family-tag filters. Includes matching configured families without SKUs and standalone SKUs.'},
   packaging_sku_count:{field:'total_matching',unit:'SKUs',definition:'Matching packaging SKU records in SKU mode.'},
   recorded_balance:{field:'rows[].current_balance',unit_field:'rows[].uom',definition:'Current aggregate SKU balance. Rank within one recorded unit.'},
   low_stock_count:{field:'low_stock_count',unit:'SKUs',definition:'Below a strictly positive recorded minimum. A missing or zero minimum is unknown.'},
  }},queryKinds:['summary','count','list','search','detail','filter','rank'],authority:'factory_get_master_id_snapshot + authorized FG catalogue and family tags',aggregates:'complete_filtered_scope',fields:['measure','rows','query','status','availability','category_name','tag_name','total_scoped_products','total_matching','unknown_minimum_count','low_stock_count','out_of_stock_count','ranking'],pagination:'Complete identity/count-checked SKU and grouped catalogues. Both page at 20. Group pages are ordered by name then canonical group identity. Non-atomic source snapshots.',unsupported:['Category or tag rollups, low-minimum group counts, per-location stock and valuation are outside this read.']}}),
 id:inventoryTool.name, module_id:'factory_finished_goods', kind:'READ', version:4,
 label:'Factory Finished Goods', permission:'factory_finished_goods.view',
 discoveryPhrases:['finished goods','produk siap','成品库存','成品庫存'],
 discoveryFamily:'factory_stock_catalogue',
 queryIntent:groupedCountIntent,
 scope:'Factory shared catalogue · current Admin permissions',
 scopeTextArguments(args,prompt,intent){
  if(!args||typeof args!=='object'||Array.isArray(args))return args;
  if(intent==='grouped_product_count')args={...args,measure:'product',mode:'summary'};
  if(intent==='grouped_product_list')args={...args,measure:'product',mode:'list'};
  // Only discard suggested filters when every word of a count question names
  // the full grouped population. A supplied qualifier keeps its scope.
  if(args.measure==='product'&&/\b(?:catalogue|catalog)\b/iu.test(prompt)&&/\b(?:factory|finished goods)\b/iu.test(prompt)&&/\b(?:how many|count|total|number)\b/iu.test(prompt)&&
   !prompt.replace(/\b(?:how|many|count|total|number|what|is|are|the|of|in|our|all|have|we|do|currently|current|factory|fg|finished|goods|grouped|groups?|product|products|families|catalogue|catalog)\b|[\p{P}\s]/giu,'')){
   return {...args,query:'',status:'all',availability:'all',category_name:null,tag_name:null};
  }
  const explicit=[...new Set([...prompt.matchAll(/\bSKU\s+["“']?([a-z0-9][a-z0-9_-]{0,79})/gi)].map(match=>match[1]))];
  if(explicit.length!==1||!/[0-9]/.test(explicit[0])||
   !/\b(?:finished goods|FG)\b[^.?!;\n]{0,40}\b(?:balance|stock|availability)\b[^.?!;\n]{0,24}\bSKU\b/i.test(prompt)||
   /\b(?:rank|highest|lowest|top|compare|versus)\b/i.test(prompt))return args;
  return {...args,mode:'detail',measure:'sku',page:1,sku:explicit[0],query:'',sort:'name',uom:args.uom===''?null:args.uom??null};
 },
 tool:inventoryTool, validate:inventoryArguments, execute:readInventory,
 testArguments:{query:'',availability:'all'}, authorized:access=>!!access.factory, deniedCode:'factory_read_denied',
 format:(evidence,prompt,options)=>groupAnswer(evidence,prompt,options)|| (evidence.availability==='low'?lowStockSummary(evidence):null),
 planTextPage,completeTextPage,
});
