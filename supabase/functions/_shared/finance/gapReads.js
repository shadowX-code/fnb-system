import {collectionRead} from '../assistant/collectionRead.js';
import {AssistantError} from '../assistantError.js';

async function readSourceStatus(caller,_args,signal){
 const query=async name=>{
  const {data,error}=await caller.rpc(name,{}).abortSignal(signal);
  if(error){
   const denied=['42501','PT403'].includes(error.code);
   throw new AssistantError(denied?'business_read_denied':'business_read_unavailable',denied?403:503);
  }
  return data;
 };
 const rows=await query('finance_accounting_source_status');
 if(!Array.isArray(rows))throw new AssistantError('business_read_unavailable',503);
 if(rows.some(row=>!row?.id)||new Set(rows.map(row=>row.id)).size!==rows.length)throw new AssistantError('business_read_unavailable',503);
 if(rows.length===0){
  // The canonical status call returns [] for a non-owner. The Admin source
  // options call distinguishes that case (null) from an owner's empty list.
  const options=await query('finance_accounting_connector_options');
  if(options===null)throw new AssistantError('business_read_denied',403);
  if(!Array.isArray(options))throw new AssistantError('business_read_unavailable',503);
 }
 return rows;
}

export const financeGapReads=[
 collectionRead({
  id:'read_accounting_source_health',module_id:'finance_data_sources',label:'Accounting source synchronization health',
  permission:'reports.view',source:'/finance/data-sources',rpc:'finance_accounting_source_status',load:readSourceStatus,
  scope:'Current Finance source owner and reports permission. Includes current and historical AutoCount connections visible in Data Sources.',
  description:'Find recorded synchronization state and freshness by book, legal entity, activity or sync state. The count measures connections, including inactive records. No source records does not establish healthy synchronization.',
  properties:{active:{type:'boolean',nullable:true,description:'True for active connections or false for inactive connections. Null includes both.'}},
  normalizeArguments:args=>({active:null,...args}),
  records:(rows,args)=>args.active===null?rows:rows.filter(row=>row.active===args.active),
  fields:['id','active','sourceBook','companyName','legalEntityId','legalEntityLabel','entityActive','verifiedAt','lastSyncAt','lastAttemptAt','lastSyncReportAt','syncState','pendingRetries','sourceRows','nextPollAt'],
  filters:{book:['sourceBook'],legal_entity:['legalEntityLabel'],sync_state:['syncState']},
  sortBy:[{key:'legalEntityLabel'},{key:'sourceBook'},{key:'id'}],
  metric:{unit:'accounting connections',definition:'Distinct owner-visible AutoCount connection bindings, including history, matching all selected filters. A book can have successive bindings.',time:'Status at read time and the recorded synchronization timestamps.'},
 }),
];
