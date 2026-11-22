import {AssistantError} from '../assistantError.js';
import {outletDirectory,resolveOutlet} from '../assistant/entityResolution.js';
import {page,permittedOutlet,readContract,rowsEvidence,uuid} from '../assistant/readContract.js';

const fields=['id','item_name','sku_code','category_id','unit','inventory_type','status','updated_at'];
const resource=/\b(?:master inventory|restaurant inventory|inventory master|inventory items?|ingredient catalogue|inventori restoran|inventori induk|stok restoran)\b|餐[厅廳][^，。！？]{0,22}(?:库存|庫存|存货|存貨|inventory)|(?:库存|庫存|存货|存貨)(?:主档|主檔|目录|目錄)/iu;
const count=/\b(?:count|how many|number of|berapa|bilangan|jumlah)\b|多少[种種项項个個]?|几[种项]|幾[種項]|数量|數量/iu;
const details=/\b(?:movements?|transactions?|transfers?|wastage|par levels?|reconciliation|adjustments?|stock checks?|purchase orders?|(?:stock|inventory) balances?|on hand|quantity left)\b|出入库|出入庫|库存余量|庫存餘量|库存余额|庫存餘額|盘点|盤點|调拨|調撥|报损|報損/iu;
const catalogueCount=/\b(?:items?|skus?|types?|kinds?|jenis)\b|[几幾多少][种種项項]/iu;
export const eachInventoryOutlet=/\b(?:each|every|all|per|by|across)\s+(?:active\s+)?(?:outlets?|branches?|cawangan)\b|\bsetiap\s+(?:cawangan|kedai)\b|每[一间間个個家]*(?:门店|門店|分店|餐厅|餐廳)|各(?:个|個)?(?:门店|門店|分店)|按(?:门店|門店|分店)/iu;

async function loadInventory(caller,args,signal){
 const directory=!args.outlet_names.length&&!args.outlet_id&&!args.outlet_name
  ?(await outletDirectory(caller,signal)).filter(outlet=>outlet.is_active===true):null;
 if(directory?.length>25)throw new AssistantError('entity_scope_required',409);
 const named=args.outlet_name||args.outlet_id?await resolveOutlet(caller,args,signal):null;
 if((args.outlet_name||args.outlet_id)&&!named)throw new AssistantError('entity_unresolved',409);
 const selected=await Promise.all(args.outlet_names.map(outlet_name=>resolveOutlet(caller,{outlet_name},signal)));
 if(selected.some(outlet=>!outlet))throw new AssistantError('entity_unresolved',409);
 const outlets=named?[named]:selected.length?[...new Map(selected.map(outlet=>[outlet.id,outlet])).values()]:directory;
 if(outlets&&!outlets.length)throw new AssistantError('entity_scope_required',409);
 const select=(scope,head=false)=>{
  const link=scope? ',inventory_item_outlets!inner(outlet_id)':'';
  let query=caller.from('inventory_items').select((head?'id':fields.join(','))+link,head?{count:'exact',head:true}:undefined);
  if(scope)query=query.in('inventory_item_outlets.outlet_id',scope.map(outlet=>outlet.id));
  if(args.status!=='all')query=query.eq('status',args.status);
  return query;
 };
 if(outlets)await Promise.all(outlets.map(outlet=>permittedOutlet(caller,outlet.id,signal)));
 async function exactCount(scope){
  const {count,error}=await select(scope,true).abortSignal(signal);
  if(error?.code==='42501')throw new AssistantError('business_read_denied',403);
  if(error||!Number.isSafeInteger(count)||count<0)throw new AssistantError('business_read_unavailable',503);
  return count;
 }
 if(args.mode==='summary'&&args.outlet_scope==='each_outlet'&&!named){
  const by_outlet=[];
  // Each count applies the same status and RLS; no partial set is labeled complete.
  for(const outlet of outlets)by_outlet.push({outlet,total_matching:await exactCount([outlet])});
  return {by_outlet,aggregate_complete:true,rows:[]};
 }
 const outlet=named?{outlet:named}:{};
 if(args.mode==='summary')return {...outlet,total_matching:await exactCount(outlets),aggregate_complete:true,rows:[]};
 const {data,error}=await select(outlets).order('id').range((args.page-1)*20,args.page*20).abortSignal(signal);
 if(error)throw new AssistantError(error.code==='42501'?'business_read_denied':'business_read_unavailable',error.code==='42501'?403:503);
 return {...outlet,...rowsEvidence(data,fields)};
}

export const inventoryMasterRead=readContract({
 id:'read_inventory_items',version:2,module_id:'inventory_master',label:'Restaurant Master Inventory items',
 permission:'inventory_master.view',source:'/restaurant/inventory/master',
 scope:'Master Inventory items linked to authorized outlets. Per-outlet counts cover active authorized outlets unless a specific outlet is named.',
 discoveryPhrases:['Master Inventory','Restaurant inventory','inventory items','inventori restoran','inventori induk','餐厅库存','餐廳庫存','库存主档'],
 queryIntent(prompt){
  if(!resource.test(prompt)||details.test(prompt)||/\bfactory\b|工厂|工廠/iu.test(prompt)&&! /master inventory|restaurant|餐[厅廳]/iu.test(prompt))return null;
  if(count.test(prompt)&&(catalogueCount.test(prompt)||!/\b(?:balance|stock quantity|units left)\b|剩[余餘下]/iu.test(prompt)))return 'catalogue_count';
  return /\b(?:list|show|senaraikan)\b|列出|清单|清單/iu.test(prompt)?'catalogue_list':null;
 },
 description:'Restaurant Master Inventory catalogue. Count item types linked to one or each authorized outlet, or list registered items. This does not read equipment assets, movements or physical stock quantities. For item counts use summary and active status unless explicitly asked for other statuses. To break down named outlets use each_outlet with outlet_names. For every authorized active outlet use each_outlet with an empty list. Use accessible for a distinct total across active authorized outlets.',
 properties:{page,outlet_id:{...uuid,nullable:true},outlet_name:{type:'string',nullable:true,maxLength:120},
  outlet_scope:{type:'string',enum:['catalogue','named','accessible','each_outlet']},
  outlet_names:{type:'array',maxItems:12,items:{type:'string',maxLength:120}},
  mode:{type:'string',enum:['list','summary']},status:{type:'string',enum:['active','inactive','all']}},
 normalizeArguments(args){
  if(!args||typeof args!=='object'||Array.isArray(args))return args;
  return {page:1,outlet_id:null,outlet_name:null,outlet_names:[],outlet_scope:'catalogue',mode:'list',status:args.mode==='summary'?'active':'all',...args};
 },
 check(args){
  const named=!!(args.outlet_id||args.outlet_name);
  if(args.outlet_scope==='named'&&!named)throw new AssistantError('entity_scope_required',409);
  if(args.outlet_names.length&&(named||args.outlet_scope!=='each_outlet')||
   named&&['accessible','each_outlet'].includes(args.outlet_scope)||args.mode==='list'&&args.outlet_scope==='each_outlet'||
   args.mode==='summary'&&(args.page!==1||args.outlet_scope==='catalogue'&&!named))throw new AssistantError('tool_arguments_invalid',400);
 },
 prepareArguments(prompt){
  if(!count.test(prompt)||/\b(?:category|categories|supplier|brand|recipe|cost|price|compare|excluding|last year|last month|yesterday)\b|类别|類別|供应商|供應商|品牌|价格|價格|排除|去年|上月|昨天/iu.test(prompt))return null;
  const all=/\b(?:including inactive|all statuses|active and inactive)\b|包括(?:已)?停用/iu.test(prompt);
  return {page:1,mode:'summary',status:all?'all':/\b(?:inactive only|inactive items?|tidak aktif)\b|停用/iu.test(prompt)?'inactive':'active',
   outlet_scope:eachInventoryOutlet.test(prompt)?'each_outlet':'accessible'};
 },
 format(e,prompt){
  if(!e.aggregate_complete)return null;
  const chinese=/\p{Script=Han}/u.test(prompt),malay=!chinese&&/\b(?:berapa|setiap|inventori|bilangan)\b/iu.test(prompt);
  const status=e.requested_scope?.status;
  const label=chinese?(status==='all'?'库存品项':status==='inactive'?'已停用库存品项':'启用的库存品项'):
   malay?(status==='all'?'item inventori':status==='inactive'?'item inventori tidak aktif':'item inventori aktif'):
   (status==='all'?'inventory items':status==='inactive'?'inactive inventory items':'active inventory items');
  if(e.by_outlet)return (chinese?'各门店的'+label+'：':malay?'Bilangan '+label+' mengikut cawangan:':label[0].toUpperCase()+label.slice(1)+' by outlet:')+'\n'+
   e.by_outlet.map(row=>'- '+row.outlet.name+': '+row.total_matching).join('\n');
  return (e.outlet?.name||(chinese?'已授权的营业门店':malay?'Cawangan aktif yang dibenarkan':'Authorized active outlets'))+
   (chinese?'有 '+e.total_matching+' 种'+label+'。':': '+e.total_matching+' '+label+'.');
 },
 load:loadInventory,project:data=>data,
 interface:{authority:'Master Inventory items and unique item-to-outlet configuration under human RLS',
  queryKinds:['summary','count','list','filter','group'],fields,
  aggregates:'source_reported',pagination:'Exact active/item-status counts are separate from the 20-row catalogue pages. Per-outlet counts must not be added to claim a distinct total.',
  unsupported:['Physical balance, price, stock movement history and historical catalogue counts are not provided by Master Inventory.']},
});
