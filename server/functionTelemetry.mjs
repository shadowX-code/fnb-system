import {randomUUID} from 'node:crypto';

// Vercel owns Active CPU and hard-timeout metrics. Never label wall time as CPU.
export function withFunctionTelemetry(route,handler){
 return async function(req,res){
  const started=performance.now(),requestId=randomUUID();
  // A start without completion can be correlated with Vercel's hard-timeout/error record.
  console.info(JSON.stringify({event:'feedx.function',phase:'start',route,request_id:requestId}));
  let status=200,outcome='completed',browser={};
  const originalStatus=res.status,originalJson=res.json;
  res.status=function(code){status=code;return originalStatus.call(this,code)};
  res.json=function(body){
   const diagnostics=body?.browser_diagnostics;
   if(typeof diagnostics?.attempted==='boolean')browser={browser_attempted:diagnostics.attempted,
    browser_succeeded:diagnostics.succeeded===true,
    browser_elapsed_ms:Number.isFinite(diagnostics.duration_ms)?Math.max(0,Math.min(60000,Math.round(diagnostics.duration_ms))):null};
   return originalJson.call(this,body);
  };
  try{return await handler(req,res)}
  catch(error){status=500;outcome=error?.name==='TimeoutError'?'timeout':'exception';throw error}
  finally{
   res.status=originalStatus;res.json=originalJson;
   // Fixed route, generated correlation ID and numeric outcomes only: no URL, token or body.
   console.info(JSON.stringify({event:'feedx.function',phase:'finish',route,request_id:requestId,
    elapsed_ms:Math.max(0,Math.round(performance.now()-started)),status_code:status,
    outcome:outcome==='completed'&&status>=400?'http_error':outcome,...browser}));
  }
 };
}
