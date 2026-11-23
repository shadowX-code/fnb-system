// Routing and provenance stay on saved evidence. Models receive business facts
// and explicit coverage signals without the execution-layer descriptions.
export const answerStyle = ' Lead with the result in the user’s language, then give the one business caveat that affects it. Describe scope in terms of outlet, dates and records checked. Keep sorting, pages, projections, tool names, SQL and internal identifiers out of ordinary answers. Preserve material gaps, and distinguish incomplete records from partial display of a complete calculation. An answer_hint is the verified core answer. Use it without adding new caveats or procedural details.';

const executionNarration=/\b(?:pagination|paginated|page projection|bounded projection|current page|first page|page size|paged\s*\d+|\d+ (?:records|items|rows|recipes) per page|sort(?:ing|ed) (?:by|order|from)|(?:tool|operation) (?:schema|named|name|call|limit)|SQL|RLS|internal (?:id|identifier)|(?:read|run|find)_[a-z][a-z0-9_]+)\b|分页|分頁|投影结果|投影結果|按.{0,10}(?:排列|排序)|工具(?:名称|名稱|限制|调用|調用)|内部(?:编号|編號|识别|識別)|\b(?:penomboran halaman|halaman semasa|susunan menaik|susunan menurun|susunan isihan|nama alat)\b/iu;
const asksForMechanics=/\b(?:page|pages|pagination|sort(?:ing| order)?|SQL|tool (?:name|schema)|internal (?:id|identifier))\b|第\s*[\d一二三四五]+\s*[页頁]|[下上]一[页頁]|分页|分頁|(?:如何|怎么|怎麼)排序|工具名称|工具名稱|\bhalaman\b/iu;
export const exposesExecution = (reply, prompt) => !asksForMechanics.test(prompt||'')&&executionNarration.test(reply||'');

export const presentationText=(reply,prompt)=>!reply||asksForMechanics.test(prompt)?reply:reply.split(/\n/u)
 .map(line=>line.replace(/^Source:\s*\/[\w/-]+\.?\s*/u,''))
 .filter(line=>!/^Scope:.*(?:current (?:Admin|user) permissions|Read at)/iu.test(line))
 .join('\n').trim();

const portableLimits=value=>typeof value==='string'
 ?value.split(/(?<=[.!?。！？])\s+|\n+/u).filter(sentence=>!executionNarration.test(sentence)).join(' ').trim()
 :value;

export function businessResultForAnswer(evidence, prompt=''){
 // Discovery, correction schemas and action previews retain their machine contracts.
 if(!evidence||!evidence.capability||evidence.discovery_only||evidence.not_business_evidence||
    evidence.no_evidence||evidence.error||evidence.knowledge||evidence.resolution_required||
    !evidence.capability.startsWith('read_')||asksForMechanics.test(prompt))return evidence;
 const {completeness,scope,count_scope,match_scope,limitations,answer_hint,...facts}=evidence;
 const hint=presentationText(answer_hint,prompt);
 const coverage={
  ...typeof evidence.aggregate_complete==='boolean'?{total_verified:evidence.aggregate_complete}:{},
  ...typeof evidence.period_complete==='boolean'?{all_periods_have_records:evidence.period_complete}:{},
  ...typeof completeness?.has_more==='boolean'?{additional_matching_records:completeness.has_more}:{},
 };
 const limits=[scope,count_scope,match_scope,limitations].map(portableLimits).filter(Boolean);
 return {...facts,...Object.keys(coverage).length?{coverage}:{},...limits.length?{interpretation_limits:limits}:{},...hint?{answer_hint:hint}:{}};
}
