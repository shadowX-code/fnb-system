// A declaration attached to the existing domain operation, not another registry.
export function declareReadInterface(def){
 const declared=def.interface||{};
 return Object.freeze({version:1,module_id:def.module_id,kind:'READ',
  query_kinds:declared.queryKinds||['bounded_read'],filters:def.properties,
  query:Object.freeze({version:1,dimensions:declared.queryKinds||['bounded_read'],modes:def.properties?.mode?.enum||null,mode_parameter:def.properties?.mode?'mode':null,allowed_filters:Object.keys(def.properties||{}),unsupported:declared.unsupported||['Undeclared metrics, grouping dimensions and historical comparisons are unavailable.'],follow_up:'Reuse explicit user filters and verified identifiers, then execute fresh authorized evidence. Never infer missing scope or relax filters after denial.'}),
  policy_group:def.policyGroup||null,
  authority:declared.authority||def.rpc||'domain-owned query',
  human_permission:def.permission,scope:def.scope,
  exposure:Object.freeze({fields:declared.fields||null,projection:def.project,policy:declared.sensitive||'Only the domain projection is exposed; unlisted fields are unavailable.'}),
  aggregates:declared.aggregates||'not_asserted',
  pagination:declared.pagination||'Bounded domain result. Never infer a complete total from returned rows or truncated=false.',
  unavailable:declared.unavailable||'Missing or denied evidence is unavailable, not zero; empty lists prove only that no rows were returned in this scope.',
  source:def.source,evidence_version:def.version||1,
 });
}
export function readCompleteness(contract,projected,args){
 return {aggregate_scope:contract.aggregates,row_scope:'bounded_projection',
  page:args.page??null,has_more:typeof projected.truncated==='boolean'?projected.truncated:null,
  total_assertion:contract.aggregates==='not_asserted'?'Do not derive complete totals from this result.':'Use only explicitly returned canonical aggregates and their completeness flags.',
  pagination:contract.pagination};
}
export const businessEvidenceInstructions='For headcount or totals use a summary query, not a list count. Never count a bounded page as a full total, even when truncated is false. Follow completeness.aggregate_scope and original source completeness flags. Employment status is distinct from login access. If no authorized summary tool is offered, explain that complete totals are unavailable. Historical evidence is not current business state.';

export const domainQueryInstructions=' When find_business_queries is offered, discover the relevant module schema and invoke it with run_business_query; these envelopes use the same human authority and policies. Continue a follow-up using the same explicit filters and identifiers unless the user changes them; re-read current evidence. Null optional scope means the current authorized scope, not missing information: do not demand an ID for an unfiltered employee summary or Factory catalogue. Use employee_directory summary for headcount/status/type breakdowns, list for name search, and employee_assignment only for a known employee assignment. Factory summary/list/detail share read_factory_finished_goods; page advances lists and sku selects exact detail. Do not fall back to an unrelated domain tool after denial or missing capability. Period comparison is available only where the offered domain declares it; preserve missing-period flags. Return a concise answer using explicit aggregates and state unavailable dimensions.';
