const observedCount = value => Number.isSafeInteger(value) && value >= 0;
export const usageNumber = value => observedCount(value) ? value.toLocaleString() : '—';
const usd = new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6});

export function formatVoiceCost(nanoUsd) {
 if (!observedCount(nanoUsd)) return 'Unavailable';
 if (nanoUsd > 0 && nanoUsd < 1000) return '< $0.000001';
 return usd.format(nanoUsd / 1e9);
}

export function voiceCostCoverage(session) {
 const usage = session.observed_usage;
 const state = ['estimated','partial'].includes(session.charge_status) && observedCount(session.estimated_cost_nano_usd)
  ? session.charge_status : 'unavailable';
 const reason = state === 'estimated' ? 'Estimated from recorded Realtime responses and transcription usage.'
  : state === 'partial' ? 'Some usage could not be priced or the call ended before final usage was captured.'
  : !usage ? 'No provider usage report was saved.'
  : !usage.pricing_version ? 'Historical report lacks a model and billable token breakdown.'
  : 'No complete usage event matched a verified rate.';
 return {state, reason, version:usage?.pricing_version, amount:formatVoiceCost(state==='unavailable'?null:session.estimated_cost_nano_usd)};
}

export function voiceMeteredDetails(usage) {
 if (!usage?.pricing_version) return [];
 const responses = usage.responses || [], transcriptions = usage.transcriptions || [];
 function total(key, entries) {
  const values = entries.map(([,entry]) => entry?.[key]).filter(observedCount);
  return values.length ? values.reduce((a,b)=>a+b,0) : null;
 }
 const asrMs = total('duration_ms',transcriptions);
 return [
  ['Model', usage.model ?? usage.session_model],
  ['Realtime responses priced', `${usage.priced_responses} / ${responses.length}`],
  ['Observed text tokens · in / out', `${usageNumber(total('text_in',responses))} / ${usageNumber(total('text_out',responses))}`],
  ['Observed cached input · text / audio / image', ['cached_text','cached_audio','cached_image'].map(key=>usageNumber(total(key,responses))).join(' / ')],
  ['Transcriptions priced', `${usage.priced_transcriptions} / ${transcriptions.length} · ${usage.transcription_model}${asrMs===null?'':` · ${(asrMs/1000).toLocaleString()}s observed`}`],
 ];
}
