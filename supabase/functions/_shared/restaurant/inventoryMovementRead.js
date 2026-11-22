import { AssistantError } from '../assistantError.js';
import { countedRows, date, page, readContract, uuid } from '../assistant/readContract.js';

const fields = ['id','outlet_id','inventory_item_id','movement_type','quantity','unit','reference_type','reference_no','created_at'];
const types = ['Purchase','Waste','Adjustment','Transfer In','Transfer Out'];

export const inventoryMovementRead = readContract({
 id:'read_inventory_movements',module_id:'inventory_movements',version:2,
 label:'Recorded inventory movements',permission:'inventory_movements.view',source:'/sales-purchase',
 scope:'One authorized outlet. Optional recorded movement type and inclusive business-date range.',
 discoveryPhrases:['inventory movements','stock movements','pergerakan inventori','出入库','出入庫','库存变动','庫存異動'],
 description:'Count or list posted Restaurant Inventory Movements at one outlet. Filter by recorded movement type and date range. Count means number of movement records. Quantity and unit are shown per record. This is not a current stock balance or a sum of quantities.',
 properties:{page,outlet_id:uuid,mode:{type:'string',enum:['list','summary']},
  movement_type:{type:'string',nullable:true,enum:types},from:{...date,nullable:true},to:{...date,nullable:true}},
 normalizeArguments:args=>args&&typeof args==='object'&&!Array.isArray(args)
  ? {page:1,mode:'list',movement_type:null,from:null,to:null,...args}:args,
 check(args){
  const {from,to}=args;
  if(args.mode==='summary'&&args.page!==1||(from===null)!==(to===null)||from&&to&&
   (from>to||Date.parse(to)-Date.parse(from)>366*86400000))
   throw new AssistantError('tool_arguments_invalid',400);
 },
 outletScope:true,
 async load(caller,args,signal){
  let query=caller.from('inventory_movements').select(fields.join(','),{count:'exact',head:args.mode==='summary'})
   .eq('outlet_id',args.outlet_id);
  if(args.movement_type)query=query.eq('movement_type',args.movement_type);
  // The current Inventory Movements service uses the ISO date of created_at.
  if(args.from){
   const end=new Date(Date.parse(args.to)+86400000).toISOString();
   query=query.gte('created_at',args.from+'T00:00:00.000Z').lt('created_at',end);
  }
  return countedRows(query.order('created_at',{ascending:false}).order('id'),args,fields,signal);
 },
 project:data=>data,
 interface:{queryKinds:['count','summary','list','filter'],fields,
  authority:'Inventory Movements service · inventory_movements under human RLS',
  aggregates:'complete_filtered_scope',pagination:'Exact filtered record count; list pages of 20.',
  unsupported:['Item or reference search, grouped movement totals, amount aggregation and current stock balances are outside this capability.']},
});
