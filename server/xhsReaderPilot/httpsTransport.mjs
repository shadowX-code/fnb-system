import https from 'node:https';
// Private-link TLS material is server-only. Never disable certificate verification.
export function readerHttpsRequest(endpoint,{body,authorization,tls,timeout=30000}){
 const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/v1/reader')return Promise.reject(new Error('reader_configuration_invalid'));
 if(!tls?.cert||!tls.key||!tls.ca)return Promise.reject(new Error('reader_tls_configuration_required'));
 return new Promise((resolve,reject)=>{
  const request=https.request(url,{method:'POST',cert:tls.cert,key:tls.key,ca:tls.ca,agent:false,rejectUnauthorized:true,minVersion:'TLSv1.2',headers:{Authorization:authorization,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},timeout},response=>{
   const chunks=[];let size=0;
   response.on('data',chunk=>{size+=chunk.length;if(size>64000)request.destroy(new Error('reader_response_invalid'));else chunks.push(chunk)});
   response.on('end',()=>{if(response.statusCode>=300&&response.statusCode<400)return reject(new Error('reader_redirect_denied'));resolve(new Response(Buffer.concat(chunks),{status:response.statusCode}))});response.on('error',()=>reject(new Error('reader_connection_failed')));
  });
  const timer=setTimeout(()=>request.destroy(new Error('reader_timeout')),timeout);timer.unref?.();request.on('close',()=>clearTimeout(timer));
  request.on('timeout',()=>request.destroy(new Error('reader_timeout')));request.on('error',error=>reject(new Error(['reader_timeout','reader_response_invalid'].includes(error.message)?error.message:'reader_connection_failed')));request.end(body);
 });
}
