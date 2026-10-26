import {expect,it,vi} from 'vitest';
import {runInboxPlayground} from '../../../../supabase/functions/_shared/inboxPlayground.ts';
it('reuses shared generation and only isolated test RPCs, never delivery or conversation commands',async()=>{
 const invoke=vi.fn(async(_db,name)=>name==='marketing_inbox_test_prepare'?{state:'prepared'}:name==='marketing_inbox_actor'?'actor':name==='marketing_inbox_test_claim'?{lease:'l',simulation:true,kind:'reply'}:{state:'completed'}),generate=vi.fn().mockResolvedValue({body:{text:'Fixture'},model:'deterministic-faq',input:0,output:0});
 await runInboxPlayground('caller','service',invoke,{requestId:'r',org:'o',brand:'b',mode:'ai_first',history:[]},'fixture-key','gpt-5-mini',generate);
 expect(invoke.mock.calls.map(x=>x[1])).toEqual(['marketing_inbox_test_prepare','marketing_inbox_actor','marketing_inbox_test_claim','marketing_inbox_test_finish']);expect(generate).toHaveBeenCalledOnce();
});
it('never repeats a cached or claimed generation and records unknown usage on failure',async()=>{
 const generate=vi.fn(),cached=vi.fn().mockResolvedValue({state:'completed',cached:true});await runInboxPlayground({}, {},cached,{},'','',generate);expect(generate).not.toHaveBeenCalled();
 const invoke=vi.fn(async(_db,name)=>name==='marketing_inbox_test_prepare'?{state:'prepared'}:name==='marketing_inbox_test_claim'?{lease:'l'}:{});generate.mockRejectedValue(new Error('failure'));
 await expect(runInboxPlayground({}, {},invoke,{requestId:'r'},'fixture','gpt-5-mini',generate)).rejects.toThrow('failure');expect(invoke.mock.calls.at(-1)[2]).toMatchObject({p_error:true,p_input:null,p_output:null});
});
it('retains known provider usage when recording the proposal fails',async()=>{
 let first=true;const invoke=vi.fn(async(_db,name,args)=>{if(name==='marketing_inbox_test_prepare')return {state:'prepared'};if(name==='marketing_inbox_test_claim')return {lease:'l'};if(name==='marketing_inbox_test_finish'&&first){first=false;throw new Error('record rejected')}return {}});
 const generate=vi.fn().mockResolvedValue({body:{latency_ms:123},model:'gpt-5-mini',input:42,output:7});await expect(runInboxPlayground({}, {},invoke,{requestId:'r'},'fixture','gpt-5-mini',generate)).rejects.toThrow('record rejected');expect(invoke.mock.calls.at(-1)[2]).toMatchObject({p_error:true,p_input:42,p_output:7,p_model:'gpt-5-mini',p_body:{latency_ms:123}});
});
