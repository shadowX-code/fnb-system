import {AssistantError} from '../assistantError.js';
import {exactName,resolveOutlet,sourceRows} from '../assistant/entityResolution.js';
import {page,pick,readContract,rowsEvidence,uuid} from '../assistant/readContract.js';

const fields=['outlet_id','item_id','state','check_id','check_date','submitted_at','actual_count','current_par','submitted_par','movement_relation'];
const states=['below_par','sufficient','changed','unverified'];
const onHand=/\b(?:on hand|current stock balance|physical stock|verified stock|baki stok)\b|库存余量|庫存餘量|库存余额|庫存餘額|实物库存|實物庫存/iu;
const restaurant=/\b(?:restaurant|inventory dashboard|inventori restoran|outlet)\b|餐厅|餐廳|门店|門店|库存看板|庫存看板/iu;

export const inventoryStockEvidenceRead=readContract({
 id:'read_inventory_stock_evidence',module_id:'inventory_dashboard',version:2,label:'Restaurant Inventory Dashboard stock evidence',
 permission:'inventory_dashboard.view',source:'/restaurant/inventory/dashboard',
 scope:'One authorized outlet; active item positions with a positive par level in Inventory Dashboard.',
 discoveryPhrases:['inventory dashboard','restaurant on hand','restaurant stock balance','verified stock count','baki stok restoran','餐厅库存余量'],
 queryIntent(prompt){
  return onHand.test(prompt)&&restaurant.test(prompt)&&!/\b(?:factory|asset|movements?|also|and what|and how)\b|工厂|工廠|资产|資產|出入[库庫]|另外|以及/iu.test(prompt)?'restaurant_stock_evidence':null;
 },
 description:'Read Inventory Dashboard evidence for one authorized restaurant outlet, optionally for an exact item name or SKU. This source covers active positive-par positions. Sufficient or below_par means the latest count is usable under the source evidence rules; changed or unverified does not establish a current quantity. Show count date and evidence state. A missing position does not mean zero stock. Do not use this read as an all-items live stock ledger.',
 properties:{outlet_id:{...uuid,nullable:true},outlet_name:{type:'string',maxLength:120,nullable:true},
  page,item_query:{type:'string',maxLength:120,nullable:true}},
 normalizeArguments:args=>args&&typeof args==='object'&&!Array.isArray(args)?{outlet_id:null,outlet_name:null,page:1,item_query:null,...args}:args,
 async load(caller,args,signal){
  if(!args.outlet_id&&!args.outlet_name)throw new AssistantError('entity_scope_required',409);
  const outlet=await resolveOutlet(caller,args,signal);
  if(!outlet)throw new AssistantError('entity_unresolved',409);
  const {data,error}=await caller.rpc('inventory_dashboard_stock_evidence',{p_outlet_ids:[outlet.id]}).abortSignal(signal);
  if(error||!Array.isArray(data?.positions)||data.positions.length!==data.position_count||
   data.positions.some(row=>row.outlet_id!==outlet.id||!states.includes(row.state))||
   new Set(data.positions.map(row=>row.item_id)).size!==data.positions.length)
   throw new AssistantError(error?.code==='42501'?'business_read_denied':'business_read_unavailable',error?.code==='42501'?403:503);
  let positions=data.positions;
  let item;
  if(args.item_query){
   const wanted=args.item_query.trim();
   const items=()=>caller.from('inventory_items').select('id,item_name,sku_code,unit');
   let matches=await sourceRows(exactName(items(),'sku_code',wanted).limit(2),signal);
   if(!matches.length)matches=await sourceRows(exactName(items(),'item_name',wanted).limit(2),signal);
   if(matches.length!==1)return {outlet,rows:[],match_status:matches.length?'ambiguous':'not_found'};
   [item]=matches;
   positions=positions.filter(row=>row.item_id===item.id);
  }
  const first=(args.page-1)*20;
  const rows=positions.slice(first,first+20).map(row=>({...pick(row,fields),
   confirmed_count:['below_par','sufficient'].includes(row.state)?row.actual_count:null}));
  return {outlet,...rowsEvidence(rows,[...fields,'confirmed_count']),total_matching:positions.length,aggregate_complete:true,
   page:args.page,page_size:20,truncated:positions.length>first+20,match_status:item&&!positions.length?'not_found':'matched',
   ...item&&positions.length?{item:{name:item.item_name,sku:item.sku_code,unit:item.unit}}:{}};
 },
 project:data=>data,
 interface:{authority:'Inventory Dashboard · inventory_dashboard_stock_evidence',fields:[...fields,'confirmed_count'],
  measures:['position_count','last_count_quantity','confirmed_count'],queryKinds:['list','count','detail','search'],
  aggregates:'complete_applicable_positions',pagination:'20 positions per page. Exact position count covers only positive-par positions in this outlet.',
  unsupported:['Live stock for unverified, changed or unconfigured positions, inventory value, equipment assets and Factory stock.']},
});
