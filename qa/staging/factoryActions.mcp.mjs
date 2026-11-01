import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node factoryActions.mcp.mjs <owner-only Staging QA credential file> <prepare|execute|verify>');
if ((fs.statSync(process.argv[2]).mode & 0o077) !== 0) throw new Error('QA credential file must be owner-only.');
const root=path.dirname(path.resolve(process.argv[2]))+path.sep;
const setup=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const agents=setup.filter(x=>x.identity_id),fixture=setup.find(x=>x.fixture).fixture;
const endpoint='https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/factory-mesti-mcp';
async function call(agent,name,args){
 const response=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${agents[agent].one_time_credential}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(30000)});
 const result=await response.json();
 if(result.error||result.result?.isError) return {error:result.error||result.result,status:response.status};
 assert.equal(response.status,200);return result.result.structuredContent;
}
const mode=process.argv[3];
if(mode==='prepare'){
 const context=await call(0,'factory_action_context',{action:'area_cleaning.complete',target_id:fixture.id});
 assert(!context.error,JSON.stringify(context));
 const command={request_id:crypto.randomUUID(),action:'area_cleaning.complete',target_id:fixture.id,expected_version:context.expected_version,input:{note:'Labelled disposable Staging QA simulation; no real inspection or cleaning claim.'}};
 const pending=await call(0,'execute_factory_action',command);assert.equal(pending.status,'awaiting_confirmation',JSON.stringify(pending));
 fs.writeFileSync(root+'command.json',JSON.stringify(command),{mode:0o600});console.log(JSON.stringify({phase:'prepare',status:pending.status,request_id:command.request_id}));
}else if(mode==='execute'){
 const command=JSON.parse(fs.readFileSync(root+'command.json'));
 const result=await call(0,'execute_factory_action',command);assert.equal(result.status,'completed',JSON.stringify(result));
 const retry=await call(0,'execute_factory_action',command);assert.equal(retry.replayed,true);assert.equal(retry.completed_at,result.completed_at);
 const context=await call(0,'factory_action_context',{action:'area_cleaning.verify',target_id:fixture.id});
 const own=await call(0,'execute_factory_action',{request_id:crypto.randomUUID(),action:'area_cleaning.verify',target_id:fixture.id,expected_version:context.expected_version,input:{result:'verified'}});
 assert.equal(own.error?.code,-32003,JSON.stringify(own));
 const verify={request_id:crypto.randomUUID(),action:'area_cleaning.verify',target_id:fixture.id,expected_version:context.expected_version,input:{result:'verified',note:'Independent labelled QA simulation.'}};
 const pending=await call(1,'execute_factory_action',verify);assert.equal(pending.status,'awaiting_confirmation',JSON.stringify(pending));
 fs.writeFileSync(root+'verify.json',JSON.stringify(verify),{mode:0o600});console.log(JSON.stringify({phase:'execute',status:result.status,replay:retry.replayed,self_review:'denied',verification_request:verify.request_id}));
}else if(mode==='verify'){
 const command=JSON.parse(fs.readFileSync(root+'verify.json'));const result=await call(1,'execute_factory_action',command);assert.equal(result.status,'completed',JSON.stringify(result));console.log(JSON.stringify({phase:'verify',status:result.status,actor:result.actor.identity_id}));
}else throw new Error('Unknown phase');
