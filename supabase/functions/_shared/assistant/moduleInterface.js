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
export const businessEvidenceInstructions=' For headcount or totals use a summary query, not a list count. Never count a bounded page as a full total, even when truncated is false. Use the source completeness flags and source-specific definitions. Report employment status (active, resigned, terminated, other), employment type (full time, part time, probation, contract) and login access separately, including returned zeros when asked for all categories. Rank only using authoritative ranking and its unit. If ranking.status is unit_required, ask which listed unit to rank. A discovery miss is not a business read or permission decision. For a verified empty page, unmatched asset or ambiguous identity, report that precise result; never turn it into zero stock. Historical evidence is not current business state.';

export const domainQueryInstructions=' Use a matching named tool when offered; otherwise discover by short business module label, then call run_business_query with its exact schema. Search by resource before supplying filters. Restaurant Asset Tracking owns quantities of outlet assets such as utensils or equipment. For an asset lookup use the user’s exact asset phrase and outlet name in its detail query. Employee directory summary returns headcount, status and type without an employee ID; list searches names, assignment needs a known employee. Factory Finished Goods and Raw Material Inventory are separate catalogues without an outlet filter; use summary for counts, list for pages or rankings, and detail for exact SKU. Continue with prior explicit filters unless changed and fetch fresh evidence. Do not switch to another domain after a denial or discovery miss. Use only declared comparison dimensions and preserve missing-period flags.';
