import { AssistantError, providerJson } from './provider.js';

export const realtimeModel = 'gpt-realtime-2.1-mini';
export const realtimeVoices = ['cedar', 'marin', 'echo', 'ash', 'alloy'];
export const voiceInstructions = 'You are FeedX Assistant. Respond briefly and professionally, using the user’s language including Malaysian mixed-language speech. Use a natural British English delivery when speaking English. For Finished Goods questions and follow-ups, fetch fresh evidence with the offered tool. If the tool is absent or denied, say you cannot access current stock. Never invent stock, timestamps or sources. Low means strictly below a positive recorded minimum. State unknown minimum counts separately and mention truncation, current Admin scope and read time. No business writes.';
const endpoint = 'https://api.openai.com/v1/realtime/calls';

export function realtimeReady(get) {
 return get('NATIVE_ASSISTANT_REALTIME_APPROVED_USE') === 'native-assistant-staging-realtime-evaluation'
  && !!get('NATIVE_ASSISTANT_REALTIME_APPROVAL_REFERENCE')
  && !!get('NATIVE_ASSISTANT_REALTIME_API_KEY')
  && !/[\r\n]/.test(get('NATIVE_ASSISTANT_REALTIME_API_KEY'));
}

export async function createRealtimeCall({ sdp, voice, tools, transcription = true, instructions = voiceInstructions }, get, { signal, transport = fetch } = {}) {
 if (!realtimeReady(get)) throw new AssistantError('realtime_not_authorized', 403);
 const form = new FormData();
 form.set('sdp', sdp);
 form.set('session', JSON.stringify({
  type: 'realtime',
  model: realtimeModel,
  output_modalities: ['audio'],
  max_output_tokens: 350,
  instructions,
  ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
  audio: {
   input: { noise_reduction: { type: 'near_field' }, ...(transcription?{transcription: { model: 'gpt-transcribe', prompt: 'Malaysian English, Mandarin and Malay may occur in the same utterance. Preserve the spoken language.' }}:{}), turn_detection: { type: 'server_vad', threshold: 0.67, prefix_padding_ms: 350, silence_duration_ms: 850, create_response: true, interrupt_response: true } },
   output: { voice },
  },
 }));
 let response;
 try {
  response = await transport(endpoint, {
   method: 'POST', body: form, redirect: 'error',
   headers: { Authorization: `Bearer ${get('NATIVE_ASSISTANT_REALTIME_API_KEY')}` },
   signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
  });
 } catch {
  throw new AssistantError('realtime_unavailable', 502);
 }
 if (!response.ok) {
  await response.body?.cancel();
  const code = ({401:'realtime_permission_denied',403:'realtime_permission_denied',404:'realtime_model_unavailable',429:'realtime_rate_limited'})[response.status] || 'realtime_unavailable';
  throw new AssistantError(code, 502, { source: 'openai', http_status: response.status, endpoint, model: realtimeModel });
 }
 const answer = await response.text();
 if (!answer.startsWith('v=0') || answer.length > 24000) throw new AssistantError('realtime_unavailable', 502);
 return { sdp: answer };
}

// This baseline is intentionally isolated from conversation history and business tools.
export const sdkBaselineInstructions = 'You are the FeedX voice test assistant. Reply briefly in the language the user speaks, including mixed English and Mandarin. This session is for audio verification.';

export async function createSdkVoiceSecret(voice, get, { signal, transport = fetch } = {}) {
 if (!realtimeReady(get)) throw new AssistantError('realtime_not_authorized', 403);
 const endpoint = 'https://api.openai.com/v1/realtime/client_secrets';
 let response;
 try {
  response = await transport(endpoint, {
   method: 'POST',
   redirect: 'error',
   headers: { Authorization: `Bearer ${get('NATIVE_ASSISTANT_REALTIME_API_KEY')}`, 'Content-Type': 'application/json' },
   signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
   body: JSON.stringify({
    expires_after: { anchor: "created_at", seconds: 60 },
    session: { type: 'realtime', model: realtimeModel, instructions: sdkBaselineInstructions, output_modalities: ['audio'], audio: { output: { voice } } },
   }),
  });
 } catch {
  throw new AssistantError('realtime_unavailable', 502);
 }
 if (!response.ok) {
  const error = await providerJson(response, 16384).then(body => body?.error).catch(() => null);
  const categories = {
   insufficient_quota: 'provider_quota_exhausted',
   billing_hard_limit_reached: 'provider_budget_exhausted',
   project_spend_limit_exceeded: 'provider_budget_exhausted',
   organization_spend_limit_exceeded: 'provider_budget_exhausted',
   rate_limit_exceeded: 'realtime_rate_limited',
   rate_limit_error: 'realtime_rate_limited',
   tokens: 'realtime_rate_limited',
   requests: 'realtime_rate_limited',
   invalid_api_key: 'realtime_permission_denied',
   authentication_error: 'realtime_permission_denied',
   insufficient_permissions: 'realtime_permission_denied',
   permission_denied: 'realtime_permission_denied',
   permission_error: 'realtime_permission_denied',
   server_error: 'realtime_provider_temporary',
   overloaded_error: 'realtime_provider_temporary',
   model_not_found: 'realtime_model_unavailable',
   unsupported_value: 'realtime_unavailable',
   invalid_value: 'realtime_unavailable',
   unknown_parameter: 'realtime_unavailable',
   missing_required_parameter: 'realtime_unavailable',
  };
  const recognized = value => typeof value === 'string' && Object.hasOwn(categories, value);
  const sanitize = value => value == null ? null : recognized(value) || value === 'invalid_request_error' ? value : 'unrecognized_redacted';
  const fallback = {401:'realtime_permission_denied',403:'realtime_permission_denied',429:'realtime_429_unclassified'};
  const code = recognized(error?.code) ? categories[error.code] : recognized(error?.type) ? categories[error.type] :
   fallback[response.status] || (response.status >= 500 ? 'realtime_provider_temporary' : 'realtime_unavailable');
  const diagnostic = {
   source:'openai', http_status:response.status, endpoint, model:realtimeModel,
   provider_error_code:sanitize(error?.code), provider_error_type:sanitize(error?.type),
  };
  const knownParameters=['session','session.type','session.model','session.instructions','session.output_modalities','session.audio.output.voice','expires_after','expires_after.seconds','expires_after.anchor'];
  if(knownParameters.includes(error?.param))diagnostic.provider_error_param=error.param;
  const retryAfter = response.headers.get('retry-after')?.trim() || '';
  if (/^\d{1,9}$/.test(retryAfter)) diagnostic.retry_after_seconds = Number(retryAfter);
  else if (/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retryAfter)) {
   const retryAt = Date.parse(retryAfter);
   if (Number.isFinite(retryAt)) diagnostic.retry_after_seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
  }
  const requestId = response.headers.get('x-request-id') || '';
  if (/^req_[A-Za-z0-9_-]{1,100}$/.test(requestId)) diagnostic.request_id = requestId;
  console.warn('Native Assistant SDK startup rejected', JSON.stringify({ code, ...diagnostic }));
  throw new AssistantError(code, 502, diagnostic);
 }
 const result = await response.json().catch(() => null);
 if (typeof result?.value !== 'string' || !/^ek_[A-Za-z0-9_-]{8,2048}$/.test(result.value)) throw new AssistantError('realtime_unavailable', 502);
 return { client_secret: result.value, model: realtimeModel, instructions: sdkBaselineInstructions };
}
