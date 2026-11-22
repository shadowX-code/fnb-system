import {malaysiaPeriod,relativeBusinessPeriod} from './assistantBusinessPeriod.js';
import {AssistantError} from '../assistantError.js';
import {countedRows, date, invalidArgument, page, readContract, rowsEvidence, uuid} from '../assistant/readContract.js';
import {exactName,normalizedEntity,resolveOutlet} from '../assistant/entityResolution.js';
import {preferNamedScope} from '../assistant/knowledge.js';

const fields=['id','outlet_id','asset_code','name','unit','current_quantity','minimum_quantity','status','health_status','last_inspection_at','updated_at'];
const balances=/\b(?:each asset|per asset|every asset|asset balances|balances for each|their balances|baki setiap aset)\b|每(?:个|個|项|項)\s*(?:asset|资产|資產)/iu;

const movementFields=['id','movement_date','movement_type','quantity_change','quantity_before','quantity_after'];
const historyRequest=/\b(?:movement(?:s| history)?|transaction history|adjustment history|pergerakan|sejarah)\b|变动|變動|异动|異動|变更记录|調整記錄|调整记录|历史|歷史/iu;
const assetResource=/\b(?:asset(?:s|-[\p{L}\p{N}]+)?|aset|spoons?|forks?|cutlery|utensils?)\b|资产|資產|汤[匙勺]|湯[匙勺]|勺子|叉子|筷子|餐具/iu;
const conciseHistoryFollowUp=/^(?:show (?:me )?)?(?:what about |only |for |how about )?(?:from )?(20\d{2}-\d{2}-\d{2})(?:\s+(?:to|until|through|and)|\s*至)\s*(20\d{2}-\d{2}-\d{2})[?!.。！]?$/iu;
const listRequest=/\b(?:list|show|senaraikan|what assets)\b|列出|清单|清單|有哪些/iu;

async function read(query,signal){
 const {data,error,count}=await query.abortSignal(signal);
 if(error)throw new AssistantError(error.code==='42501'?'business_read_denied':'business_read_unavailable',error.code==='42501'?403:503);
 return {data,count};
}

async function loadAssetCatalogue(caller,args,signal){
 if(!args.outlet_id&&!args.outlet_name)throw new AssistantError('asset_outlet_required',400);
 const outlet=await resolveOutlet(caller,args,signal);
 if(!outlet)throw new AssistantError('asset_outlet_unresolved',409);
 // The operational Asset Tracking list omits archived assets.
 const assets=(columns,options)=>caller.from('asset_items').select(columns,options).eq('outlet_id',outlet.id).neq('status','archived');
 if(['summary','list','summary_with_balances'].includes(args.mode)){
  const result=await countedRows(assets(fields.join(','),{count:'exact',head:args.mode==='summary'})
   .order('name').order('id'),args,fields,signal);
  return {outlet,...result};
 }
 const lookup=async(field,value)=>{
  const {data}=await read(exactName(assets(fields.join(',')),field,value).limit(2),signal);
  if(!Array.isArray(data))throw new AssistantError('business_read_unavailable',503);
  return data;
 };
 const exactCode=await lookup('asset_code',args.query);
 const named=exactCode.length?[]:await lookup('name',args.query);
 // A user may prefix the display name with "asset-" even when no code is recorded.
 const unprefixed=args.query.match(/^asset-([\p{L}\p{N}][\p{L}\p{N} -]*)$/iu)?.[1].replaceAll('-',' ').trim();
 let candidates=exactCode.length?exactCode:named.length?named:unprefixed?await lookup('name',unprefixed):[];
 if(!candidates.length){
  const {data}=await read(assets(fields.join(',')).order('id').limit(201),signal);
  if(!Array.isArray(data))throw new AssistantError('business_read_unavailable',503);
  if(data.length>200)throw new AssistantError('entity_scope_required',409);
  const match=normalizedEntity(data,unprefixed||args.query,['name','asset_code']);
  if(!match&&/\p{Script=Han}/u.test(args.query)&&data.length>0&&data.length<=20){
   return {outlet,match_status:'ambiguous',not_business_evidence:true,no_evidence:true,resolution_required:'cross_language_name',
    candidates:data.map(row=>({name:row.name,code:row.asset_code})),
    instruction:'The original-language name has no literal match. Retry once using the exact authorized candidate name only if it is an unambiguous translation of the requested item. Otherwise ask for the exact name or code. This list contains no quantity evidence.'};
  }
  candidates=match?[match]:[];
 }
 if(args.mode==='movements'&&candidates.length===1){
  const asset=candidates[0];
  let movements=caller.from('asset_movement_logs').select(movementFields.join(','),{count:'exact'})
   .eq('outlet_id',outlet.id).eq('asset_id',asset.id);
  if(args.from)movements=movements.gte('movement_date',args.from).lte('movement_date',args.to);
  const result=await countedRows(movements.order('movement_date',{ascending:false})
   .order('created_at',{ascending:false}).order('id'),args,movementFields,signal);
  return {outlet,asset:{name:asset.name,code:asset.asset_code,unit:asset.unit},match_status:'matched',
   history_source:'asset_movement_logs',...result};
 }
 const match_status=candidates.length===1?'matched':candidates.length?'ambiguous':'not_found';
 return {outlet,match_status,matched_by:match_status==='matched'?(exactCode.length?'asset_code':'name'):null,...rowsEvidence(candidates.length===1?candidates:[],fields)};
}

export const assetCatalogueRead=readContract({
 id:'read_asset_catalogue',version:3,module_id:'asset_tracking',label:'Restaurant Asset Tracking catalogue',
 discoveryPhrases:['asset tracking','restaurant assets','asset balance','asset catalogue','asset movements','cutlery movements','资产变动','资产追踪','资产数量','餐具数量'],
 // Domain intent only. Entities still resolve from the user's words and the authorized catalogue.
 queryIntent(prompt){
  const quantity=/\b(?:balance|quantity|how many|how much|in stock|available|left|count|berapa|baki|bilangan)\b|多少|几[件个把只]|幾[件個把隻]|数量|數量|剩[下余餘]/iu.test(prompt);
  const mixed=/\b(?:also|separately|then|compare|versus)\b|另外|同时|同時|以及|并且|並且|对比|對比/iu.test(prompt)||
   /\band\b/iu.test(prompt)&&!balances.test(prompt);
  if(!assetResource.test(prompt)||mixed)return null;
  if(historyRequest.test(prompt))return 'asset_movements';
  return quantity||listRequest.test(prompt)?'asset_quantity':null;
 },
 permission:'asset_tracking.view',source:'/restaurant/operations/asset-tracking',scope:'Current human permission and one authorized outlet; non-archived Asset Tracking records',
 description:'Read one Restaurant outlet’s Asset Tracking. Use detail for a named asset balance, list for complete-count pages of current assets and balances, summary for record count, and movements for the dated movement history of a named asset. Movements include date, change, before and after quantities, in the recorded asset unit. A movement date filter requires both inclusive dates. No inventory or Factory stock substitution. Never present an ambiguous or unmatched asset as zero.',
 properties:{page,outlet_id:{...uuid,nullable:true,description:'Use null when the user names the outlet.'},outlet_name:{type:'string',maxLength:120,nullable:true,description:'Human outlet name or code, or null for a confirmed outlet.'},mode:{type:'string',enum:['list','summary','detail','summary_with_balances','movements'],description:'Detail gets one named asset balance. Summary counts records. Use list or summary_with_balances for a total and current quantities. Use movements for dated records.'},query:{type:'string',maxLength:80,description:'Exact asset code or name for detail and movements; empty for the catalogue.'},from:{...date,nullable:true},to:{...date,nullable:true}},
 normalizeArguments(a){
  if(!a||typeof a!=='object'||Array.isArray(a))return a;
  const normalized={page:1,outlet_id:null,outlet_name:null,mode:'list',query:'',from:null,to:null,...a};
  if(typeof normalized.query==='string'){
   normalized.query=normalized.query.trim();
   // An explicit asset identity is narrower than an unfiltered summary or list.
   if(normalized.query&&['list','summary'].includes(normalized.mode))normalized.mode='detail';
  }
  if(typeof normalized.outlet_name==='string')normalized.outlet_name=normalized.outlet_name.trim()||null;
  return preferNamedScope(normalized,'outlet_id','outlet_name');
 },
 check(a){
  if(['detail','movements'].includes(a.mode)!==!!a.query)invalidArgument('unsupported_value','query');
  if(['detail','summary'].includes(a.mode)&&a.page!==1)invalidArgument('unsupported_value','page');
  if(a.mode!=='movements'&&(a.from||a.to))invalidArgument('unsupported_value','mode');
  if((a.from===null)!==(a.to===null)||a.from&&a.from>a.to)invalidArgument('invalid_date_range','to');
 },
 pageableModes:['list','summary_with_balances','movements'],
 followUp(prompt,evidence){
  if(evidence.version!==3||!evidence.outlet?.id||!evidence.asset?.name||evidence.requested_scope.mode!=='movements')return null;
  const match=prompt.trim().match(conciseHistoryFollowUp);
  const relative=relativeBusinessPeriod(prompt.replace(/^(?:what about |how about |only |for |那|那么|那麼)/iu,''));
  const period=match?{from:match[1],to:match[2]}:relative?malaysiaPeriod(relative):null;
  if(!period)return null;
  return {mode:'movements',outlet_id:evidence.outlet.id,query:evidence.asset.code||evidence.asset.name,
   page:1,from:period.from,to:period.to};
 },
 scopeTextArguments(args,prompt){
  if(!args||typeof args!=='object'||Array.isArray(args)||!historyRequest.test(prompt)||!assetResource.test(prompt))return args;
  return {...args,mode:'movements'};
 },
 prepareArguments(prompt){
  if(historyRequest.test(prompt)||/\b(?:compare|excluding|by category|condition|value|valuation|cost|since|before|after|between|as of|last year|last month|yesterday|low stock)\b|分类|分類|估值|排除|截至|去年|上月|昨天|低于|低於/iu.test(prompt))return null;
  if(balances.test(prompt)||listRequest.test(prompt)&&/\bassets\b|资产|資產|餐具/iu.test(prompt)&&!/\b(?:fork|spoon|asset-)\b|汤[匙勺]|湯[匙勺]|叉子/iu.test(prompt))
   return {mode:'summary_with_balances',query:''};
  if(/\b(?:current asset records?|asset record count|number of assets|how many assets|bilangan aset|berapa banyak aset)\b|多少\s*(?:个|個|种|種)?\s*(?:asset|资产|資產)|(?:资产|資產)(?:记录|記錄)?(?:数量|數量)/iu.test(prompt))
   return {mode:'summary',query:''};
  return null;
 },
 format(evidence,prompt=''){
  const chinese=/\p{Script=Han}/u.test(prompt),malay=!chinese&&/\b(?:aset|berapa|baki|bilangan)\b/iu.test(prompt);
  if(evidence.history_source){
   const {asset,outlet,total_matching:total}=evidence;
   const period=evidence.requested_scope?.from?' ('+evidence.requested_scope.from+' – '+evidence.requested_scope.to+')':'';
   const headline=chinese?outlet.name+' 的 '+asset.name+' 有 '+total+' 条变动记录'+period+'。':
    malay?outlet.name+' mempunyai '+total+' rekod pergerakan '+asset.name+period+'.':
    outlet.name+' has '+total+' recorded '+asset.name+' movement'+(total===1?'':'s')+period+'.';
   return [headline,...evidence.rows.map(row=>'- '+row.movement_date+': '+row.quantity_change+' '+(asset.unit||'')+
    ' ('+row.quantity_before+' → '+row.quantity_after+')'),...pageNote(evidence,chinese,malay)].join('\n');
  }
  if(evidence.aggregate_complete){
   const total=evidence.total_matching;
   const headline=chinese?evidence.outlet.name+' 有 '+total+' 项资产记录。':
    malay?evidence.outlet.name+' mempunyai '+total+' rekod aset.':evidence.outlet.name+' has '+total+' current asset record'+(total===1?'':'s')+'.';
   if(!evidence.rows?.length)return headline;
   const balances=evidence.rows.map(row=>'- '+row.name+': '+(row.current_quantity==null?(chinese?'未记录':'Unavailable'):[row.current_quantity,row.unit].filter(v=>v!=null).join(' ')));
   return [headline,...balances,...pageNote(evidence,chinese,malay)].join('\n');
  }
  const [asset]=evidence.rows||[];
  if(evidence.match_status!=='matched'||!asset||asset.current_quantity==null)return null;
  const unit=!malay&&asset.unit==='unit'&&Number(asset.current_quantity)!==1?'units':asset.unit||'';
  if(malay)return 'Baki aset '+asset.name+' di '+evidence.outlet.name+' ialah '+asset.current_quantity+(unit?' '+unit:'')+'.';
  return chinese
   ?evidence.outlet.name+' 的 '+asset.name+' 当前记录数量是 '+asset.current_quantity+(unit?' '+unit:'')+'。来源：资产追踪。'
   :'The current Asset Tracking balance for '+asset.name+' at '+evidence.outlet.name+' is '+asset.current_quantity+(unit?' '+unit:'')+'.';
 },
 load:loadAssetCatalogue,project:d=>d,
 interface:{authority:'Asset Tracking service · outlet-scoped asset_items and asset_movement_logs',
  queryKinds:['count','summary','list','search','detail','filter','movement_history'],
  measures:['current_asset_count','current_quantity','quantity_change','quantity_before','quantity_after'],
  fields:[...fields,...movementFields],
  aggregates:'source_reported',pagination:'Count is exact for the outlet catalogue or the selected asset and date range. Catalogue and movement pages contain up to 20 rows.',
  unsupported:['Condition summaries, valuation, archived asset history and mixed-unit quantity totals are outside this operation. Ingredient and Factory balances have separate authorities.'],
  unavailable:'An unresolved outlet, ambiguous asset or absent match does not establish zero quantity.'},
});

function pageNote(evidence,chinese,malay){
 if(evidence.total_matching<=20)return [];
 return [chinese?'第 '+evidence.page+' 页，共 '+evidence.total_matching+' 条。':
  malay?'Halaman '+evidence.page+' daripada '+Math.ceil(evidence.total_matching/evidence.page_size)+'.':
  'Page '+evidence.page+' of '+Math.ceil(evidence.total_matching/evidence.page_size)+'.'];
}
