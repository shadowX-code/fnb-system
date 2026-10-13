import {describe,it,expect,vi} from 'vitest';
import {readInboxHistoryPage,runInboxHistory} from '../../../../supabase/functions/_shared/metaInboxHistory.ts';
import {MetaGraph} from '../../../../supabase/functions/_shared/metaGraph.ts';
const conn={channel:'facebook',provider_account_id:'111',connected_at:'2026-09-15T00:00:00Z'};
const job={window_from:'2026-09-15T00:00:00Z',window_to:'2026-10-13T00:00:00Z',checkpoint:{}};
const m={id:'mid-real',from:{id:'222'},to:{data:[{id:'111'}]},created_time:'2026-10-01T00:00:00Z',message:'Existing customer text'};
const row={id:'t_123',participants:{data:[{id:'111'},{id:'222'}]},messages:{data:[m],paging:{next:'https://evil.invalid',cursors:{after:'msg-next'}}}};
describe('approved bounded Inbox historical reader',()=>{
 it.each(['facebook','instagram'])('retains %s identity/time and resumes messages before next conversation',async channel=>{
  const graph={request:vi.fn().mockResolvedValueOnce({data:[row],paging:{next:'ignored',cursors:{after:'next-thread'}}}).mockResolvedValueOnce({...row,messages:{data:[m]}})};
  const guard=vi.fn();const first=await readInboxHistoryPage(graph as any,{...conn,channel},'token','111',job,guard);
  expect(first.events[0]).toMatchObject({event_id:'mid-real',occurred_at:new Date(m.created_time).toISOString(),channel});expect(first.checkpoint).toEqual({thread:'t_123',message_after:'msg-next',conversation_after:'next-thread'});expect(first.done).toBe(false);
  const next=await readInboxHistoryPage(graph as any,{...conn,channel},'token','111',{...job,checkpoint:first.checkpoint},guard);
  expect(graph.request.mock.calls[1][0]).toBe('t_123');expect(next.checkpoint).toEqual({conversation_after:'next-thread'});expect(graph.request.mock.calls[0][2]).toMatchObject({limit:1,...(channel==='instagram'?{platform:'instagram'}:{})});
 });
 it('omits inaccessible content and other-account messages without inventing evidence',async()=>{
  const bad=[{...m,from:{id:'111'}},{...m,message:undefined},{...m,to:{data:[{id:'999'}]}},{...m,created_time:'2026-09-01T00:00:00Z'}];
  const graph={request:vi.fn().mockResolvedValue({data:[{...row,messages:{data:bad}}]})};const result=await readInboxHistoryPage(graph as any,conn,'token','111',job,vi.fn());expect(result.events).toEqual([]);expect(result.omitted).toBe(3);expect(result.done).toBe(true);
 });
 it('preserves actual outgoing history without claiming delivery',async()=>{const graph={request:vi.fn().mockResolvedValue({data:[{...row,messages:{data:[{...m,from:{id:'111'},to:{data:[{id:'222'}]}}]}}]})};const result=await readInboxHistoryPage(graph as any,conn,'token','111',job,vi.fn());expect(result.events[0]).toMatchObject({kind:'echo',peer_id:'222',event_id:'mid-real'});expect(result.events[0]).not.toHaveProperty('delivery_verified');});
 it('rejects missing/repeating cursor, changed thread, pre-grant window and revoked authority',async()=>{
  const graph={request:vi.fn().mockResolvedValue({data:[row],paging:{next:'url'}})};
  await expect(readInboxHistoryPage(graph as any,conn,'token','111',job,vi.fn())).rejects.toThrow('history_cursor_unavailable');
  await expect(readInboxHistoryPage(graph as any,conn,'token','111',{...job,window_from:'2026-09-14T00:00:00Z'},vi.fn())).rejects.toThrow('history_window_unverified');
  await expect(readInboxHistoryPage(graph as any,conn,'token','111',job,async()=>{throw new Error('revoked')})).rejects.toThrow('revoked');
 });
 it('makes no provider request without an eligible approved canonical job',async()=>{
  const db={rpc:vi.fn().mockResolvedValue({data:null})},graph={request:vi.fn()};expect(await runInboxHistory(db,graph as any,vi.fn())).toBe(false);expect(graph.request).not.toHaveBeenCalled();
 });
 it('allows a provider conversation ID through fixed Graph transport and rejects arbitrary paths',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('{"id":"t_123"}',{status:200}));const graph=new MetaGraph({appId:'1',appSecret:'s',configId:'c',version:'v26.0'},fetcher);
  await graph.request('t_123','token',{fields:'id'});expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe('/v26.0/t_123');await expect(graph.request('https://evil.invalid','token')).rejects.toThrow('invalid_meta_endpoint');
 });
});
