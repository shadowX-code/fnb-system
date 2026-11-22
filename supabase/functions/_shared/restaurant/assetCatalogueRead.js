import {AssistantError} from '../assistantError.js';
import {page, readContract, rowsEvidence, uuid} from '../assistant/readContract.js';
import {exactName,normalizedEntity,resolveOutlet} from '../assistant/entityResolution.js';
import {preferNamedScope} from '../assistant/knowledge.js';

const fields=['id','outlet_id','asset_code','name','unit','current_quantity','minimum_quantity','status','health_status','last_inspection_at','updated_at'];
const balances=/\b(?:each asset|per asset|every asset|asset balances|balances for each|their balances|baki setiap aset)\b|每(?:个|個|项|項)\s*(?:asset|资产|資產)/iu;

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
 if(args.mode==='summary'){
  const {count}=await read(assets('id',{count:'exact',head:true}),signal);
  if(!Number.isSafeInteger(count)||count<0)throw new AssistantError('business_read_unavailable',503);
  return {outlet,total_matching:count,aggregate_complete:true,rows:[]};
 }
 if(args.mode==='list'){
  const {data}=await read(assets(fields.join(',')).order('id').range((args.page-1)*20,args.page*20),signal);
  return {outlet,...rowsEvidence(data,fields)};
 }
 if(args.mode==='summary_with_balances'){
  const {data,count}=await read(assets(fields.join(','),{count:'exact'}).order('id').range(0,19),signal);
  if(!Number.isSafeInteger(count)||count<0)throw new AssistantError('business_read_unavailable',503);
  return {outlet,...rowsEvidence(data,fields),total_matching:count,aggregate_complete:true,truncated:count>data.length};
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
 const match_status=candidates.length===1?'matched':candidates.length?'ambiguous':'not_found';
 return {outlet,match_status,matched_by:match_status==='matched'?(exactCode.length?'asset_code':'name'):null,...rowsEvidence(candidates.length===1?candidates:[],fields)};
}

export const assetCatalogueRead=readContract({
 id:'read_asset_catalogue',version:2,module_id:'asset_tracking',label:'Restaurant Asset Tracking catalogue',
 discoveryPhrases:['asset tracking','restaurant assets','asset balance','asset catalogue','资产追踪','资产数量','餐具数量'],
 // Domain intent only. Entities still resolve from the user's words and the authorized catalogue.
 queryIntent(prompt){
  const asset=/\b(?:asset(?:s|-[\p{L}\p{N}]+)?|aset)\b|资产|資產/iu.test(prompt);
  const utensil=/\b(?:spoons?|forks?|cutlery|utensils?)\b|汤[匙勺]|湯[匙勺]|勺子|叉子|筷子|餐具/iu.test(prompt);
  const quantity=/\b(?:balance|quantity|how many|how much|in stock|available|left|count|berapa|baki|bilangan)\b|多少|几[件个把只]|幾[件個把隻]|数量|數量|剩[下余餘]/iu.test(prompt);
  const mixed=/\b(?:also|separately|then|compare|versus)\b|另外|同时|同時|以及|并且|並且|对比|對比/iu.test(prompt)||
   /\band\b/iu.test(prompt)&&!balances.test(prompt);
  return quantity&&(asset||utensil)&&!mixed?'asset_quantity':null;
 },
 permission:'asset_tracking.view',source:'/operations/asset-tracking',scope:'Current human permission and one authorized outlet; non-archived Asset Tracking records',
 description:'Read Restaurant Asset Tracking quantities (assets such as cutlery and equipment, separate from ingredient or Factory stock). For one item use detail and its exact canonical name or code. Translate a plain non-English item description when needed; use the original wording if the translation is uncertain. Use the named outlet or a verified outlet_id. Summary counts asset records; list shows catalogue pages. Never present an ambiguous or unmatched asset as zero.',
 properties:{page,outlet_id:{...uuid,nullable:true,description:'Use null when the user names the outlet.'},outlet_name:{type:'string',maxLength:120,nullable:true,description:'Human outlet name or code, or null for a confirmed outlet.'},mode:{type:'string',enum:['list','summary','detail','summary_with_balances'],description:'Detail gets one named asset balance. Summary counts records. Use summary_with_balances for a total and the first page of current quantities.'},query:{type:'string',maxLength:80,description:'Exact asset code or name; empty for unfiltered counts and catalogue pages.'}},
 normalizeArguments(a){
  if(!a||typeof a!=='object'||Array.isArray(a))return a;
  const normalized={page:1,outlet_id:null,outlet_name:null,mode:'list',query:'',...a};
  if(typeof normalized.query==='string'){
   normalized.query=normalized.query.trim();
   // An explicit asset identity is narrower than an unfiltered summary or list.
   if(normalized.query&&['list','summary'].includes(normalized.mode))normalized.mode='detail';
  }
  if(typeof normalized.outlet_name==='string')normalized.outlet_name=normalized.outlet_name.trim()||null;
  return preferNamedScope(normalized,'outlet_id','outlet_name');
 },
 check:a=>{if((a.mode==='detail')!==!!a.query||a.mode!=='list'&&a.page!==1)throw new AssistantError('tool_arguments_invalid',400);},
 prepareArguments(prompt){
  if(balances.test(prompt))
   return {mode:'summary_with_balances',query:''};
  if(/\b(?:current asset records?|asset record count|number of assets|how many assets|bilangan aset|berapa banyak aset)\b|多少\s*(?:个|個|种|種)?\s*(?:asset|资产|資產)|(?:资产|資產)(?:记录|記錄)?(?:数量|數量)/iu.test(prompt))
   return {mode:'summary',query:''};
  return null;
 },
 format(evidence,prompt=''){
  const chinese=/\p{Script=Han}/u.test(prompt),malay=!chinese&&/\b(?:aset|berapa|baki|bilangan)\b/iu.test(prompt);
  if(evidence.aggregate_complete){
   const total=evidence.total_matching;
   const headline=chinese?evidence.outlet.name+' 有 '+total+' 项资产记录。':
    malay?evidence.outlet.name+' mempunyai '+total+' rekod aset.':evidence.outlet.name+' has '+total+' current asset record'+(total===1?'':'s')+'.';
   if(!evidence.rows?.length)return headline;
   const balances=evidence.rows.map(row=>'- '+row.name+': '+(row.current_quantity==null?(chinese?'未记录':'Unavailable'):[row.current_quantity,row.unit].filter(v=>v!=null).join(' ')));
   return [headline,...balances,...evidence.truncated?[chinese?'以上是前 20 项。':'Showing the first 20 records.']:[]].join('\n');
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
 interface:{authority:'Outlet-scoped Asset Tracking asset_items read model',queryKinds:['count','summary','list','search','detail','filter'],fields,
  aggregates:'source_reported',pagination:'List returns 20 rows per page. Summary modes return an exact record count, not the sum of quantities.',
  unsupported:['Movement history, condition summaries, valuation, mixed-unit quantity totals and inventory balances are outside this operation.'],
  unavailable:'An unresolved outlet, ambiguous asset or absent match does not establish zero quantity.'},
});
