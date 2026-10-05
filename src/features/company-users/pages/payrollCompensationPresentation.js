// Same-date corrections remain audit-visible; effective presentation selects the
// latest server-assigned revision without altering any financial values.
export function effectivePayVersions(versions = []) {
  const dates = new Map();
  for (const version of versions || []) {
    const previous = dates.get(version.effective_from);
    if (!previous || (version.revision || 1) > (previous.revision || 1)) dates.set(version.effective_from, version);
  }
  return [...dates.values()];
}
export function effectivePay(versions, date = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kuala_Lumpur",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())) {
  return effectivePayVersions(versions).filter(v=>v.effective_from<=date).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0] || null;
}

// Pay corrections change the reviewed terms, while retaining the applicable
// allocation and contract reference at the selected historical date.
export function compensationCorrectionInput(draft, versions) {
  const previous = effectivePay(versions, draft.effectiveFrom);
  return { ...draft, rate: Number(draft.rate),
    defaultCostOutletId: previous?.default_cost_outlet_id || null,
    sourceDocumentId: previous?.source_document_id || null };
}
