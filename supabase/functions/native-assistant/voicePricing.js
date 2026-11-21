export const PRICE_VERSION = 'openai-list-usd-2026-11-22';
export const PRICING_SOURCE = 'https://developers.openai.com/api/docs/pricing';

// Nano-USD per token (or per millisecond of gpt-transcribe audio).
const realtimeRates = {
 'gpt-realtime-2.1-mini': {
  text: [600, 60, 2400],
  audio: [10000, 300, 20000],
  image: [800, 80],
 },
};
const transcriptionRates = {'gpt-transcribe': 75};

function responseCost(tokens, rates) {
 if (!tokens || !rates) return null;
 const {input, output, text_in, audio_in, image_in, cached, cached_text, cached_audio, cached_image, text_out, audio_out} = tokens;
 if ([input, output, text_in, audio_in, image_in, cached, cached_text, cached_audio, cached_image, text_out, audio_out].some(x => !Number.isSafeInteger(x))) return null;
 if (input !== text_in + audio_in + image_in || output !== text_out + audio_out
  || cached !== cached_text + cached_audio + cached_image
  || cached_text > text_in || cached_audio > audio_in || cached_image > image_in) return null;
 return (text_in - cached_text) * rates.text[0] + cached_text * rates.text[1] + text_out * rates.text[2]
  + (audio_in - cached_audio) * rates.audio[0] + cached_audio * rates.audio[1] + audio_out * rates.audio[2]
  + (image_in - cached_image) * rates.image[0] + cached_image * rates.image[1];
}

export function priceVoiceMetering(report, model, transcriptionModel) {
 const rates = !report.model_changed && (report.model === null || report.model === model) && Object.hasOwn(realtimeRates, model) ? realtimeRates[model] : null;
 const responseCosts = report.responses.map(([,tokens]) => responseCost(tokens, rates));
 const transcriptionRate = Object.hasOwn(transcriptionRates, transcriptionModel) ? transcriptionRates[transcriptionModel] : null;
 const transcriptionCosts = report.transcriptions.map(([,usage]) =>
  transcriptionRate && Number.isSafeInteger(usage?.duration_ms) ? usage.duration_ms * transcriptionRate : null);
 const costs = [...responseCosts, ...transcriptionCosts];
 const attributed = costs.filter(cost => cost !== null);
 const observed = key => {
  const values = report.responses.map(([,usage]) => usage?.[key]).filter(Number.isSafeInteger);
  return values.length ? values.reduce((a,b) => a+b,0) : null;
 };
 return {
  ...report,
  source: 'browser_provider_observation',
  session_model: model,
  transcription_model: transcriptionModel,
  pricing_version: PRICE_VERSION,
  pricing_source: PRICING_SOURCE,
  currency: 'USD',
  priced_responses: responseCosts.filter(cost => cost !== null).length,
  priced_transcriptions: transcriptionCosts.filter(cost => cost !== null).length,
  input_audio_tokens: observed('audio_in'),
  output_audio_tokens: observed('audio_out'),
  estimated_cost_nano_usd: attributed.length ? attributed.reduce((a,b) => a+b,0) : null,
  charge_status: !attributed.length ? 'unavailable' : report.complete && rates && attributed.length === costs.length ? 'estimated' : 'partial',
 };
}
