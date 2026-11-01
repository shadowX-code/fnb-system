// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import manifest from '../../../config/factoryAgentActions.json';
import {getPermissionDefinitions,getPermissionGroups} from '../../../config/modules.ts';
import {factoryActions,actionArguments} from '../factory-mesti-mcp/actions.js';
import {createHandler,safeFactoryRpcError} from '../factory-mesti-mcp/protocol.js';
const request=(method,params)=>new Request('https://example.test',{method:'POST',headers:{authorization:`Bearer fxm_${'a'.repeat(43)}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
const args={request_id:'00000000-0000-4000-8000-000000000001',action:'job_order.cancel',target_id:'00000000-0000-4000-8000-000000000002',expected_version:'version',input:{}};
it('has one action manifest and keeps machine permissions outside Human Role editing',()=>{
 expect(factoryActions).toEqual(manifest.map(a=>a.key));
 const codes=getPermissionDefinitions().map(p=>p.code),visible=getPermissionGroups().flatMap(g=>g.modules);
 for(const a of manifest){expect(codes).toContain(`factory_agent_action_${a.key}`);expect(visible.some(m=>m.key===`factory_agent_action_${a.key.split('.')[0]}`)).toBe(false);}
 const sql=readFileSync(new URL('../../migrations/20261101004834_factory_agent_operational_actions.sql',import.meta.url),'utf8');
 for(const a of manifest)expect(sql).toContain(`values('${a.key}'`);
 expect(sql.slice(0,sql.indexOf('CREATE OR REPLACE FUNCTION feedx_integrations.fa_'))).not.toContain('insert into public.role_permissions');
 expect(()=>actionArguments({...args,action:'calibration.create',target_id:null,expected_version:null})).toThrow();
});
it('does not expose mutation tools or invoke an action for existing View-only access',async()=>{
 const backend=vi.fn().mockResolvedValue({tools:['query_factory_resources']});
 const response=await(await createHandler(backend)(request('tools/call',{name:'execute_factory_action',arguments:args}))).json();
 expect(response.error.code).toBe(-32003);expect(backend).toHaveBeenCalledTimes(1);
});
it('discovers only granted operations and preserves a committed receipt when telemetry fails',async()=>{
 const receipt={status:'completed',request_id:args.request_id,actor:{type:'machine',identity_id:'stable-agent'}};
 const backend=vi.fn().mockImplementation(async(token,tool)=>tool==='authorize'?{tools:['factory_action_context','execute_factory_action'],factory_actions:[{name:'job_order.cancel',capability:'cancel'}]}:receipt);
 const handler=createHandler(backend,{observe:async()=>{throw new Error('telemetry unavailable');}});
 const response=await(await handler(request('tools/call',{name:'execute_factory_action',arguments:args}))).json();
 expect(response.result.structuredContent).toEqual(receipt);
 const listed=await(await createHandler(backend)(request('tools/list'))).json();
 expect(listed.result.tools.every(t=>t.inputSchema.properties.action.enum.length===1)).toBe(true);
});
it('marks a lost response unknown and requires retry of the same intent, without claiming rollback',async()=>{
 const backend=vi.fn().mockImplementation(async(token,tool)=>{if(tool==='authorize')return {tools:['execute_factory_action'],factory_actions:[{name:'job_order.cancel'}]};throw new Error('network response lost');});
 const response=await(await createHandler(backend)(request('tools/call',{name:'execute_factory_action',arguments:args}))).json();
 expect(response.result.structuredContent).toMatchObject({status:'outcome_unknown',request_id:args.request_id,retry_same_request_id:true});
 expect(response.result.isError).toBe(true);
});

it('explains incomplete Cleaning without leaking arbitrary database errors',async()=>{
 const backend=vi.fn().mockImplementation(async(token,tool)=>{if(tool==='authorize')return {tools:['execute_factory_action'],factory_actions:[{name:'area_cleaning.verify'}]};throw safeFactoryRpcError({code:'55000',message:'Only completed Cleaning occurrences can be verified.'});});
 const response=await(await createHandler(backend)(request('tools/call',{name:'execute_factory_action',arguments:{...args,action:'area_cleaning.verify'}}))).json();
 expect(response.result.structuredContent).toMatchObject({status:'rejected',code:'55000',retry_same_request_id:false});
 expect(response.result.structuredContent.message).toContain('Cleaning is not completed');
});

it('strips arbitrary SQL messages at the actual RPC adapter boundary',()=>{
 expect(safeFactoryRpcError({code:'55000',message:'private record detail'}).message).toBe('Inspection denied or unavailable.');
 expect(safeFactoryRpcError({code:'42501',message:'Only completed Cleaning occurrences can be verified.'}).message).toBe('Inspection denied or unavailable.');
});
