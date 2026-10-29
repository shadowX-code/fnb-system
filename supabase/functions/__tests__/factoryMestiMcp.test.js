import {it,expect,vi} from 'vitest';
import {createHandler,tools,toolArguments} from '../factory-mesti-mcp/protocol.js';
const retired=['get_mesti_daily_status','list_mesti_exceptions','list_pending_verifications','get_mesti_evidence_details','get_mesti_requirement_schedule','query_mesti_resources'];
it('exposes only the canonical read gateway and rejects all retired aliases',async()=>{
 expect(tools.map(t=>t.name)).toEqual(['query_factory_resources']);
 const read=vi.fn().mockResolvedValue({tools:['query_factory_resources',...retired]});
 const handler=createHandler(read);
 const request=(method,params)=>new Request('https://example.test',{method:'POST',headers:{authorization:`Bearer fxm_${'a'.repeat(43)}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 expect((await (await handler(request('tools/list'))).json()).result.tools.map(t=>t.name)).toEqual(['query_factory_resources']);
 for(const name of retired){expect(()=>toolArguments(name,{})).toThrow();expect((await (await handler(request('tools/call',{name,arguments:{}}))).json()).error.code).toBe(-32602);}
 expect(read.mock.calls.every(c=>c[1]==='authorize')).toBe(true);
});
