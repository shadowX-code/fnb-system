import { exactName,sourceRows } from '../assistant/entityResolution.js';
import { countedRows, date, invalidArgument, page, readContract, requireArgumentValues, uuid } from '../assistant/readContract.js';

const fields = ['id','outlet_id','inventory_item_id','movement_type','quantity','unit','reference_type','reference_no','created_at'];
const types = ['Purchase','Waste','Adjustment','Transfer In','Transfer Out'];

export const inventoryMovementRead = readContract({
 id:'read_inventory_movements',module_id:'inventory_movements',version:3,
 label:'Recorded inventory movements',permission:'inventory_movements.view',source:'/restaurant/inventory/movements',
 scope:'One authorized outlet. Filter by recorded movement type, item, reference or inclusive business-date range.',
 discoveryPhrases:['inventory movements','stock movements','pergerakan inventori','出入库','出入庫','库存变动','庫存異動'],
 queryIntent(prompt){
  return /\b(?:inventory movements?|stock movements?|pergerakan inventori)\b|库存变动|庫存異動|出入[库庫]/iu.test(prompt)&&
   !/\b(?:asset|fork|spoon|factory|also|and what|and how)\b|资产|資產|工厂|工廠|另外|以及/iu.test(prompt)?'inventory_movements':null;
 },
 pageableModes:['list'],
 description:'Count or list posted Restaurant Inventory Movements at one outlet. For summary use page 1. Supply both from and to for an inclusive date range of up to 366 days between endpoints, or use null for both. Use item_query for an exact item name or SKU and reference for an exact reference number. Count means number of movement records. Quantity and unit are shown per record. This is not a current stock balance or a sum of quantities.',
 properties:{page,outlet_id:uuid,mode:{type:'string',enum:['list','summary']},
  movement_type:{type:'string',nullable:true,enum:types},from:{...date,nullable:true},to:{...date,nullable:true},item_query:{type:'string',maxLength:120,nullable:true},reference:{type:'string',maxLength:120,nullable:true}},
 normalizeArguments:args=>args&&typeof args==='object'&&!Array.isArray(args)
  ? {page:1,mode:'list',movement_type:null,from:null,to:null,item_query:null,reference:null,...args}:args,
 check(args){
  const {from,to}=args;
  for(const field of ['item_query','reference'])if(args[field]!==null&&!args[field].trim())invalidArgument('unsupported_value',field);
  if(args.mode==='summary')requireArgumentValues(args,{page:1});
  if((from===null)!==(to===null))invalidArgument('paired_dates_required',from===null?'from':'to');
  if(from&&to&&(from>to||Date.parse(to)-Date.parse(from)>366*86400000))
   invalidArgument('invalid_date_range','to');
 },
 outletScope:true,
 async load(caller,args,signal){
  let query=caller.from('inventory_movements').select(fields.join(','),{count:'exact',head:args.mode==='summary'})
   .eq('outlet_id',args.outlet_id);
  let item;
  if(args.item_query){
   const value=args.item_query.trim();
   const items=()=>caller.from('inventory_items').select('id,item_name,sku_code');
   let matches=await sourceRows(exactName(items(),'sku_code',value).limit(2),signal);
   if(!matches.length)matches=await sourceRows(exactName(items(),'item_name',value).limit(2),signal);
   if(matches.length!==1)return {rows:[],match_status:matches.length?'ambiguous':'not_found'};
   [item]=matches;
   query=query.eq('inventory_item_id',item.id);
  }
  if(args.reference)query=query.eq('reference_no',args.reference.trim());
  if(args.movement_type)query=query.eq('movement_type',args.movement_type);
  // The current Inventory Movements service uses the ISO date of created_at.
  if(args.from){
   const end=new Date(Date.parse(args.to)+86400000).toISOString();
   query=query.gte('created_at',args.from+'T00:00:00.000Z').lt('created_at',end);
  }
  const result=await countedRows(query.order('created_at',{ascending:false}).order('id'),args,fields,signal);
  const ids=[...new Set(result.rows.map(row=>row.inventory_item_id).filter(Boolean))];
  // The UI joins the same human-visible directory. Read only identities needed on this page.
  const knownItems=item?[item]:ids.length
   ?await sourceRows(caller.from('inventory_items').select('id,item_name,sku_code').in('id',ids),signal):[];
  const names=new Map(knownItems.map(row=>[row.id,row]));
  return {...result,rows:result.rows.map(row=>{
   const known=names.get(row.inventory_item_id);
   return {...row,item_name:known?.item_name??null,sku:known?.sku_code??null};
  }),...item&&result.total_matching>0?{item:{name:item.item_name,sku:item.sku_code}}:{}};
 },
 project:data=>data,
 interface:{queryKinds:['count','summary','list','filter'],fields:[...fields,'item_name','sku'],
  authority:'Inventory Movements service · inventory_movements and item directory under human RLS',
  semantics:{entities:['inventory item','stock movement','outlet'],time:'Recorded UTC created_at date, inclusive of both supplied dates.',
   relationships:['A posted movement identifies its outlet and item. Recorded quantities have a per-record unit.'],
   metrics:{
    movement_record_count:{field:'total_matching',unit:'movement records',definition:'Matching movement events after outlet, item, reference, type and date filters.'},
    recorded_quantity:{field:'rows[].quantity',unit_field:'rows[].unit',definition:'Quantity on one posted ingredient movement. No current balance or cross-unit total.'},
   }},
  aggregates:'complete_filtered_scope',pagination:'Exact filtered record count; list pages of 20.',
  unsupported:['Grouped movement quantities, valuation and current stock balances are outside this capability.']},
});
