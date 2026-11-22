import {countedRows,invalidArgument,page,readContract,uuid} from '../assistant/readContract.js';
import {exactName} from '../assistant/entityResolution.js';

const fields=['id','inventory_item_id','outlet_id','par_level','storage_location','is_active','updated_at'];
const optionalName={type:'string',nullable:true,maxLength:120};
export const parLevelRead=readContract({
 id:'read_inventory_par_levels',module_id:'inventory_par_levels',version:2,label:'Restaurant inventory par levels',
 permission:'inventory_par_levels.view',outletScope:true,source:'/restaurant/inventory/par-levels',
 scope:'Configured item-to-outlet links visible to the user in the requested outlet.',
 description:'Count or list inventory par settings for an outlet. Provide an exact item name or SKU when known. Use positive par scope for configured positive par levels. Par is the configured target in the item unit, not a measured stock balance.',
 properties:{page,outlet_id:uuid,mode:{type:'string',enum:['list','summary']},item_name:optionalName,sku:optionalName,par_scope:{type:'string',enum:['all','positive']}},
 normalizeArguments:a=>a&&typeof a==='object'&&!Array.isArray(a)?{page:1,mode:'list',item_name:null,sku:null,par_scope:'all',...a}:a,
 check(a){
  if(a.mode==='summary'&&a.page!==1)invalidArgument('unsupported_value','page');
  for(const key of ['item_name','sku'])if(a[key]!==null&&!a[key].trim())invalidArgument('nonblank_text_or_null',key);
 },pageableModes:['list'],
 async load(caller,a,signal){
  const inner=a.item_name||a.sku?'!inner':'';
  const projection=fields.join(',')+',item:inventory_items'+inner+'(item_name,sku_code,unit)';
  let q=caller.from('inventory_item_outlets').select(projection,{count:'exact',head:a.mode==='summary'}).eq('outlet_id',a.outlet_id);
  if(a.item_name)q=exactName(q,'item.item_name',a.item_name.trim());
  if(a.sku)q=exactName(q,'item.sku_code',a.sku.trim());
  if(a.par_scope==='positive')q=q.gt('par_level',0);
  const result=await countedRows(q.order('id'),a,[...fields,'item'],signal);
  return {...result,rows:result.rows.map(({item,...row})=>({...row,item_name:item?.item_name??null,sku:item?.sku_code??null,unit:item?.unit??null}))};
 },
 project:data=>data,
 interface:{authority:'Restaurant par levels · inventory_item_outlets and visible inventory item identity',
  fields:[...fields,'item_name','sku','unit'],queryKinds:['count','summary','list','filter'],
  aggregates:'complete_filtered_scope',pagination:'Exact count of matching item-to-outlet configurations, 20 per page. An absent par is not a zero stock balance.',
  semantics:{entities:['outlet inventory item','SKU','par configuration'],time:'Currently recorded par settings.',
   relationships:['Par belongs to an item-to-outlet link and is distinct from an observed Inventory Dashboard count.'],
   metrics:{par_level:{field:'rows[].par_level',unit_field:'rows[].unit',definition:'Recorded par target for this item at this outlet; item master provides its UOM.'},
    configuration_count:{field:'total_matching',unit:'configurations',definition:'Number of matching item-to-outlet links before paging.'}}}},
});
