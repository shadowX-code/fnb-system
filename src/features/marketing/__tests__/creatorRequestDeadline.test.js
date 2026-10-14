import {afterEach,it,expect,vi} from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../../../lib/supabase',()=>({supabase:{rpc}}));
import {creatorService} from '../creatorService.js';
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks()});
it('releases a stalled confirmation and aborts transport without changing retry identity',async()=>{
 vi.useFakeTimers();let signal;rpc.mockReturnValue({abortSignal:s=>{signal=s;return new Promise(()=>{})}});
 const intent={request:'same-request',org:'org',brand:'brand',action:'save_collaboration',id:'record',revision:1,payload:{title:'Edits'}};
 const pending=creatorService.command(intent);const rejected=expect(pending).rejects.toThrow('Your edits are kept');await vi.advanceTimersByTimeAsync(30000);await rejected;expect(signal.aborted).toBe(true);expect(rpc.mock.calls[0][1].p_request).toBe('same-request');
});
it('clears its deadline on successful canonical acknowledgement',async()=>{
 vi.useFakeTimers();rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{revision:2},error:null})});expect(await creatorService.command({request:'r',org:'o',brand:'b',action:'save_collaboration'})).toEqual({revision:2});expect(vi.getTimerCount()).toBe(0);
});
