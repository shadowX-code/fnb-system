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
 if(evidence.discovery_only&&evidence.requested_query_unavailable)return 'UNAUTHORIZED';
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

// An evidence-backed analysis may require more than the formatted result of one
// resolved read. Keep synthesis and read-only discovery available for these turns.
export const asksForAnalysis=prompt=>/\b(?:why|explain the (?:change|increase|decrease)|analy[sz]e|recommend(?:ations?)?|suggest(?:ions?)?|underperform(?:ed|ing)?|root cause|what (?:should|could|can) we|next (?:check|step)|mengapa|kenapa|cadang(?:an|kan)?|langkah seterusnya|punca)\b|为什么|為什麼|原因|分析|建议|建議|下一步|怎[么麼]改善/iu.test(prompt||'');

export const affirmedOutlet=prompt=>/^(?:yes\b|correct\b|that's right\b|betul\b|ya\b|对[，,。]?|對[，,。]?|是的|没错|沒錯)/iu.test(String(prompt||'').trim())&&
 /\b(?:its|there|that outlet|this outlet|at that branch)\b|(?:他|它|那家|这家|這家)(?:在|的)|(?:该|該)(?:店|餐[厅廳]|门店|門店)/iu.test(prompt);

export function previousNamedTurn(history){
 const latest=(history?.turns||[]).filter(turn=>turn.state==='completed').at(-1);
 if(!latest||latest.tool_state==='failed'||outcomeFor(latest.evidence||{})!=='SUCCESS')return null;
 return typeof latest.prompt==='string'?latest.prompt:null;
}

export const correctedOutletWording=prompt=>String(prompt||'').split(/(?:\b(?:i meant|actually use|rather than that,? use|maksud saya|bukan itu,? tetapi)\b|我(?:的意思|说的是|說的是|是说|是說)|更正[：:]?|不是[^，,]{1,80}[，,]\s*(?:而)?是)/iu).at(-1).trim();

// Follow-up scope comes from the most recent completed, unambiguous business read.
export function previousBusinessResult(history){
 const turn=(history?.turns||[]).filter(turn=>turn.state==='completed').at(-1);
 if(turn?.tool_state!=='completed')return null;
 const items=turn.evidence?.items||[turn.evidence];
 const [evidence]=items;
 return items.length===1&&evidence?.capability&&evidence.requested_scope&&outcomeFor(evidence)==='SUCCESS'?evidence:null;
}

export const pageRequest=prompt=>String(prompt||'').trim().match(/^(?:(?:show |list )?(?:the )?(?:next page|page [1-9][0-9]{0,3})|halaman (?:seterusnya|[1-9][0-9]{0,3})|下一[页頁]|第\s*[1-9][0-9]{0,3}\s*[页頁])[?!.。！]?$/iu);

// Only complete, confirmed list coordinates may seed the next query. A
// compound result containing two lists needs the user's choice even when one
// of them has just reached its last page.
export function continuedPage(prompt,history,lookup){
 const latest=history?.turns?.filter(turn=>['completed','failed','cancelled'].includes(turn.state)).at(-1);
 const saved=latest?.state==='completed'&&latest.tool_state==='completed'?latest.evidence:null;
 const lists=(saved?.items||[saved]).flatMap(e=>{
  const op=e?.capability&&lookup(e.capability);
  if(!op?.tool.parameters.properties.page||e.source!==op.moduleInterface.source||e.version!==op.moduleInterface.evidence_version||
   !e.requested_scope||!e.aggregate_complete||e.no_evidence||e.not_business_evidence||outcomeFor(e)!=='SUCCESS'||
   !(op.pageableModes?.includes(e.requested_scope.mode)||e.pageable===true))return [];
  const total=e.total_matching??e.total_count;
  const defaultSize=op.fixedPageSize?.(e.requested_scope)??20;
  const sizes=op.tool.parameters.properties.page_size?.enum??[defaultSize];
  const requested=e.requested_scope.page_size??defaultSize,size=e.page_size;
  if(!sizes.includes(size)||!sizes.includes(requested)||size>requested||!Number.isSafeInteger(e.requested_scope.page)||e.requested_scope.page<1||
   !Number.isSafeInteger(e.page)||e.page<1||(e.page-1)*size!==(e.requested_scope.page-1)*requested||
   !Number.isSafeInteger(total)||total<0||!Array.isArray(e.rows)||e.rows.length!==Math.min(size,Math.max(0,total-(e.page-1)*size)))return [];
  return [{op,e,total}];
 });
 const zh=/\p{Script=Han}/u.test(prompt),ms=/\bhalaman\b/iu.test(prompt);
 if(lists.length!==1)return {pagination_reply:zh?'您想继续哪一份列表？':ms?'Senarai mana yang anda mahu sambungkan?':'Which list would you like to continue?',query_outcome:'AMBIGUOUS'};
 const {op,e,total}=lists[0],page=Number(prompt.match(/[0-9]+/u)?.[0]||e.page+1);
 if(page>op.tool.parameters.properties.page.maximum||page>Math.ceil(total/e.page_size))return {
  pagination_reply:zh?'上次的列表没有这一页。您可以重新查询最新列表。':ms?'Senarai sebelumnya tiada halaman itu. Anda boleh meminta senarai terkini.':'The last result has no such page. You can ask for a fresh list.',
  query_outcome:'UNSUPPORTED',
 };
 const args={...e.requested_scope,page,...op.tool.parameters.properties.page_size?{page_size:e.page_size}:{}};
 try{if(op.tool.parameters.properties.page_size)op.validate(args);}catch{return {pagination_reply:zh?'已达到可分页的范围，请缩小筛选范围。':ms?'Had halaman telah dicapai. Kecilkan skop carian.':'The page limit has been reached. Narrow the filters to continue.',query_outcome:'UNSUPPORTED'};}
 return {operation:op.id,args};
}

export function confirmedOutlet(history,operation,domain){
 for(const turn of [...(history?.turns||[])].reverse()){
  // A failed correction is a scope boundary. Never silently recover an older
  // outlet when the user next refers to “there” or “the same outlet”.
  if(turn.tool_state==='failed'||turn.state==='failed'||turn.state==='cancelled'){
   const wording=turn.prompt?.trim();
   if(wording&&(correctedOutletWording(wording)!==wording||!outletContinuation(wording)&&
    /\b(?:at|outlet|branch|cawangan|di)\s+|在|门店|門店/iu.test(wording)))return null;
   continue;
  }
  if(turn.state!=='completed'||turn.tool_state!=='completed')continue;
  const evidence=turn.evidence?.items||[turn.evidence];
  const matching=evidence.filter(entry=>entry&&(entry.capability===operation||domain&&entry.query_domain===domain));
  if(matching.some(entry=>outcomeFor(entry)!=='SUCCESS'||entry.requested_scope?.outlet_scope==='each_outlet'))return null;
  const ids=new Set(matching.map(entry=>entry.outlet?.id||entry.knowledge?.scope?.outlet_id||entry.requested_scope?.outlet_id).filter(Boolean));
  if(ids.size===1)return [...ids][0];
  if(matching.length||evidence.some(entry=>entry?.outlet?.id||entry?.requested_scope?.outlet_id))return null;
 }
 return null;
}

export function sourceLimitation(evidence,prompt=''){
 const zh=/\p{Script=Han}/u.test(prompt);
 const ms=!zh&&/\b(?:berapa|semak|jumlah|kaedah|tertinggi|inventori|baki|cawangan)\b/iu.test(prompt);
 if(evidence?.ranking?.status==='unit_required'){
  const choices=evidence.ranking.available_units;
  const units=Array.isArray(choices)?choices.filter(unit=>typeof unit==='string').slice(0,8).join(', '):'';
  return zh?'这些库存使用不同单位。您要按哪个单位排名'+(units?'（'+units+'）':'')+'？':
   ms?'Stok menggunakan beberapa unit. Unit yang mana untuk kedudukan'+(units?' ('+units+')':'')+'?':
   'These stocks use different units. Which unit should I rank'+(units?' ('+units+')':'')+'?';
 }
 switch(evidence?.knowledge?.status){
  case 'no_current_version':return zh?'此范围内没有可核实的当前已发布版本。':ms?'Tiada versi terkini yang diterbitkan dapat disahkan dalam skop ini.':'There is no verified current published version in this scope.';
  case 'no_matching_excerpt':return zh?'在可查看的文档中没有找到回答这个问题的段落。':ms?'Tiada petikan yang menjawab soalan ini dalam dokumen yang boleh diakses.':'I found no passage answering that question in the accessible documents.';
  case 'source_ai_not_allowed':return zh?'此来源目前未授权供助手使用。':ms?'Sumber ini belum membenarkan penggunaan oleh pembantu.':'This source currently does not allow Assistant use.';
  default:return null;
 }
}

export function businessReplyLanguage(prompt){
 if(/\p{Script=Han}/u.test(prompt||''))return 'zh';
 return /\b(?:berapa(?:kah)?|cawangan|inventori|baki|maksud saya|jumlah|semak|setiap|bulan|mengikut|belian|pembelian)\b/iu.test(prompt||'')?'ms':'en';
}
// This signal is only used together with a unique module-owned READ match.
// Concepts, capability questions and references to prior replies need no live measurement.
export function asksForMeasure(prompt){
 const conceptual=/\b(?:how (?:do|does|is|are|to)\b[^?!.]{0,100}\b(?:calculat\w*|defin\w*|work|access)|what (?:does|is meant by)\b[^?!.]{0,100}\bmean|definition of|can (?:you|i) access|(?:we|i|you) (?:previously |just )?(?:asked|said|mentioned)|(?:apa maksud|cara (?:kira|mengira)))\b|是什么意思|是什麼意思|如何计算|如何計算|怎么算|怎麼算|之前.{0,8}(?:提到|问过|問過)/iu;
 return !conceptual.test(prompt)&&/\b(?:how (?:many|much)|number of|counts?|totals?|headcount|balances?|amounts?|quantity|quantities|highest|lowest|rank(?:ing)?|berapa(?:kah)?|bilangan|jumlah|baki|tertinggi|terendah)\b|多少|总[共数額额量計计]|總[共數額量計]|数量|數量|余[额額量]|餘[額量]|最高|最低/iu.test(prompt);
}
export function unverifiedReadReply(prompt){
 return {en:'I couldn’t verify the figures from the current records.',zh:'我还没有从当前记录中核实这些数据。',ms:'Saya belum dapat mengesahkan angka daripada rekod semasa.'}[businessReplyLanguage(prompt)];
}

// A discovery response contains schemas only. Reconstruct one scope question
// from the fields shared by its candidates; model prose is never the answer.
export function discoveryScopeQuestion(candidates,reply,prompt){
 if(!candidates?.length||!/[?？]$/u.test(reply)||/[.!;。！；?？\n]/u.test(reply.slice(0,-1)))return null;
 const question=reply.slice(0,-1);
 if(!/^(?:which\b|what\b|could you (?:specify|confirm)\b|please (?:specify|confirm)\b|cawangan\b|tempoh\b|boleh (?:nyatakan|sahkan)\b|请|請|哪|您指|你指)/iu.test(question))return null;
 const required=(schema,key)=>schema?.required?.includes(key)&&schema.properties[key]?.type!=null&&!schema.properties[key].type.includes('null');
 const outlet=/\b(?:outlet|branch|cawangan)\b|门店|門店|分店/iu.test(question)&&candidates.every(({parameters,scope})=>
  required(parameters,'outlet_id')||parameters?.properties?.outlet_name&&/\b(?:single|one) (?:authorized |Restaurant )*outlet\b/iu.test(scope||''));
 const period=/\b(?:period|month|year|date range|tempoh|bulan|tahun)\b|时间范围|時間範圍|期间|期間|月份|年份/iu.test(question)&&candidates.every(({parameters})=>{
  return required(parameters,'month')||required(parameters,'year')||required(parameters,'from')&&required(parameters,'to');
 });
 if(!outlet&&!period)return null;
 const language=businessReplyLanguage(prompt);
 if(language==='zh')return outlet&&period?'您想查哪家门店、哪个期间？':outlet?'您想查哪家门店？':'您想查哪个期间？';
 if(language==='ms')return outlet&&period?'Cawangan dan tempoh mana yang perlu disemak?':outlet?'Cawangan mana yang perlu disemak?':'Tempoh mana yang perlu disemak?';
 return outlet&&period?'Which outlet and period should I check?':outlet?'Which outlet should I check?':'Which period should I check?';
}

export function businessFailureReply(status,prompt='',code){
 const language=businessReplyLanguage(prompt);
 const chinese=language==='zh',malay=language==='ms';
 if(code==='capability_disconnected')return chinese?'这项查询的 AI 访问已关闭。':malay?'Akses AI untuk pertanyaan ini dimatikan.':'AI access for this query is disabled.';
 if(code==='entity_unresolved')return chinese?'我无法确认您指的门店或品项。请确认名称。':malay?'Sila sahkan nama cawangan atau item.':'I couldn’t confirm the outlet or item. Please confirm the name.';
 if(code==='discovery_unresolved')return chinese?'我还无法核实应该查询哪个来源。':malay?'Saya belum dapat mengesahkan sumber yang sesuai.':'I couldn’t verify which source to query.';
 return ({
  UNAUTHORIZED:chinese?'当前无法查看这项数据。请检查您的访问权限。':malay?'Akses semasa tidak membenarkan semakan ini.':'Your current access does not allow this read.',
  AMBIGUOUS:chinese?'请确认您指的是哪家门店或哪个品项。':malay?'Cawangan atau item yang mana satu?':'Please confirm which outlet or item you mean.',
  NO_MATCH:chinese?'在您可查看的范围内没有匹配记录。':malay?'Tiada rekod yang sepadan dalam skop akses anda.':'No matching record was found in your accessible scope.',
  UNSUPPORTED:chinese?'目前无法提供这项数据。':malay?'Maklumat ini belum tersedia.':'I can’t answer that from the currently available data.',
  EXECUTION_ERROR:chinese?'暂时无法读取这项数据，请重试。':malay?'Data tidak dapat dibaca buat sementara waktu. Sila cuba lagi.':'The data could not be read. Please try again.',
 })[status]||null;
}

// Only used when the model omitted part of a goal or contradicted a checked
// amount. Prefer the owning domain formatter and make remaining limits explicit.
export function sourcedResultSummary(evidence,prompt=''){
 const chinese=/\p{Script=Han}/u.test(prompt);
 const malay=!chinese&&/\b(?:berapa|semak|jumlah|inventori|baki)\b/iu.test(prompt);
 const citation=evidence?.knowledge?.citations?.[0];
 if(citation?.title&&citation.excerpt){
  const excerpt=citation.excerpt.length>300?citation.excerpt.slice(0,297)+'…':citation.excerpt;
  return citation.title+' ('+citation.version+') — '+excerpt;
 }
 const total=evidence?.total_matching??evidence?.total_count;
 if(evidence?.aggregate_complete===true&&Number.isSafeInteger(total)&&total>=0){
  return chinese?'符合条件的记录共 '+total+' 条。':malay?total+' rekod sepadan.':total+' matching record'+(total===1?'':'s')+'.';
 }
 return chinese?'可查看本次查询已保存的来源。':malay?'Lihat sumber yang disimpan untuk hasil ini.':'The result is available in the saved evidence.';
}
