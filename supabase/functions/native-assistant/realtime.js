import { AssistantError } from './provider.js';

export const realtimeModel = 'gpt-realtime-2.1-mini';
export const realtimeVoices = ['cedar', 'marin', 'echo', 'ash', 'alloy'];
const endpoint = 'https://api.openai.com/v1/realtime/calls';

export function realtimeReady(get) {
 return get('NATIVE_ASSISTANT_REALTIME_APPROVED_USE') === 'native-assistant-staging-realtime-evaluation'
  && !!get('NATIVE_ASSISTANT_REALTIME_APPROVAL_REFERENCE')
  && !!get('NATIVE_ASSISTANT_REALTIME_API_KEY')
  && !/[\r\n]/.test(get('NATIVE_ASSISTANT_REALTIME_API_KEY'));
}

export async function createRealtimeCall({ sdp, voice }, get, { signal, transport = fetch } = {}) {
 if (!realtimeReady(get)) throw new AssistantError('realtime_not_authorized', 403);
 const form = new FormData();
 form.set('sdp', sdp);
 form.set('session', JSON.stringify({
  type: 'realtime',
  model: realtimeModel,
  output_modalities: ['audio'],
  max_output_tokens: 350,
  instructions: 'You are FeedX Assistant. Be concise, calm and professional. When speaking English, use a natural British English delivery. Respond in the user’s language. You have no access to FeedX records or business tools in this voice session. Direct inventory questions to the text assistant.',
  audio: {
   input: { noise_reduction: { type: 'near_field' }, turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true } },
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
