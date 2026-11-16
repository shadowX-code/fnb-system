import {businessCapabilities} from '../../supabase/functions/native-assistant/business.js';
export const assistantErrors={};
export const configuration={can_edit:true,config:{model:'gpt-4o-mini',enabled:true,revision:1,provider_revision:1,tested_provider_revision:1,factory_reads_enabled:true,last_success_at:'2026-11-08T10:00:00Z',last_test_at:'2026-11-08T10:00:00Z',last_test_outcome:'verified'},runtime:{capabilities:businessCapabilities({factory_reads_enabled:true},{factory:true}),ready:true,connection_ready:true,runtime_available:true,tools:true,credential_ref:'native-assistant-openai',providers:[{value:'openai',models:['gpt-4o-mini']}],voice_default:{provider:'openai',voice:'cedar'},voice_providers:[{provider:'openai',configured:true,tested_at:'2026-11-08T10:00:00Z',test_error:null,active_voice:'cedar'}]}};
export async function assistantCall(action){
 if(action==='configuration')return configuration;
 if(action==='voice_usage')return {environment:'staging',can_edit:true,state:'available',policy:{enabled:true,revision:1,max_seconds:180,max_concurrent_sessions:4,per_user_daily_sessions:null},sessions:[
  {request_id:'fixture-1',actor:'fixture-user',provider:'openai',created_at:'2026-11-08T10:00:00Z',state:'closed',reason:'user_ended',observed_duration_seconds:72,observed_usage:{input_audio_tokens:500,output_audio_tokens:900}},
  {request_id:'fixture-2',actor:'fixture-user',provider:'openai',created_at:'2026-11-08T09:00:00Z',state:'failed',reason:'provider_rejected'},
 ]};
 throw new Error('Read-only renderer fixture: no saves, provider calls or business reads.');
}
