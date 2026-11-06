import {afterEach,expect,it,vi} from 'vitest';
import {withFunctionTelemetry} from './functionTelemetry.mjs';
afterEach(()=>vi.restoreAllMocks());
function response(){return {status(code){this.statusCode=code;return this},json(body){this.body=body;return this}}}
it('emits completion before asynchronous post-response cleanup, without duplicating it',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{}),res=response();let release;
 const cleanup=new Promise(resolve=>{release=resolve});
 const pending=withFunctionTelemetry('/api/fixture',async(_req,res)=>{res.json({browser_diagnostics:{attempted:true,succeeded:true,duration_ms:120}});await cleanup})({},res);
 expect(log).toHaveBeenCalledTimes(2);
 expect(JSON.parse(log.mock.calls[1][0])).toMatchObject({phase:'finish',browser_attempted:true,browser_succeeded:true});
 release();await pending;expect(log).toHaveBeenCalledTimes(2);
});
it('logs only sanitized fixed-route outcomes and preserves the response',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{}),res=response(),status=res.status;
 const handler=withFunctionTelemetry('/api/fixture',async(_req,res)=>res.status(403).json({error:'private business payload'}));
 await handler({headers:{authorization:'Bearer secret'},url:'/api/fixture?token=secret',body:{private:'secret'}},res);
 expect(res.statusCode).toBe(403);expect(res.status).toBe(status);
 const event=JSON.parse(log.mock.calls.at(-1)[0]);
 expect(event).toMatchObject({event:'feedx.function',route:'/api/fixture',status_code:403,outcome:'http_error'});
 expect(event.elapsed_ms).toBeGreaterThanOrEqual(0);expect(event.request_id).toMatch(/^[a-f0-9-]{36}$/);
 expect(JSON.stringify(event)).not.toMatch(/secret|payload|Bearer/);
 expect(log).toHaveBeenCalledTimes(2);
 expect(JSON.parse(log.mock.calls[0][0])).toEqual({event:'feedx.function',phase:'start',route:'/api/fixture',request_id:event.request_id});
});
it.each(['TimeoutError','Error'])('retains thrown %s without logging its sensitive message',async name=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{}),res=response(),error=new Error('private token');error.name=name;
 await expect(withFunctionTelemetry('/api/fixture',async()=>{throw error})({},res)).rejects.toBe(error);
 expect(JSON.parse(log.mock.calls.at(-1)[0])).toMatchObject({status_code:500,outcome:name==='TimeoutError'?'timeout':'exception'});
 expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});
it('records only bounded browser measurements, never raw diagnostics or result data',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{}),res=response();
 await withFunctionTelemetry('/api/fixture',async(_req,res)=>res.json({caption:'private',browser_diagnostics:{attempted:true,succeeded:false,duration_ms:90000,url:'private',error:'secret'}}))({},res);
 const event=JSON.parse(log.mock.calls.at(-1)[0]);expect(event).toMatchObject({browser_attempted:true,browser_succeeded:false,browser_elapsed_ms:60000});
 expect(JSON.stringify(event)).not.toMatch(/private|secret|caption/);
});
