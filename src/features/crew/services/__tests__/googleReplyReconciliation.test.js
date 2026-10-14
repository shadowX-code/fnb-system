import {describe,it,expect,vi} from 'vitest';
import {readReconciledReply} from '../googleReplyReconciliation.js';
describe('bounded reply readback',()=>{
 it('retries only pending reads with bounded delays',async()=>{
  const wait=vi.fn(),read=vi.fn().mockResolvedValue({reply_sync_pending:true});
  expect(await readReconciledReply(read,()=>true,wait)).toEqual({reply_sync_pending:true});expect(read).toHaveBeenCalledTimes(4);expect(wait.mock.calls).toEqual([[2000],[6000],[12000]]);
 });
 it('stops on success and never retries a provider error',async()=>{
  const wait=vi.fn(),read=vi.fn().mockResolvedValueOnce({reply_sync_pending:true}).mockResolvedValue({reply_sync_pending:false});
  expect((await readReconciledReply(read,()=>true,wait)).reply_sync_pending).toBe(false);expect(read).toHaveBeenCalledTimes(2);
  const failed=vi.fn().mockRejectedValue(new Error('429'));await expect(readReconciledReply(failed,()=>true,wait)).rejects.toThrow('429');expect(failed).toHaveBeenCalledTimes(1);
 });
 it('cancels subsequent reads when the detail closes',async()=>{
  let current=true;const read=vi.fn().mockResolvedValue({reply_sync_pending:true});
  expect(await readReconciledReply(read,()=>current,async()=>{current=false;})).toBeNull();expect(read).toHaveBeenCalledTimes(1);
 });
});
