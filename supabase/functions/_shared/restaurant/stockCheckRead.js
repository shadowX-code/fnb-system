import {AssistantError} from '../assistantError.js';
import {countedRows,invalidArgument,month,page,pick,readContract,uuid} from '../assistant/readContract.js';
import {sourceRows} from '../assistant/entityResolution.js';
import {verifyClosingCoverage} from './closingValuation.js';

const fields=['id','outlet_id','group_id','stock_check_type','audit_type','status','submitted_at','reviewed_at','check_date','check_name','shift','updated_at','accounting_month'];
export const stockCheckRead=readContract({
 id:'read_inventory_checks',module_id:'inventory_stock_check',version:2,label:'Restaurant stock checks and closing publication',
 permission:'inventory_stock_check.view',outletScope:true,source:'/restaurant/inventory/stock-check',
 scope:'Stock Check metadata at one authorized outlet. Closing mode checks one recorded accounting month.',
 description:'Count or list stock checks at one outlet. In closing mode, use the accounting month to find the current published closing revision from the submitted month-end audit. Return publication state, version, count date and item coverage. Financial amounts belong to Reporting. A missing submitted audit does not establish a zero close.',
 discoveryPhrases:['month-end closing audit','closing stock publication','月末盘点','月末盤點','status stok penutup'],
 properties:{page,outlet_id:uuid,mode:{type:'string',enum:['list','summary','closing']},month:{...month,nullable:true}},
 normalizeArguments:a=>a&&typeof a==='object'&&!Array.isArray(a)?{mode:'list',page:1,month:null,...a}:a,
 check(a){
  if(a.mode!=='list'&&a.page!==1)invalidArgument('unsupported_value','page');
  if(a.mode==='closing'&&!a.month)invalidArgument('missing_field','month');
 },
 pageableModes:['list'],
 async load(caller,args,signal){
  const closing=args.mode==='closing';
  let query=caller.from('inventory_stock_checks').select(closing?'id':fields.join(','),
   closing?{}:{count:'exact',head:args.mode==='summary'}).eq('outlet_id',args.outlet_id);
  if(args.month)query=query.eq('accounting_month',args.month);
  if(!closing)return countedRows(query.order('id'),args,fields,signal);
  const candidates=await sourceRows(query.eq('stock_check_type','audit').eq('audit_type','Month-End Closing').eq('status','submitted')
   .order('submitted_at',{ascending:false,nullsFirst:false}).order('id').limit(1),signal);
  if(!candidates.length)return {publication_state:'no_submitted_audit',publication:null};
  // The canonical Stock Check RPC rechecks this user's permission and the supplied audit's outlet.
  // Its published row is the current revision for this outlet/month even after an audit correction.
  const {data,error}=await caller.rpc('inventory_closing_context',{p_check_id:candidates[0].id}).abortSignal(signal);
  if(error||!data||!Object.hasOwn(data,'published'))throw new AssistantError(error?.code==='42501'?'business_read_denied':'business_read_unavailable',error?.code==='42501'?403:503);
  const record=data.published;
  if(record===null)return {publication_state:'submitted_unpublished',publication:null};
  verifyClosingCoverage(record);
  if(!record.id||!record.source_audit_id||!Number.isSafeInteger(record.revision)||record.revision<1)
   throw new AssistantError('business_read_unavailable',503);
  return {publication_state:'published',publication:pick(record,['id','source_audit_id','revision','approved_at','actual_count_date',
   'valuation_status','valued_item_count','total_item_count'])};
 },
 project:result=>result,
 interface:{authority:'Restaurant Stock Check register and inventory_closing_context',fields:[...fields,'publication_state','publication'],
  queryKinds:['summary','count','list','filter','detail'],aggregates:'complete_filtered_scope',
  pagination:'Twenty stock checks per page. Closing mode retrieves only the current publication for the requested accounting month.',
  semantics:{entities:['outlet','stock check','month-end closing audit','published revision'],
   time:'The publication belongs to its accounting month. Its physical count date can be unknown.',
   relationships:['Each outlet/month can have a current authorized revision of submitted closing evidence.'],
   metrics:{entry_count:{field:'total_matching',unit:'stock checks',definition:'All stock checks matching the outlet and optional accounting month in summary/list.'},
    valued_items:{field:'publication.valued_item_count',unit:'items',definition:'Submitted items with a valid pinned cost in the current publication, when recorded.'}}},
  unsupported:['No new closing, monetary valuation, approval or individual pinned cost through this operational read.']},
});
