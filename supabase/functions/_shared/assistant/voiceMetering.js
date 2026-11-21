// Store only metering fields. Raw provider events can include transcripts and tool arguments.
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 3_600_000 ? value : null;
const providerId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const modelId = value => typeof value === 'string' && /^[a-z0-9.-]{1,64}$/.test(value);
const fields = ['input', 'output', 'text_in', 'audio_in', 'image_in', 'cached', 'cached_text', 'cached_audio', 'cached_image', 'text_out', 'audio_out'];

function responseTokens(usage) {
 if (!usage) return null;
 const input = usage.input_token_details, output = usage.output_token_details, cache = input?.cached_tokens_details;
 return {
  input: count(usage.input_tokens), output: count(usage.output_tokens),
  text_in: count(input?.text_tokens ?? (input ? 0 : null)),
  audio_in: count(input?.audio_tokens ?? (input ? 0 : null)),
  image_in: count(input?.image_tokens ?? (input ? 0 : null)),
  cached: count(input?.cached_tokens),
  cached_text: count(cache?.text_tokens ?? (input?.cached_tokens === 0 || cache ? 0 : null)),
  cached_audio: count(cache?.audio_tokens ?? (input?.cached_tokens === 0 || cache ? 0 : null)),
  cached_image: count(cache?.image_tokens ?? (input?.cached_tokens === 0 || cache ? 0 : null)),
  text_out: count(output?.text_tokens ?? (output ? 0 : null)),
  audio_out: count(output?.audio_tokens ?? (output ? 0 : null)),
 };
}

export function createVoiceMetering() {
 const responses = new Map(), transcriptions = new Map();
 let revision = 0, truncated = false, model = null, modelChanged = false;
 function record(map, id, value, maximum) {
  if (!providerId(id)) return;
  if (!map.has(id) && map.size >= maximum) {
   if (!truncated) revision++;
   truncated = true;
   return;
  }
  if (map.has(id) && (map.get(id) !== null || value === null)) return;
  map.set(id, value);
  revision++;
 }
 return {
  receive(event) {
   if ((event.type === 'session.created' || event.type === 'session.updated') && modelId(event.session?.model)) {
    if (model !== event.session.model) {
     modelChanged ||= model !== null;
     model = event.session.model;
     revision++;
    }
   } else if (event.type === 'response.created' || event.type === 'response.done') {
    record(responses, event.response?.id, event.type === 'response.done' ? responseTokens(event.response.usage) : null, 64);
   } else if (event.type === 'input_audio_buffer.committed' || event.type === 'conversation.item.input_audio_transcription.completed' || event.type === 'conversation.item.input_audio_transcription.failed') {
    const usage = event.usage;
    const measured = usage?.type === 'duration' && Number.isFinite(usage.seconds)
     ? { duration_ms: count(Math.round(usage.seconds * 1000)) }
     : usage?.type === 'tokens' ? {
      input: count(usage.input_tokens), output: count(usage.output_tokens),
      audio_in: count(usage.input_token_details?.audio_tokens), text_in: count(usage.input_token_details?.text_tokens),
     } : null;
    record(transcriptions, event.item_id, measured, 32);
   }
  },
  snapshot(cleanEnd = false) {
   return {
    revision, model, model_changed: modelChanged, complete: cleanEnd && !truncated,
    responses: [...responses], transcriptions: [...transcriptions],
   };
  },
 };
}

export function normalizeVoiceMetering(report) {
 if (!report || typeof report !== 'object' || Array.isArray(report) || count(report.revision) === null
  || (report.model !== null && !modelId(report.model))
  || typeof report.complete !== 'boolean' || typeof report.model_changed !== 'boolean') return null;
 function normalize(entries, limit, keys) {
  if (!Array.isArray(entries) || entries.length > limit) return null;
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
   if (!Array.isArray(entry) || entry.length !== 2 || !providerId(entry[0]) || seen.has(entry[0])) return null;
   const [id, counters] = entry;
   seen.add(id);
   if (counters === null) result.push([id, null]);
   else {
    if (typeof counters !== 'object' || !Object.keys(counters).length || Object.keys(counters).some(key => !keys.includes(key) || (counters[key] !== null && count(counters[key]) === null))) return null;
    result.push([id, counters]);
   }
  }
  return result;
 }
 const responses = normalize(report.responses, 64, fields);
 const transcriptions = normalize(report.transcriptions, 32, ['duration_ms', 'input', 'output', 'audio_in', 'text_in']);
 if (!responses || !transcriptions) return null;
 const {revision, model, model_changed, complete} = report;
 return {revision, model, model_changed, complete, responses, transcriptions};
}
