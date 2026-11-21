import {AssistantError} from '../assistantError.js';
import {page, permittedOutlet, readContract, rowsEvidence, uuid} from '../assistant/readContract.js';

const fields=['id','outlet_id','asset_code','name','unit','current_quantity','minimum_quantity','status','health_status','last_inspection_at','updated_at'];
const exactPattern=value=>value.replace(/[\\%_]/g,'\\$&');
// PostgREST treats asterisk as an ILIKE wildcard, even if PostgreSQL would not.
const exact=(query,field,value)=>value.includes('*')?query.eq(field,value):query.ilike(field,exactPattern(value));

async function read(query,signal){
 const {data,error,count}=await query.abortSignal(signal);
 if(error)throw new AssistantError(error.code==='42501'?'business_read_denied':'business_read_unavailable',error.code==='42501'?403:503);
 return {data,count};
}

async function matchingOutlet(caller,args,signal){
 if(args.outlet_id)await permittedOutlet(caller,args.outlet_id,signal);
 const outlets=()=>caller.from('outlets').select('id,name,code');
 let result;
 if(args.outlet_id)result=await read(outlets().eq('id',args.outlet_id).limit(2),signal);
 else {
  result=await read(exact(outlets(),'name',args.outlet_name).limit(2),signal);
  if(!result.data?.length)result=await read(exact(outlets(),'code',args.outlet_name).limit(2),signal);
 }
 if(result.data?.length!==1)throw new AssistantError('asset_outlet_unresolved',409);
 const outlet=result.data[0];
 if(!args.outlet_id)await permittedOutlet(caller,outlet.id,signal);
 return outlet;
}

async function loadAssetCatalogue(caller,args,signal){
 if(!args.outlet_id&&!args.outlet_name)throw new AssistantError('asset_outlet_required',400);
 const outlet=await matchingOutlet(caller,args,signal);
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
 const lookup=async(field,value)=>{
  const {data}=await read(exact(assets(fields.join(',')),field,value).limit(2),signal);
  if(!Array.isArray(data))throw new AssistantError('business_read_unavailable',503);
  return data;
 };
 const exactCode=await lookup('asset_code',args.query);
 const exactName=exactCode.length?[]:await lookup('name',args.query);
 // A user may prefix the display name with "asset-" even when no code is recorded.
 const unprefixed=args.query.match(/^asset-([\p{L}\p{N}][\p{L}\p{N} -]*)$/iu)?.[1].replaceAll('-',' ').trim();
 const candidates=exactCode.length?exactCode:exactName.length?exactName:unprefixed?await lookup('name',unprefixed):[];
 const match_status=candidates.length===1?'matched':candidates.length?'ambiguous':'not_found';
 return {outlet,match_status,matched_by:match_status==='matched'?(exactCode.length?'asset_code':'name'):null,...rowsEvidence(candidates.length===1?candidates:[],fields)};
}

export const assetCatalogueRead=readContract({
 id:'read_asset_catalogue',version:2,module_id:'asset_tracking',label:'Restaurant Asset Tracking catalogue',
 discoveryPhrases:['asset tracking','restaurant assets'],
 permission:'asset_tracking.view',source:'/operations/asset-tracking',scope:'Current human permission and one authorized outlet; non-archived Asset Tracking records',
 description:'Read Restaurant Asset Tracking quantities (assets such as spoons and equipment, separate from ingredient or Factory stock). For a named asset or asset code use detail and the exact user phrase as query. Resolve the outlet by its exact name/code using outlet_name, or a verified outlet_id. For count use summary; for catalogue pages use list. Never present an ambiguous or unmatched asset as zero.',
 properties:{page,outlet_id:{...uuid,nullable:true,description:'Use null when the user names the outlet.'},outlet_name:{type:'string',maxLength:120,nullable:true,description:'Exact outlet name or code as supplied by the user, or null when using a verified ID.'},mode:{type:'string',enum:['list','summary','detail'],description:'Use detail for the quantity of one named asset. Summary without a query counts asset records.'},query:{type:'string',maxLength:80,description:'Exact asset code or name; empty for unfiltered counts and catalogue pages.'}},
 normalizeArguments(a){
  if(!a||typeof a!=='object'||Array.isArray(a))return a;
  const normalized={page:1,outlet_id:null,outlet_name:null,mode:'list',query:'',...a};
  if(typeof normalized.query==='string'){
   normalized.query=normalized.query.trim();
   // An explicit asset identity is narrower than an unfiltered summary or list.
   if(normalized.query&&['list','summary'].includes(normalized.mode))normalized.mode='detail';
  }
  if(typeof normalized.outlet_name==='string')normalized.outlet_name=normalized.outlet_name.trim()||null;
  return normalized;
 },
 check:a=>{if((a.mode==='detail')!==!!a.query||a.mode!=='list'&&a.page!==1||a.outlet_id&&a.outlet_name)throw new AssistantError('tool_arguments_invalid',400);},
 load:loadAssetCatalogue,project:d=>d,
 interface:{authority:'Outlet-scoped Asset Tracking asset_items read model',queryKinds:['count','summary','list','search','detail','filter'],fields,
  aggregates:'source_reported',pagination:'List returns 20 rows per page. Only summary returns a complete count of current asset records, not the sum of quantities.',
  unsupported:['Movement history, condition summaries, valuation, mixed-unit quantity totals and inventory balances are outside this operation.'],
  unavailable:'An unresolved outlet, ambiguous asset or absent match does not establish zero quantity.'},
});
