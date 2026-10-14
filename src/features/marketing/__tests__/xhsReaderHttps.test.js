import {beforeAll,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {X509Certificate} from 'node:crypto';
import https from 'node:https';
import {readerServer,syntheticReader} from '../../../../server/xhsReaderPilot/server.mjs';
import {readerHttpsRequest} from '../../../../server/xhsReaderPilot/httpsTransport.mjs';
function certificate(){
 // Disposable self-signed test identity; PEM travels only through pipes and memory.
 const pem=execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout','/dev/stdout','-out','/dev/stdout','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-addext','extendedKeyUsage=serverAuth,clientAuth'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const key=pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/)[0],cert=pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)[0];return {key,cert,ca:cert,clientFingerprint:new X509Certificate(cert).fingerprint256};
}
let trusted,other;beforeAll(()=>{trusted=certificate();other=certificate()});
async function server(port=0,tls=trusted){const calls=[];const instance=readerServer({reader:syntheticReader(),org:'fixture-org',brand:'fixture-brand',anonKey:'fixture-public-key',tls,rpcFetch:async(url,options)=>{calls.push(url);return options.headers.Authorization==='Bearer fixture.jwt.signature'?new Response('true'):new Response('{}',{status:403})}});instance.rpcNames=calls;await new Promise(resolve=>instance.listen(port,'127.0.0.1',resolve));return instance}
const body=JSON.stringify({org:'fixture-org',brand:'fixture-brand',action:'status'});
const invoke=(port,tls=trusted,authorization='Bearer fixture.jwt.signature',value=body)=>readerHttpsRequest('https://127.0.0.1:'+port+'/v1/reader',{body:value,authorization,tls,timeout:2000});
it('demonstrates real loopback HTTPS + mTLS + canonical endpoint auth with synthetic data only',async()=>{
 const instance=await server();try{expect(instance.address().address).toBe('127.0.0.1');const result=await invoke(instance.address().port);expect(result.status).toBe(200);expect(await result.json()).toMatchObject({status:'synthetic_only',live_enabled:false,session_persistence_enabled:false});expect((await invoke(instance.address().port,trusted,'Bearer invalid.jwt.signature')).status).toBe(403);expect((await invoke(instance.address().port,trusted,undefined,JSON.stringify({org:'fixture-org',brand:'other',action:'status'}))).status).toBe(403);for(const action of ['login_start','login_check','inspect','disconnect']){const response=await invoke(instance.address().port,trusted,undefined,JSON.stringify({org:'fixture-org',brand:'fixture-brand',action}));expect(response.status).toBe(400);expect(await response.json()).toEqual({error:'reader_approval_required'})}expect(instance.rpcNames.some(url=>url.endsWith('marketing_creator_inspection_access'))).toBe(false);}finally{await new Promise(r=>instance.close(r))}
});
it('rejects untrusted certificates, incorrect client pins and callers without a client certificate',async()=>{
 const instance=await server();try{const port=instance.address().port;await expect(invoke(port,{...other,rejectUnauthorized:false,checkServerIdentity:()=>undefined})).rejects.toThrow('reader_connection_failed');await new Promise((resolve,reject)=>{const req=https.request('https://127.0.0.1:'+port+'/v1/reader',{ca:trusted.cert,method:'POST',agent:false},()=>reject(new Error('TLS accepted missing client certificate')));req.on('error',()=>resolve());req.end(body)})}finally{await new Promise(r=>instance.close(r))}
 const wrongPin=await server(0,{...trusted,clientFingerprint:other.clientFingerprint});try{expect((await invoke(wrongPin.address().port)).status).toBe(403)}finally{await new Promise(r=>wrongPin.close(r))}
});
it('fails closed while the worker is down and recovers on an explicit subsequent request',async()=>{
 let instance=await server();const port=instance.address().port;await new Promise(r=>instance.close(r));await expect(invoke(port)).rejects.toThrow('reader_connection_failed');instance=await server(port);try{expect((await invoke(port)).status).toBe(200)}finally{await new Promise(r=>instance.close(r))}
});
it('never follows a redirect or weakens TLS when the destination certificate changes',async()=>{
 const instance=await server(0,other);try{await expect(invoke(instance.address().port,trusted)).rejects.toThrow('reader_connection_failed');expect((await invoke(instance.address().port,other)).status).toBe(200)}finally{await new Promise(r=>instance.close(r))}
 const redirect=https.createServer({key:trusted.key,cert:trusted.cert,ca:trusted.ca,requestCert:true,rejectUnauthorized:true},(_req,res)=>{res.writeHead(302,{Location:'https://example.invalid/'});res.end()});await new Promise(r=>redirect.listen(0,'127.0.0.1',r));try{await expect(invoke(redirect.address().port)).rejects.toThrow('reader_redirect_denied')}finally{await new Promise(r=>redirect.close(r))}
});
