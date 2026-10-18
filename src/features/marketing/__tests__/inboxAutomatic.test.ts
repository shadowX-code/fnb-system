import {deliverInboxReply} from '../../../../supabase/functions/_shared/inboxDelivery.ts';
import {it,expect,vi} from 'vitest';
import {runInboxAutomatic} from '../../../../supabase/functions/_shared/inboxAutomatic.ts';
import {aiAutoReplyConfigured,aiAutoReplyAllowed} from '../../../../supabase/functions/_shared/marketingExecution.mjs';
import {advanceInboxDelivery} from '../../../../supabase/functions/_shared/metaInboxAdapters.ts';
const settings:any={SUPABASE_URL:'https://ujkzdaaadnvcfayuldmh.supabase.co',MARKETING_META_APP_ID:'2204918033458414',MARKETING_META_LOGIN_CONFIG_ID:'1398015649111006',MARKETING_INBOX_AI_AUTO_ENABLED:'true',MARKETING_AI_ENABLED:'true',MARKETING_AI_MODEL:'gpt-5-mini',OPENAI_API_KEY:'fixture-not-a-credential',MARKETING_INBOX_SEND_ENABLED:'true',MARKETING_INBOX_TEST_PEER_IDS:'777'};
const get=(extra:any={})=>(key:string)=>({...settings,...extra}[key]||'');
const turn={turn_id:'t',lease:'l',cached_artifact:null,kind:'reply',history:[{kind:'incoming',text:'Can you help?'}]};
function dbFixture(extra:any={}) {return {rpc:vi.fn(async(name:string)=>({data:name==='marketing_inbox_auto_claim'?{...turn,...extra}:name==='marketing_inbox_auto_finish'?{state:'prepared',draft_id:'d',auth_user:'u'}:null,error:null}))};}
it('requires an independent explicit execution gate and exact environment identity',async()=>{
 for(const extra of [{MARKETING_INBOX_AI_AUTO_ENABLED:''},{SUPABASE_URL:'https://unknown.supabase.co'},{MARKETING_META_APP_ID:'2182829996001809'},{MARKETING_AI_ENABLED:'false'}]) {
  const db=dbFixture(),generate=vi.fn(),deliver=vi.fn();expect(await runInboxAutomatic(db,{},get(extra),generate,deliver)).toBe(false);expect(db.rpc).not.toHaveBeenCalled();expect(generate).not.toHaveBeenCalled();
 }
 expect(aiAutoReplyConfigured(get())).toBe(true);expect(aiAutoReplyAllowed('622626120924115','777',get())).toBe(true);expect(aiAutoReplyAllowed('999','777',get())).toBe(false);expect(aiAutoReplyAllowed('622626120924115','888',get())).toBe(false);
});
it('uses the shared engine and canonical finish before the shared delivery adapter',async()=>{
 const db=dbFixture(),generate=vi.fn().mockResolvedValue({body:{text:'source answer'},model:'deterministic-faq',input:0,output:0}),deliver=vi.fn().mockResolvedValue({state:'sent',receipt:'controlled-fixture-receipt'}),graph={withSignal:vi.fn().mockReturnThis()};
 expect(await runInboxAutomatic(db,graph,get(),generate,deliver)).toBe(true);expect(generate).toHaveBeenCalledTimes(1);expect(deliver).toHaveBeenCalledTimes(1);expect(db.rpc.mock.calls.map(x=>x[0])).toEqual(['marketing_inbox_auto_claim','marketing_inbox_auto_finish']);
 expect(db.rpc.mock.calls[1][1]).toMatchObject({p_turn:'t',p_lease:'l',p_input:0,p_output:0});
});
it('resumes a durable prepared delivery without repeating provider generation',async()=>{
 const db=dbFixture({delivery_only:true,state:'prepared',draft_id:'d',auth_user:'u'}),generate=vi.fn(),deliver=vi.fn().mockResolvedValue({state:'sent'});
 await runInboxAutomatic(db,{withSignal(){return this}},get(),generate,deliver);expect(generate).not.toHaveBeenCalled();expect(db.rpc.mock.calls.map(x=>x[0])).toEqual(['marketing_inbox_auto_claim']);expect(deliver).toHaveBeenCalledTimes(1);
});
it('preserves cached suggestions and hands uncertain delivery to staff without a resend',async()=>{
 const db=dbFixture({cached_artifact:'a'}),generate=vi.fn(),deliver=vi.fn().mockResolvedValue({state:'reconciling'});
 await runInboxAutomatic(db,{withSignal(){return this}},get(),generate,deliver);expect(generate).not.toHaveBeenCalled();expect(deliver).toHaveBeenCalledTimes(1);expect(db.rpc.mock.calls.at(-1)).toEqual(['marketing_inbox_auto_fail',{p_turn:'t',p_lease:'l',p_reason:'delivery_uncertain'}]);
});
it('provider/authority failure never retries generation or sends',async()=>{
 const db=dbFixture(),generate=vi.fn().mockRejectedValue(new Error('timeout')),deliver=vi.fn();
 await runInboxAutomatic(db,{},get(),generate,deliver);expect(generate).toHaveBeenCalledTimes(1);expect(deliver).not.toHaveBeenCalled();expect(db.rpc.mock.calls.at(-1)[0]).toBe('marketing_inbox_auto_fail');
});
it('takeover between the durable intent and final guard prevents any provider write',async()=>{
 let takeover=false;const post=vi.fn();const authority={execution_enabled:true,send_verified:true,webhook_verified:true,exact_authorizer_verified:true,page_tasks:['MESSAGE'],granted_scopes:['pages_messaging'],last_inbound_at:new Date().toISOString(),page_id:'111'};
 await expect(advanceInboxDelivery({channel:'facebook',authority,recipient:'777',text:'Source answer',state:{},guard:async()=>{if(takeover)throw new Error('human_handling')},checkpoint:async()=>{takeover=true},post})).rejects.toThrow('human_handling');expect(post).not.toHaveBeenCalled();
});

it('blocked canonical material cannot fall through to a provider write',async()=>{
 const db={rpc:vi.fn().mockResolvedValue({data:{state:'blocked'},error:null})},graph={request:vi.fn()};
 await expect(deliverInboxReply(db,graph,get(),'d','u',()=>true)).rejects.toThrow('authority_changed');expect(graph.request).not.toHaveBeenCalled();expect(db.rpc).toHaveBeenCalledTimes(1);
});
