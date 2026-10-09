import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.4';
import { META_BASE, META_REDIRECT, META_SCOPES, STAGING_ORIGIN, STAGING_SUPABASE, authorizationUrl, connectionBinding, hash, nonce, seal, unseal, verifySignedRequest } from '../_shared/metaSecurity.ts';
import { testAccountEnabled } from '../_shared/metaPublishing.ts';
import { MetaGraph } from '../_shared/metaGraph.ts';
const names=['MARKETING_META_APP_ID','MARKETING_META_APP_SECRET','MARKETING_META_LOGIN_CONFIG_ID','MARKETING_META_GRAPH_VERSION','MARKETING_META_TOKEN_ENCRYPTION_KEY'];
const env=(name:string)=>Deno.env.get(name)||'';
const origins=new Set([STAGING_ORIGIN,'http://localhost:5173']);
function headers(req:Request) {return {'Access-Control-Allow-Origin':origins.has(req.headers.get('origin')||'')?req.headers.get('origin')!:STAGING_ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',Vary:'Origin'};}
function json(req:Request,value:unknown,status=200) {return new Response(JSON.stringify(value),{status,headers:{...headers(req),'Content-Type':'application/json'}});}
async function call(db:any,name:string,args:any={}) {const {data,error}=await db.rpc(name,args);if(error)throw new Error(error.code==='42501'?'scope_denied':'marketing_request_rejected');return data;}
Deno.serve(async(req)=>{
 if(env('SUPABASE_URL')!==STAGING_SUPABASE)return json(req,{error:'Staging integration only.'},403);
 const path=new URL(req.url).pathname.split('/marketing-meta')[1]||'/';
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
 const missing=names.filter(n=>!env(n));
 if(path==='/configuration'&&req.method==='GET')return json(req,{configured:!missing.length,missing,redirect_uri:META_REDIRECT,app_domains:[new URL(STAGING_ORIGIN).hostname,new URL(STAGING_SUPABASE).hostname],deauthorization_uri:`${META_BASE}/deauthorize`,data_deletion_uri:`${META_BASE}/data-deletion`,permissions:META_SCOPES,test_execution_configured:Boolean(env('MARKETING_META_TEST_ACCOUNT_IDS')),production_execution_enabled:false});
 if(req.headers.get('origin')&&!origins.has(req.headers.get('origin')!))return json(req,{error:'Origin unavailable.'},403);
 const service=createClient(STAGING_SUPABASE,env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 try {
  if(path.startsWith('/deletion-status/')&&req.method==='GET') {
   const code=path.slice('/deletion-status/'.length);if(!/^[A-Za-z0-9_-]{43}$/.test(code))return json(req,{error:'Status unavailable.'},404);
   const data=await call(service,'marketing_meta_deletion_status',{p_hash:await hash(code)});return json(req,data||{error:'Status unavailable.'},data?200:404);
  }

  const config={appId:env(names[0]),appSecret:env(names[1]),configId:env(names[2]),version:env(names[3])};
  const key=env(names[4]);
  if(['deauthorize','data-deletion'].some(x=>path===`/${x}`)&&req.method==='POST') {
   if(!config.appSecret)return json(req,{error:'Meta signature configuration is unavailable.'},503);
   const raw=await req.text();if(raw.length>18000)return json(req,{error:'Invalid removal request.'},400);
   const signed=new URLSearchParams(raw).get('signed_request')||'';
   let subject;try{subject=await verifySignedRequest(signed,config.appSecret);}catch{return json(req,{error:'Invalid Meta signature.'},400);}
   const confirmation=nonce(),deletion=path==='/data-deletion';
   await call(service,'marketing_meta_removal_once',{p_request_hash:await hash(signed),p_user_id:subject.user_id,p_deletion:deletion,p_confirmation_hash:deletion?await hash(confirmation):null,p_issued_at:new Date(subject.issued_at*1000).toISOString()});
   return json(req,deletion?{url:`${META_BASE}/deletion-status/${confirmation}`,confirmation_code:confirmation}:{success:true});
  }
  let caller:any=null,user:any=null;
  if(req.method==='POST'&&['/authorize','/bind'].includes(path)) {
   const bearer=req.headers.get('authorization')||'';if(!bearer.startsWith('Bearer '))return json(req,{error:'Sign in to Marketing.'},401);
   caller=createClient(STAGING_SUPABASE,env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:bearer}},auth:{persistSession:false,autoRefreshToken:false}});
   const identity=await caller.auth.getUser();user=identity.data.user;if(identity.error||!user)return json(req,{error:'Sign in to Marketing.'},401);
  }
  if(missing.length)return json(req,{error:'Meta server configuration is incomplete.',missing},503);
  const graph=new MetaGraph(config,fetch,path==='/callback'?event=>console.info(JSON.stringify({tag:'marketing_meta_discovery_v1',...event})):undefined);
  if(path==='/callback'&&req.method==='GET') {
   const query=new URL(req.url).searchParams;const state=query.get('state')||'';
   if(!/^[A-Za-z0-9_-]{43}$/.test(state))return json(req,{error:'Invalid authorization state.'},400);
   const session=await call(service,'marketing_meta_consume',{p_state_hash:await hash(state)});
   let result='cancelled';
   if(!query.has('error')) {
    try {
     const discovery=await graph.exchange(query.get('code')||'');
     await call(service,'marketing_meta_stage',{p_session:session.id,p_user_id:discovery.userId,p_sealed:await seal(discovery,key,`oauth:${session.id}`),p_accounts:discovery.accounts});result='select_account';
    }catch{result='authorization_failed';}
   }
   const redirect=new URL(`${STAGING_ORIGIN}/marketing/settings`);redirect.searchParams.set('meta_result',result);redirect.searchParams.set('marketing_org',session.organization_id);redirect.searchParams.set('marketing_brand',session.brand_id);
   return new Response(null,{status:303,headers:{...headers(req),Location:redirect.toString()}});
  }
  if(req.method!=='POST'||!['/authorize','/bind'].includes(path))return json(req,{error:'Endpoint unavailable.'},404);
  const raw=await req.text();if(raw.length>10000)return json(req,{error:'Request too large.'},413);const body=JSON.parse(raw);
  if(path==='/authorize') {
   const state=nonce();await call(caller,'marketing_meta_begin',{p_org:body.organizationId,p_brand:body.brandId,p_state_hash:await hash(state),p_redirect_uri:META_REDIRECT});
   return json(req,{authorization_url:authorizationUrl(config,state)});
  }
  const session=await call(service,'marketing_meta_session_material',{p_session:body.sessionId,p_auth_user:user.id});
  const discovery=await unseal(session.sealed_discovery,[key,env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],`oauth:${session.id}`);
  const account=discovery.accounts.find((a:any)=>a.id===body.accountId&&a.channel===body.channel);
  const token=account&&discovery.tokens[`${account.channel}:${account.id}`];if(!token||Date.parse(discovery.expiresAt)<=Date.now())return json(req,{error:'Reconnect Meta to select this account.'},409);
  const verified=await graph.request(account.id,token,{fields:account.channel==='facebook'?'id,name':'id,username'});
  if(String(verified.id)!==account.id)return json(req,{error:'Meta account identity could not be verified.'},409);
  const sealed=await seal({token},key,connectionBinding({brand_id:session.brand_id,channel:account.channel,provider_account_id:account.id}));
  const connection=await call(service,'marketing_meta_bind',{p_session:session.id,p_auth_user:user.id,p_account_id:account.id,p_channel:account.channel,p_sealed:sealed,p_expiry:discovery.expiresAt,p_mode:'test'});
  const enabled=testAccountEnabled(connection.provider_account_id,env('MARKETING_META_TEST_ACCOUNT_IDS'));
  await call(service,'marketing_meta_execution_policy',{p_connection:connection.id,p_generation:connection.credential_generation,p_enabled:enabled});
  return json(req,{connection:{...connection,capabilities:{...connection.capabilities,execution_enabled:enabled}}});
 }catch {return json(req,{error:'Meta request could not be completed. Reload or reconnect and try again.'},400);}
});
