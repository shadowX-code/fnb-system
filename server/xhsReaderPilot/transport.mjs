import {gunzipSync,brotliDecompressSync,inflateSync} from 'node:zlib';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {publicIPv4} from '../creatorExtraction/network.mjs';
import {allowedResource} from '../creatorExtraction/urls.mjs';
// Cookies travel only on the browser's exact provider request, over pinned HTTPS.
export async function relay(route,budget,login){
 const req=route.request(),url=new URL(req.url()),method=req.method();
 const loginPost=login&&/^\/api\/sns\/web\/v\d+\/(?:login|qrcode|qr_code)(?:\/|$)/.test(url.pathname);
 const notePost=!login&&url.pathname==='/api/sns/web/v1/feed';
 if(!allowedResource(url.href,'xhs')||!['GET','HEAD'].includes(method)&&!(method==='POST'&&(loginPost||notePost))||['media','font','websocket'].includes(req.resourceType()))return route.abort();
 if(Date.now()>budget.deadline||++budget.requests>120)return route.abort();
 const addresses=await lookup(url.hostname,{all:true,family:4});if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))return route.abort();
 const body=req.postDataBuffer();if(body?.length>32768)return route.abort();
 const headers={};for(const [key,value] of Object.entries(req.headers()))if(['user-agent','accept','accept-language','content-type','cookie','origin','referer'].includes(key))headers[key]=value;
 const response=await new Promise((resolve,reject)=>{
  const request=https.request(url,{method,headers,lookup:(_h,opts,cb)=>opts.all?cb(null,[addresses[0]]):cb(null,addresses[0].address,4),timeout:Math.max(1,Math.min(10000,budget.deadline-Date.now()))},res=>{
   const chunks=[];let bytes=0;res.on('data',chunk=>{bytes+=chunk.length;budget.bytes+=chunk.length;if(bytes>5000000||budget.bytes>25000000)request.destroy(new Error('reader_limit'));else chunks.push(chunk)});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);
  });request.on('error',reject);request.on('timeout',()=>request.destroy(new Error('reader_timeout')));request.end(body);
 });
 const decode={gzip:gunzipSync,br:brotliDecompressSync,deflate:inflateSync}[response.headers['content-encoding']];if(decode){const before=response.body.length;response.body=decode(response.body,{maxOutputLength:5000000});budget.bytes+=response.body.length-before;if(budget.bytes>25000000)throw new Error('reader_limit')}
 const safe={};for(const [key,value] of Object.entries(response.headers))if(['content-type','content-security-policy','location','set-cookie','referrer-policy','x-frame-options'].includes(key)&&value){if(key==='set-cookie')safe[key]=[].concat(value).join('\n');else safe[key]=value}
 if(safe.location&&!allowedResource(new URL(safe.location,url).href,'xhs'))return route.abort();
 await route.fulfill({...response,headers:safe});
}
