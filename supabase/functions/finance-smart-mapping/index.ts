import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.4';
import { analyzeMappingBatch, mappingModel } from './provider.js';

const staging = 'https://ujkzdaaadnvcfayuldmh.supabase.co';
const origin = 'https://fnb-system-staging.vercel.app';
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Cache-Control':'no-store',
  'Content-Type':'application/json',
};
const reply = (value:unknown,status=200) => new Response(JSON.stringify(value),{headers,status});
const auth = {persistSession:false,autoRefreshToken:false};
const industries = ['core','restaurant','manufacturing','retail'];

Deno.serve(async (req) => {
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if (req.method!=='POST' || Deno.env.get('SUPABASE_URL')!==staging || (req.headers.has('origin') && req.headers.get('origin')!==origin)) {
    return reply({state:'unavailable'},403);
  }
  const bearer=req.headers.get('authorization') ?? '';
  if (!bearer.startsWith('Bearer ')) return reply({state:'sign_in_required'},401);
  const caller=createClient(staging,Deno.env.get('SUPABASE_ANON_KEY') ?? '',{auth,global:{headers:{Authorization:bearer}}});
  const {data:identity,error:identityError}=await caller.auth.getUser();
  if (identityError || !identity.user) return reply({state:'sign_in_required'},401);
  let body;
  try {
    const raw=await req.text();
    if (raw.length>512) return reply({state:'invalid_request'},413);
    body=JSON.parse(raw);
  } catch {
    return reply({state:'invalid_request'},400);
  }
  const id=body?.connectionId, industry=body?.industry;
  if (typeof id!=='string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id) || !industries.includes(industry)) {
    return reply({state:'invalid_request'},400);
  }
  const reviewArgs={p_connection_id:id,p_industry:industry};
  const { data:review,error:reviewError }=await caller.rpc('finance_account_mapping_assistance',reviewArgs);
  if (reviewError || !review) return reply({state:reviewError?.code==='PT403'?'owner_required':'chart_unavailable'},reviewError?.code==='PT403'?403:409);
  if (review.pending===0) return reply({state:'cached',usage:{input:0,output:0,cached:0},review});
  const apiKey=Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return reply({state:'provider_unconfigured',review});
  const service=createClient(staging,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',{auth});
  const {data:batch,error:prepareError}=await service.rpc('finance_mapping_ai_prepare',{
    p_connection:id,p_snapshot:review.snapshotId,p_industry:industry,p_model:mappingModel,
  });
  if (prepareError || !batch) return reply({state:prepareError?.code==='PT409'?'chart_changed':'analysis_failed',review});
  if (batch.state!=='ready') return reply({state:batch.state,usage:{input:0,output:0,cached:0},review});
  let result;
  try { result=await analyzeMappingBatch(batch,industry,apiKey); }
  catch { result={error:'provider_unreachable'}; }
  const {error:finished}=await service.rpc('finance_mapping_ai_finish',{
    p_run:batch.runId,p_results:result.results??null,p_error:result.error??null,
    p_input:result.usage?.input??null,p_output:result.usage?.output??null,p_cached:result.usage?.cached??null,
  });
  if (finished) return reply({state:'analysis_failed',usage:result.usage??null});
  const {data:updated,error:updatedError}=await caller.rpc('finance_account_mapping_assistance',reviewArgs);
  if (updatedError || !updated || updated.snapshotId!==review.snapshotId) return reply({state:'chart_changed',usage:result.usage??null});
  return reply({state:updated.lastRun?.state==='completed'?'completed':updated.lastRun?.error??'analysis_failed',
    usage:result.usage??null,review:updated});
});
