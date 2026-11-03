import {supabase} from '../../lib/supabase.ts';
const endpoint='https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/native-assistant';
export const assistantErrors={provider_not_authorized:'Native Assistant provider use has not been authorized.',provider_credential_missing:'The approved server credential is not configured.',model_not_authorized:'This model is not authorized for Native Assistant.',assistant_disabled:'Text conversation is disabled. Ask an administrator to test and enable it in AI Integrations.',authentication_required:'Sign in again to use AI Assistant.',admin_required:'An active Admin account is required.',settings_view_required:'Role Settings view permission is required.',settings_edit_required:'Role Settings edit permission is required.',configuration_changed:'The configuration changed. Refresh before saving.',connection_test_required:'Test the saved connection successfully before enabling conversations.',provider_timeout:'The model timed out. No successful answer was recorded.',provider_unavailable:'The model service is unavailable.',request_rate_limit:'Request limit reached. Wait a minute and try again.',daily_request_limit:'The daily request limit has been reached.',daily_token_budget:'The daily token budget has been reached.',assistant_busy:'The assistant is busy. Wait for the active request to finish or cancel it.',session_unavailable:'This conversation has expired or is not accessible.',cancelled:'Response cancelled.',turn_no_longer_active:'This response is no longer active.',provider_rejected:'The model provider rejected the request.',provider_reply_invalid:'The provider did not return a valid text answer.',provider_reply_incomplete:'The model response was incomplete.',conversation_limit:'This conversation reached its request limit. Start a new conversation.'};
export class AssistantClientError extends Error {constructor(code){super(assistantErrors[code]||'Assistant request unavailable. Try again or check AI Integrations.');this.code=code;}}
export async function assistantCall(action,args={},signal){
 const {data}=await supabase.auth.getSession();
 if(!data.session?.access_token)throw new AssistantClientError('authentication_required');
 const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
 const timer=setTimeout(()=>controller.abort(),45000);
 try{
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${data.session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({action,...args}),signal:controller.signal});
  const result=await response.json().catch(()=>({error:'assistant_unavailable'}));
  if(!response.ok||result.error)throw new AssistantClientError(result.error||'assistant_unavailable');
  return result;
 }catch(error){if(error instanceof AssistantClientError)throw error;throw new AssistantClientError(signal?.aborted?'cancelled':controller.signal.aborted?'provider_timeout':'assistant_unavailable');}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
