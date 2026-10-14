import {createServer} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {pathToFileURL} from 'node:url';
import {createReader} from './reader.mjs';
import {sessionStore} from './sessionStore.mjs';
const STAGING='https://ujkzdaaadnvcfayuldmh.supabase.co';
export function readerServer({reader,org,brand,anonKey,rpcFetch=fetch,tls}){
 if(tls&&(!tls.key||!tls.cert||!tls.ca||!tls.clientFingerprint))throw new Error('reader_tls_configuration_required');
 const serve=tls?handler=>createHttpsServer({key:tls.key,cert:tls.cert,ca:tls.ca,requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.2'},handler):createServer;
 return serve(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
  if(tls&&(!req.socket.authorized||req.socket.getPeerCertificate().fingerprint256!==tls.clientFingerprint))return send(403,{error:'reader_access_denied'});
  if(req.method!=='POST'||req.url!=='/v1/reader'||req.headers.origin)return send(403,{error:'reader_access_denied'});
  if(!/^Bearer [\w.-]+$/.test(req.headers.authorization||''))return send(401,{error:'reader_sign_in_required'});
  let lease;
  const rpc=async(name,args)=>{const r=await rpcFetch(STAGING+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:anonKey,Authorization:req.headers.authorization,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('reader_access_denied');return r.json()};
  try{
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>5000)return send(413,{error:'reader_input_invalid'})}
   let body;try{body=JSON.parse(raw)}catch{return send(400,{error:'reader_input_invalid'})}
   if(body.org!==org||body.brand!==brand)return send(403,{error:'reader_access_denied'});
   if(!['status','login_start','login_check','disconnect','inspect'].includes(body.action))return send(400,{error:'reader_action_invalid'});
   if(await rpc('current_user_has_permission',{permission_code:'platform_organizations.manage'})!==true)return send(403,{error:'reader_access_denied'});
   await rpc('marketing_creator_directory',{p_org:org,p_brand:brand});
   if(reader.syntheticOnly&&body.action!=='status')throw new Error('reader_approval_required');
   if(body.action==='inspect')lease=await rpc('marketing_creator_inspection_access',{p_org:org,p_brand:brand,p_begin:true});
   const result=await reader.run(body.action,body.url);
   // Revocation during login/extraction must prevent fresh disclosure.
   if(await rpc('current_user_has_permission',{permission_code:'platform_organizations.manage'})!==true)throw new Error('reader_access_denied');
   await rpc('marketing_creator_directory',{p_org:org,p_brand:brand});
   send(200,result);
  }catch(e){const code=/^reader_[a-z_]+$/.test(e.message)?e.message:'reader_unavailable';send(code==='reader_access_denied'?403:400,{error:code})}
  finally{if(lease)await rpc('marketing_creator_inspection_access',{p_org:org,p_brand:brand,p_begin:false,p_lease:lease}).catch(()=>{})}
 });
}
// Synthetic mode cannot load a session, launch a browser, or return Post metadata.
export function syntheticReader(){return {syntheticOnly:true,async run(action){if(action!=='status')throw new Error('reader_approval_required');return {status:'synthetic_only',configured:true,live_enabled:false,session_persistence_enabled:false}},async shutdown(){}}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const env=process.env,org=env.XHS_READER_ORG,brand=env.XHS_READER_BRAND;
 if(!/^[a-f0-9-]{36}$/.test(org||'')||!/^[a-f0-9-]{36}$/.test(brand||'')||env.XHS_READER_SYNTHETIC_ONLY!=='true'&&!env.XHS_READER_SESSION_FILE||!env.VITE_SUPABASE_ANON_KEY)throw new Error('reader_configuration_required');
 const synthetic=env.XHS_READER_SYNTHETIC_ONLY==='true';
 const store=synthetic?null:sessionStore(env.XHS_READER_SESSION_FILE,env.XHS_READER_ENCRYPTION_KEY,org+':'+brand);
 const reader=synthetic?syntheticReader():createReader({store,executablePath:env.XHS_READER_CHROMIUM,liveApproved:env.XHS_READER_LIVE_APPROVED==='true'&&env.XHS_READER_PLATFORM_USE_CONFIRMED==='true',persistApproved:env.XHS_READER_SESSION_APPROVED==='true',postIds:(env.XHS_READER_POST_IDS||'').split(',').filter(id=>/^[a-f0-9]{24}$/.test(id)).slice(0,5)});
 const tlsValues=[env.XHS_READER_TLS_CERT,env.XHS_READER_TLS_KEY,env.XHS_READER_CLIENT_CA,env.XHS_READER_CLIENT_FINGERPRINT];
 if(tlsValues.some(Boolean)&&!tlsValues.every(Boolean))throw new Error('reader_tls_configuration_required');
 const tls=tlsValues.every(Boolean)?{cert:tlsValues[0],key:tlsValues[1],ca:tlsValues[2],clientFingerprint:tlsValues[3]}:undefined;
 const server=readerServer({reader,org,brand,anonKey:env.VITE_SUPABASE_ANON_KEY,tls});server.requestTimeout=35000;server.headersTimeout=5000;server.listen(Number(env.XHS_READER_PORT||4765),'127.0.0.1');
 const shutdown=()=>{server.close();reader.shutdown().finally(()=>process.exit())};process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
