// Presentation of the current, bounded voice_usage read model. Do not infer a
// session model from today's provider settings or price audio-only observations
// as a full session. No historical backfill or billing authority lives here.
export const observedCount = value => Number.isSafeInteger(value) && value >= 0;
export const usageNumber = value => observedCount(value) ? value.toLocaleString() : 'Unavailable';

export function voiceCostCoverage(session) {
 const usage = session.observed_usage;
 const audioComplete = observedCount(usage?.input_audio_tokens) && observedCount(usage?.output_audio_tokens);
 return {
  state: 'unavailable', estimatedUsd: null,
  reason: !usage ? 'No provider usage report was saved.'
   : !audioComplete ? 'Audio token usage was not recorded completely.'
   : 'Only audio totals were saved; full-session cost cannot be calculated.',
  missing: ['Session model', 'Text and cached-input token breakdown', 'Applicable pricing version and currency'],
 };
}

export function summarizeVoiceUsage(sessions) {
 const sum = selector => sessions.reduce((result,session) => {
  const value = selector(session);
  return observedCount(value) ? {value:(result.value ?? 0)+value,coverage:result.coverage+1} : result;
 },{value:null,coverage:0});
 return {
  count:sessions.length,
  states:sessions.reduce((counts,s) => {const state=s.state||'historical';counts[state]=(counts[state]||0)+1;return counts;},{}),
  duration:sum(s=>s.observed_duration_seconds),
  inputAudio:sum(s=>s.observed_usage?.input_audio_tokens),
  outputAudio:sum(s=>s.observed_usage?.output_audio_tokens),
  cost:{value:null,coverage:sessions.filter(s=>voiceCostCoverage(s).state==='estimated').length},
 };
}
