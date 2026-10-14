import https from 'node:https';
import {gunzipSync,brotliDecompressSync,inflateSync} from 'node:zlib';
import {lookup} from 'node:dns/promises';
import {allowedResource,platformUrl} from './urls.mjs';
export function publicIPv4(ip){const p=ip.split('.').map(Number);if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return false;const [a,b,c]=p;return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
export function networkBudget(ms=45000){return {deadline:Date.now()+ms,bytes:0,requests:0,redirects:0};}
export async function boundedGet(value,platform,budget,redirects=true,userAgent='FeedXPublicInspector/1.0',urlResolver=platformUrl){
 if(Date.now()>budget.deadline||++budget.requests>120)throw new Error('inspection_limit');
 const u=new URL(value);if(!allowedResource(u.href,platform))throw new Error('redirect_not_supported');
 const ips=await lookup(u.hostname,{all:true,family:4});if(!ips.length||ips.some(r=>!publicIPv4(r.address)))throw new Error('network_address_blocked');
 const result=await new Promise((resolve,reject)=>{
  const req=https.get(u,{lookup:(_host,_opts,cb)=>_opts.all?cb(null,[{address:ips[0].address,family:4}]):cb(null,ips[0].address,4),headers:{'user-agent':userAgent,'accept':'text/html,application/json,application/javascript,*/*;q=0.5','accept-encoding':'identity'},timeout:Math.min(12000,Math.max(1,budget.deadline-Date.now()))},res=>{
   let size=0;const chunks=[];res.on('data',c=>{size+=c.length;budget.bytes+=c.length;if(size>5000000||budget.bytes>25000000){req.destroy(new Error('inspection_limit'));return}chunks.push(c)});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks),url:u.href}));res.on('error',reject);
  });req.on('timeout',()=>req.destroy(new Error('provider_timeout')));req.on('error',reject);
 });
 const decompress={'gzip':gunzipSync,'br':brotliDecompressSync,'deflate':inflateSync}[result.headers['content-encoding']];if(decompress){const raw=result.body.length;result.body=decompress(result.body,{maxOutputLength:5000000});budget.bytes+=result.body.length-raw;if(budget.bytes>25000000)throw new Error('inspection_limit');}
 if(redirects&&result.status>=300&&result.status<400&&result.headers.location){if(++budget.redirects>5)throw new Error('redirect_limit');const next=new URL(result.headers.location,u).href;if(/^\/(?:accounts\/)?login(?:\/|$)/.test(new URL(next).pathname))throw new Error('provider_access_restricted');const p=urlResolver(next);if(p.platform!==platform)throw new Error('redirect_not_supported');return boundedGet(next,platform,budget,true,userAgent,urlResolver)}
 return result;
}
