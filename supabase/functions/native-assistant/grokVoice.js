import { AssistantError } from './provider.js';
export const grokVoices = ['eve'];
export const grokModel = 'grok-voice-latest';

export function grokReady(get) {
 const key = get('NATIVE_ASSISTANT_GROK_API_KEY');
 return get('NATIVE_ASSISTANT_GROK_APPROVED_USE') === 'native-assistant-staging-realtime-evaluation'
  && !!get('NATIVE_ASSISTANT_GROK_APPROVAL_REFERENCE') && !!key && !/[\r\n]/.test(key);
}

export async function createGrokSession(get, { signal, transport = fetch } = {}) {
 if (!grokReady(get)) throw new AssistantError('realtime_not_authorized', 403);
 const endpoint = 'https://api.x.ai/v1/realtime/client_secrets';
 try {
  const response = await transport(endpoint, {
   method: 'POST', redirect: 'error',
   headers: { Authorization: `Bearer ${get('NATIVE_ASSISTANT_GROK_API_KEY')}`, 'Content-Type': 'application/json' },
   body: JSON.stringify({ expires_after: { seconds: 60 } }),
   signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) {
   await response.body?.cancel();
   throw new AssistantError('realtime_unavailable', 502, { source: 'xai', endpoint, http_status: response.status, model: grokModel });
  }
  const { value, expires_at } = await response.json();
  const now = Date.now() / 1000;
  if (typeof value !== 'string' || !/^[\w.-]{12,4096}$/.test(value) || !Number.isSafeInteger(expires_at) || expires_at <= now || expires_at > now + 90) throw new Error();
  return { client_secret: value, expires_at };
 } catch (error) {
  if (error instanceof AssistantError) throw error;
  throw new AssistantError('realtime_unavailable', 502);
 }
}
