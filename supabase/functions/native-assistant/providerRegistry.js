import { AssistantError } from './provider.js';
import { createRealtimeCall, realtimeVoices } from './realtime.js';
import { createGrokSession, grokVoices } from './grokVoice.js';

export const providerVoices = { openai: realtimeVoices, grok: grokVoices };

export function credentialEnvironment(provider, entry) {
 const prefix = provider === 'openai' ? 'NATIVE_ASSISTANT_REALTIME_' : 'NATIVE_ASSISTANT_GROK_';
 return name => ({
  [prefix+'API_KEY']: entry.credential,
  [prefix+'APPROVED_USE']: 'native-assistant-staging-realtime-evaluation',
  [prefix+'APPROVAL_REFERENCE']: entry.approval_reference,
 })[name];
}

async function testGrok(token, signal) {
 await new Promise((resolve,reject) => {
  const socket = new WebSocket('wss://api.x.ai/v1/realtime?model=grok-voice-latest','xai-client-secret.'+token);
  const timeout = AbortSignal.any([AbortSignal.timeout(7000),...(signal?[signal]:[])]);
  function finish(ok) {
   timeout.removeEventListener('abort',fail);
   socket.onclose = socket.onerror = socket.onmessage = socket.onopen = null;
   socket.close();
   if(ok)resolve();else reject(new AssistantError('realtime_unavailable',502));
  }
  const fail = () => finish(false);
  timeout.addEventListener('abort',fail,{once:true});
  if(timeout.aborted){fail();return;}
  socket.onclose = socket.onerror = fail;
  socket.onopen = () => socket.send(JSON.stringify({type:'session.update',session:{voice:'eve',turn_detection:null}}));
  socket.onmessage = ({data}) => {
   try {
    const event=JSON.parse(data);
    if(event.type==='session.updated')finish(event.session?.voice==='eve');
    if(event.type==='error')fail();
   } catch { fail(); }
  };
 });
}

export async function verifyVoiceProvider(args, registry, {signal,transport,reserveRealtime}) {
 await reserveRealtime('start',args);
 let entry;
 try {
  entry = await registry('test_key',args);
  const get = credentialEnvironment(args.provider,entry);
  const result = args.provider==='openai'
   ? await createRealtimeCall({sdp:args.sdp,voice:'cedar',tools:[],transcription:false},get,{signal,transport})
   : await createGrokSession(get,{signal,transport});
  if(args.provider==='grok')await testGrok(result.client_secret,signal);
  await registry('test_finish',{provider:args.provider,revision:entry.revision});
  return args.provider==='openai'?{outcome:'verified',sdp:result.sdp}:{outcome:'verified'};
 } catch(error) {
  if(entry)await registry('test_finish',{provider:args.provider,revision:entry.revision,error:error instanceof AssistantError?error.code:'realtime_unavailable'}).catch(()=>{});
  throw error;
 } finally {
  await reserveRealtime('end',args).catch(()=>{});
 }
}
