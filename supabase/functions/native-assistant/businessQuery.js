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

export const outletContinuation=prompt=>/\b(?:same outlet|that outlet|this outlet|same branch|that café|this café|that cafe|this cafe)\b|(?:同一|同一家|该|該|这一个|這一個|这个|這個|那个|那個|这家|這家|那家)\s*(?:餐厅|餐廳|门店|門店|餐館|网点|咖啡店|店)/iu.test(prompt||'')&&
 !/\b(?:also|separately|compare|versus|and\s+(?:what|how|show|give|list))\b|另外|以及|同时|同時|對比|对比/iu.test(prompt||'');

export const affirmedOutlet=prompt=>/^(?:yes\b|correct\b|that's right\b|betul\b|ya\b|对[，,。]?|對[，,。]?|是的|没错|沒錯)/iu.test(String(prompt||'').trim())&&
 /\b(?:its|there|that outlet|this outlet|at that branch)\b|(?:他|它|那家|这家|這家)(?:在|的)|(?:该|該)(?:店|餐[厅廳]|门店|門店)/iu.test(prompt);

export function previousNamedTurn(history){
 const latest=(history?.turns||[]).filter(turn=>turn.state==='completed').at(-1);
 if(!latest||latest.tool_state==='failed'||outcomeFor(latest.evidence||{})!=='SUCCESS')return null;
 return typeof latest.prompt==='string'?latest.prompt:null;
}

export const correctedOutletWording=prompt=>String(prompt||'').split(/(?:\b(?:i meant|actually use|rather than that,? use|maksud saya|bukan itu,? tetapi)\b|我(?:的意思|说的是|說的是)|更正[：:]?|不是[^，,]{1,80}[，,]\s*(?:而)?是)/iu).at(-1).trim();

// Follow-up scope comes from the most recent completed, unambiguous business read.
export function previousBusinessResult(history){
 const turn=(history?.turns||[]).filter(turn=>turn.state==='completed').at(-1);
 if(turn?.tool_state!=='completed')return null;
 const items=turn.evidence?.items||[turn.evidence];
 const [evidence]=items;
 return items.length===1&&evidence?.capability&&evidence.requested_scope&&outcomeFor(evidence)==='SUCCESS'?evidence:null;
}

export const pageRequest=prompt=>String(prompt||'').trim().match(/^(?:(?:show |list )?(?:the )?next page|page ([1-9][0-9]?)|(?:halaman seterusnya|下一[页頁])|第\s*([1-9][0-9]?)\s*[页頁])[?!.。！]?$/iu);

export function continuedPage(prompt,evidence,operation){
 const match=pageRequest(prompt);
 if(!match||!operation?.pageableModes?.includes(evidence?.requested_scope?.mode)||!evidence.aggregate_complete)return null;
 const current=evidence.page;
 if(!Number.isSafeInteger(current)||!Number.isSafeInteger(evidence.total_matching)||evidence.page_size!==20)return null;
 const page=Number(match[1]||match[2]||current+1);
 if(page>100||page===current||page>Math.ceil(evidence.total_matching/evidence.page_size))return null;
 return {operation:operation.id,args:{...evidence.requested_scope,page}};
}

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
 const malay=!chinese&&/\b(?:berapa|cawangan|inventori|baki|maksud saya)\b/iu.test(prompt);
 return ({
  UNAUTHORIZED:chinese?'当前无法查看这项数据。请检查您的访问权限。':malay?'Akses semasa tidak membenarkan semakan ini.':'Your current access does not allow this read.',
  AMBIGUOUS:chinese?'请确认您指的是哪家门店或哪个品项。':malay?'Cawangan atau item yang mana satu?':'Please confirm which outlet or item you mean.',
  NO_MATCH:chinese?'在您可查看的范围内没有匹配记录。':malay?'Tiada rekod yang sepadan dalam skop akses anda.':'No matching record was found in your accessible scope.',
  UNSUPPORTED:chinese?'目前无法提供这项数据。':malay?'Maklumat ini belum tersedia.':'I can’t answer that from the currently available data.',
  EXECUTION_ERROR:chinese?'暂时无法读取这项数据，请重试。':malay?'Data tidak dapat dibaca buat sementara waktu. Sila cuba lagi.':'The data could not be read. Please try again.',
 })[status]||null;
}
