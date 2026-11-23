import {readContract,invalidArgument,pick} from '../assistant/readContract.js';
import {recordPageRead} from '../assistant/recordPageRead.js';
import {AssistantError} from '../assistantError.js';

// Reuse the canonical paged table/RPC reader and preserve each existing summary RPC.
// An all-time dashboard metric and a filtered header count have different populations.
function registerSummaryRead({summaryRpc='factory_listing_summary',listing,summaryFields,stockType,...owner}){
 const base=recordPageRead(owner);
 const summaryArgs=()=>listing?{p_listing:listing,p_filters:{}}:{};
 return readContract({...owner,version:2,rpc:summaryRpc,arguments:summaryArgs,pageableModes:['list'],
  properties:{...base.properties,mode:{type:'string',enum:['summary','count','list']}},
  normalizeArguments:a=>base.normalizeArguments(a&&typeof a==='object'&&!Array.isArray(a)?{mode:'summary',...a}:a),
  description:owner.description+' Use summary for the existing unfiltered dashboard metrics, count for the exact matching header count, or list for stable pages of 20. Filter count/list by exact status, reference or the declared date range.',
  check(a){
   if(a.mode==='summary'){
    if(a.page!==1)invalidArgument('unsupported_value','page');
    const filter=Object.keys(base.properties).find(k=>k!=='mode'&&k!=='page'&&a[k]!==null);
    if(filter)invalidArgument('unsupported_value',filter);
   }else base.check({...a,mode:a.mode==='count'?'summary':'list'});
  },
  async load(caller,a,signal){
   if(stockType){
    const guard=await caller.rpc('factory_assert_stock_check_view',{p_stock_type:stockType}).abortSignal(signal);
    if(guard.error||guard.data!==true)throw new AssistantError('business_read_denied',403);
   }
   if(a.mode!=='summary')return base.load(caller,{...a,mode:a.mode==='count'?'summary':'list'},signal);
   const {data,error}=await caller.rpc(summaryRpc,summaryArgs()).abortSignal(signal);
   if(error||!data||Array.isArray(data)||typeof data!=='object')throw new AssistantError(error?.code==='42501'?'business_read_denied':'business_read_unavailable',error?.code==='42501'?403:503);
   return data;
  },
  project:(data,a)=>!a||a.mode==='summary'?{summary:pick(data,summaryFields)}:{...data,header_authority:owner.rpc||owner.table,date_basis:owner.dateField},
  interface:{authority:summaryRpc+' and '+(owner.rpc||owner.table),fields:[...owner.fields,'summary','total_matching'],
   queryKinds:['summary','count','list','filter'],aggregates:'source_reported',pagination:'Dashboard metrics are unfiltered. Matching header counts precede 20-row pages; document lines, units and item quantities are not header counts.',
   semantics:{entities:[owner.label],time:'Dashboard metrics keep their existing periods. Header date filtering uses '+owner.dateField+'.',relationships:[owner.scope],
    metrics:{entry_count:{field:'total_matching',unit:'headers',definition:'Number of matched source headers in count/list mode before paging.'}}}},
 });
}
const stockFields=['id','check_no','check_date','status','submitted_at','approved_at','updated_at'];
export const rawChecksRead=registerSummaryRead({id:'read_factory_raw_checks',module_id:'factory_raw_stock_check',label:'Raw material stock checks',permission:'factory_raw_stock_check.view',
 source:'/factory/raw-materials/stock-check',scope:'Factory shared raw-material checks under human authority, the stock-check assertion and source RLS.',
 listing:'raw-stock-checks',summaryFields:['checks','submitted','critical_rows'],stockType:'raw',table:'factory_raw_material_stock_checks',
 fields:stockFields,dateField:'check_date',filters:{reference:'check_no',status:'status'},order:[{key:'check_date',descending:true},{key:'created_at',descending:true},{key:'id',descending:true}],
 description:'Read raw material stock-check status and check dates. A submitted check is not a posted stock movement. Private notes, staff identities and counted line quantities are excluded.'});
export const productChecksRead=registerSummaryRead({id:'read_factory_product_checks',module_id:'factory_product_stock_check',label:'Finished product stock checks',permission:'factory_product_stock_check.view',
 source:'/factory/warehouse/stock-check',scope:'Factory shared finished product checks under human authority, the stock-check assertion and source RLS.',
 summaryRpc:'factory_product_stock_check_summary',summaryFields:['checks','submitted','variance_rows','skipped_rows'],stockType:'product',table:'factory_product_stock_checks',
 fields:stockFields,dateField:'check_date',filters:{reference:'check_no',status:'status'},order:[{key:'check_date',descending:true},{key:'created_at',descending:true},{key:'id',descending:true}],
 description:'Read product stock-check status and check dates. The dashboard retains its own skipped and variance line counts. No posting, notes or staff identities.'});
export const dispatchRegisterRead=registerSummaryRead({id:'read_factory_dispatch_summary',module_id:'factory_finished_goods_dispatch',label:'Finished goods dispatches',permission:'factory_finished_goods_dispatch.view',
 source:'/factory/warehouse/dispatch',scope:'Factory finished-goods dispatch headers under existing human and source row access.',
 listing:'dispatch-history',summaryFields:['draft','completed_today','customers_today'],table:'factory_finished_good_dispatches',dateField:'dispatch_date',
 fields:['id','dispatch_no','dispatch_date','reference_no','customer_name','status','completed_at','cancelled_at','reversed_at'],
 filters:{reference:'dispatch_no',customer:'customer_name',status:'status'},order:[{key:'dispatch_date',descending:true},{key:'created_at',descending:true},{key:'id',descending:true}],
 description:'Read dispatch references, recorded customer, business date and workflow state. A dispatch header is not a delivered SKU quantity or receivable; private remarks and staff are excluded.'});
export const jobRegisterRead=registerSummaryRead({id:'read_factory_job_summary',module_id:'factory_job_order_records',label:'Factory job orders',permission:'factory_job_orders.view',
 source:'/factory/job-orders',scope:'Factory Job Order Records and its existing human permission. The register does not release due jobs or change workflow state.',
 listing:'job-orders',summaryFields:['jobs','draft','released','in_progress','completed','cancelled','completed_today'],rpc:'factory_list_job_order_records',rpcArguments:()=>({}),
 fields:['id','job_order_no','product_name','product_code','status','planned_date','due_date','manufacturing_date','batch_no','priority'],dateField:'planned_date',
 filters:{reference:'job_order_no',product:'product_name',sku:'product_code',status:'status'},order:[{key:'planned_date',descending:true,nullsFirst:false},{key:'created_at',descending:true},{key:'id',descending:true}],
 description:'Read the job number, product, planned and manufacturing dates and status. The date range filters the planned date. No operators, assignments, remarks or release commands.'});
