// A declaration attached to the existing domain operation, not another registry.
export function declareReadInterface(def){
 const declared=def.interface||{};
 return Object.freeze({version:1,module_id:def.module_id,kind:'READ',
  query_kinds:declared.queryKinds||['bounded_read'],filters:def.properties,
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
