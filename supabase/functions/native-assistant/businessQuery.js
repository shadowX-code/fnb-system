// Common outcomes and scope selection over the existing domain dispatcher.
const forbidden=new Set(['business_read_denied','factory_read_denied','action_not_authorized','capability_disconnected','realtime_not_authorized']);
const clarification=new Set(['entity_ambiguous','entity_scope_required','asset_outlet_required','knowledge_scope_required','inventory_detail_ambiguous']);
const unmatched=new Set(['entity_unresolved','asset_outlet_unresolved','knowledge_scope_unresolved']);
const unsupported=new Set(['tool_not_allowed','tool_arguments_invalid']);
export function failureOutcome(code){
 if(forbidden.has(code))return 'UNAUTHORIZED';
 if(clarification.has(code))return 'AMBIGUOUS';
 if(unmatched.has(code))return 'NO_MATCH';
 if(unsupported.has(code))return 'UNSUPPORTED';
 return 'EXECUTION_ERROR';
}

export function outcomeFor(evidence){
 if(evidence.error)return failureOutcome(evidence.error);
 if(evidence.discovery_only)return evidence.total_operations?'SUCCESS':'UNSUPPORTED';
 if(evidence.match_status==='ambiguous'||evidence.knowledge?.status==='ambiguous_source'||evidence.ranking?.status==='unit_required')return 'AMBIGUOUS';
 if(evidence.knowledge?.status==='source_ai_not_allowed')return 'UNAUTHORIZED';
 if(evidence.knowledge?.status==='future_version_unverified')return 'UNSUPPORTED';
 if(evidence.match_status==='not_found'||evidence.detail_found===false||
  ['no_matching_excerpt','no_current_version'].includes(evidence.knowledge?.status))return 'NO_MATCH';
 return 'SUCCESS';
}

export const outletContinuation=prompt=>/\b(?:same outlet|that outlet|this outlet|same branch)\b|(?:同一|那个|这家|那家)(?:餐厅|门店|餐館|网点)/iu.test(prompt||'')&&
 !/\b(?:also|separately|compare|versus|and\s+(?:what|how|show|give|list))\b|另外|以及|同时|同時|對比|对比/iu.test(prompt||'');

export function confirmedOutlet(history,operation,domain){
 for(const turn of [...(history?.turns||[])].reverse()){
  if(turn.state!=='completed'||turn.tool_state!=='completed')continue;
  const evidence=turn.evidence?.items||[turn.evidence];
  const matching=evidence.filter(entry=>entry?.capability===operation&&outcomeFor(entry)==='SUCCESS'||
   domain&&entry?.query_domain===domain&&outcomeFor(entry)==='SUCCESS');
  const ids=new Set(matching.map(entry=>entry.outlet?.id||entry.knowledge?.scope?.outlet_id||entry.requested_scope?.outlet_id).filter(Boolean));
  if(ids.size===1)return [...ids][0];
  if(ids.size>1)return null;
 }
 return null;
}

export function businessFailureReply(status,prompt=''){
 const chinese=/\p{Script=Han}/u.test(prompt);
 return ({
  UNAUTHORIZED:chinese?'当前权限或 Assistant 访问设置不允许读取此来源。':'Your current permissions or Assistant access policy do not allow this read.',
  AMBIGUOUS:chinese?'请确认要查询的网点或记录的完整名称或代码。':'Please confirm the exact outlet or record name or code.',
  NO_MATCH:chinese?'在当前授权范围内没有匹配的记录或名称，无法确认数量。':'No matching record or name was resolved in the authorized scope. The quantity is unconfirmed.',
  UNSUPPORTED:chinese?'目前无法确认此请求对应的受支持业务查询，请指定 FeedX 模块和查询范围。':'I could not establish a supported query for this request. Please specify the FeedX module and scope.',
  EXECUTION_ERROR:chinese?'业务来源没有完成这次读取，无法确认结果。请稍后再试。':'The business source did not complete the read. The result is unconfirmed. Please try again.',
 })[status]||null;
}
