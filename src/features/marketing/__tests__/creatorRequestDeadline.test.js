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

it('redacts share queries before errors reach canonical logging or staff feedback',async()=>{const log=vi.spyOn(console,'error').mockImplementation(()=>{});rpc.mockReturnValue({abortSignal:()=>Promise.resolve({error:{code:'23514',message:'Post URL could not be saved',details:'Row URL https://www.xiaohongshu.com/discovery/item/test?source=webshare&xsec_token=DO_NOT_LOG&xsec_source=pc_share',hint:'Retry after checking the Post'}})});await expect(creatorService.command({request:'r',org:'o',brand:'b',action:'save_post'})).rejects.toThrow('[redacted]');expect(JSON.stringify(log.mock.calls)).not.toContain('DO_NOT_LOG');expect(JSON.stringify(log.mock.calls)).not.toContain('pc_share');log.mockRestore()});
