import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const f=vi.hoisted(()=>({handler:null as any,rpc:vi.fn()}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.105.4',()=>({createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}},error:null})},rpc:f.rpc})}));
vi.mock('../../../../supabase/functions/_shared/privacyBlob.ts',()=>({commitJournal:vi.fn()}));
const base={SUPABASE_URL:'https://oyfobxdoyfuzsodogpgs.supabase.co',MARKETING_ENVIRONMENT:'production',MARKETING_META_APP_ID:'2182829996001809',MARKETING_META_LOGIN_CONFIG_ID:'2027095767950085',MARKETING_META_APP_SECRET:'synthetic-secret',MARKETING_META_GRAPH_VERSION:'v26.0',MARKETING_META_TOKEN_ENCRYPTION_KEY:btoa('x'.repeat(32)),MARKETING_WHATSAPP_SIGNUP_CONFIG_ID:'999',MARKETING_WHATSAPP_SIGNUP_VERSION:'v4',MARKETING_AI_ENABLED:'true',MARKETING_INBOX_AI_AUTO_ENABLED:'true'};
async function handler(slug:string,extra:Record<string,string>={}){
 vi.stubGlobal('Deno',{serve:(h:any)=>{f.handler=h},env:{get:(k:string)=>({...base,...extra} as any)[k]}});
 if(slug==='marketing-meta')await import('../../../../supabase/functions/marketing-meta/index.ts');else await import('../../../../supabase/functions/marketing-inbox/index.ts');
 return f.handler;
}
const request=(path:string,body:any={},origin='https://os.feedx.my')=>new Request(base.SUPABASE_URL+'/functions/v1/marketing-meta'+path,{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();f.rpc.mockResolvedValue({data:{eligible:true,can_configure:true},error:null});vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Unexpected provider request')}));});
afterEach(()=>vi.unstubAllGlobals());
it('keeps WhatsApp closed with general and automatic AI flags enabled',async()=>{
 const h=await handler('marketing-meta');const r=await h(request('/whatsapp/readiness',{organizationId:'org',brandId:'brand'}));
 expect(r.status).toBe(200);expect(await r.json()).toMatchObject({eligible:false,reason:'pilot_activation_required',sending_enabled:false,ai_enabled:false});expect(fetch).not.toHaveBeenCalled();
});
it.each(['/whatsapp/begin','/whatsapp/complete','/whatsapp/verify'])('denies %s before any code exchange or provider mutation',async path=>{
 const h=await handler('marketing-meta');expect((await h(request(path,{organizationId:'org',brandId:'brand'}))).status).toBe(409);
 expect(f.rpc.mock.calls.map(x=>x[0])).toEqual(['marketing_whatsapp_readiness']);expect(fetch).not.toHaveBeenCalled();
});
it('retains exact Production app identity and origin checks before WhatsApp authority',async()=>{
 let h=await handler('marketing-meta',{MARKETING_META_APP_ID:'2204918033458414'});expect((await h(request('/whatsapp/readiness'))).status).toBe(403);expect(f.rpc).not.toHaveBeenCalled();
 vi.resetModules();h=await handler('marketing-meta');expect((await h(request('/whatsapp/readiness',{},'https://fnb-system-staging.vercel.app'))).status).toBe(403);expect(f.rpc).not.toHaveBeenCalled();
});
it('requires authentication on WhatsApp routes independently of Meta configuration completeness',async()=>{
 const h=await handler('marketing-meta');const r=await h(new Request(base.SUPABASE_URL+'/functions/v1/marketing-meta/whatsapp/begin',{method:'POST',body:'{}'}));expect(r.status).toBe(401);expect(f.rpc).not.toHaveBeenCalled();
});
async function webhook(h:any,payload:any,signed=true){
 const body=JSON.stringify(payload),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(base.MARKETING_META_APP_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const mac=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,'0')).join('');
 return h(new Request(base.SUPABASE_URL+'/functions/v1/marketing-inbox/webhook',{method:'POST',headers:{'x-hub-signature-256':signed?'sha256='+mac:'sha256=00'},body}));
}
it('durably normalizes signed WhatsApp messages and echoes while rejecting unsigned input',async()=>{
 const h=await handler('marketing-inbox');const value={messaging_product:'whatsapp',metadata:{phone_number_id:'200'},messages:[{id:'wamid.synthetic=',from:'60110000000',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Synthetic inbound'}}]};
 const p={object:'whatsapp_business_account',entry:[{id:'100',changes:[{field:'messages',value}]}]};
 expect((await webhook(h,p,false)).status).toBe(401);expect(f.rpc).not.toHaveBeenCalled();
 expect((await webhook(h,p)).status).toBe(200);expect(f.rpc.mock.calls[0]).toMatchObject(['marketing_inbox_receive',{p_events:[{channel:'whatsapp',account_id:'200',waba_id:'100',event_id:'wamid.synthetic='}]}]);expect(fetch).not.toHaveBeenCalled();
 f.rpc.mockRejectedValueOnce(Error('Unavailable'));expect((await webhook(h,p)).status).toBe(503);
});
it('preserves the Production social parser and durable acknowledgement',async()=>{
 const h=await handler('marketing-inbox');expect((await webhook(h,{object:'page',entry:[]})).status).toBe(200);expect(f.rpc).toHaveBeenCalledWith('marketing_inbox_receive',{p_events:[]});expect(fetch).not.toHaveBeenCalled();
});
