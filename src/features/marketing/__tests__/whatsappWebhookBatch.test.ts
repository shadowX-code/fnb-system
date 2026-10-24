import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const fixture=vi.hoisted(()=>({handler:null as any,rpc:vi.fn()}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.105.4',()=>({createClient:()=>({rpc:fixture.rpc})}));
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();fixture.rpc.mockResolvedValue({data:{accepted:1},error:null});
 const values:Record<string,string>={SUPABASE_URL:'https://ujkzdaaadnvcfayuldmh.supabase.co',MARKETING_ENVIRONMENT:'staging',MARKETING_META_APP_SECRET:'fixture-secret',MARKETING_META_TOKEN_ENCRYPTION_KEY:btoa('x'.repeat(32))};
 vi.stubGlobal('Deno',{serve:(handler:any)=>{fixture.handler=handler},env:{get:(key:string)=>values[key]}});
 vi.spyOn(console,'warn').mockImplementation(()=>{});
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});
async function request(payload:any,valid=true){
 const body=typeof payload==='string'?payload:JSON.stringify(payload);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('fixture-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature='sha256='+Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,'0')).join('');
 return new Request('https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-inbox/webhook',{method:'POST',headers:{'x-hub-signature-256':valid?signature:'sha256=00'},body});
}
const payload=()=>({object:'whatsapp_business_account',entry:[{id:'100',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:'200'},messages:[null,{id:'wamid.valid',from:'300',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'safe sibling'}}]}},{field:'history',value:{metadata:{phone_number_id:'bad'},history:[null]}}]}]});
it('durably acknowledges valid siblings after signed per-item rejection without logging message content',async()=>{
 await import('../../../../supabase/functions/marketing-inbox/index.ts');
 const response=await fixture.handler(await request(payload()));expect(response.status).toBe(200);
 expect(fixture.rpc).toHaveBeenCalledWith('marketing_inbox_receive',{p_events:[expect.objectContaining({event_id:'wamid.valid'})]});
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['marketing_inbox_receive']);
 expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('safe sibling');
});
it('rejects bad signatures before normalization or durable ingestion',async()=>{
 await import('../../../../supabase/functions/marketing-inbox/index.ts');expect((await fixture.handler(await request(payload(),false))).status).toBe(401);expect(fixture.rpc).not.toHaveBeenCalled();
});
it('keeps invalid envelopes/JSON fail closed and retries durable failures',async()=>{
 await import('../../../../supabase/functions/marketing-inbox/index.ts');expect((await fixture.handler(await request('{bad'))).status).toBe(400);expect(fixture.rpc).not.toHaveBeenCalled();
 fixture.rpc.mockResolvedValue({error:{message:'fixture write failure'}});expect((await fixture.handler(await request(payload()))).status).toBe(503);
});
