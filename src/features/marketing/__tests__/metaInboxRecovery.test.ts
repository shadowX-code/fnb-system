import {describe,it,expect,vi} from 'vitest';
import {readRecentInbox} from '../../../../supabase/functions/_shared/metaInboxRecovery.ts';
import {MetaError} from '../../../../supabase/functions/_shared/metaGraph.ts';
const now=Date.parse('2026-10-13T03:00:00Z');
const conn={channel:'facebook',provider_account_id:'111',connected_at:'2026-10-12T03:00:00Z'};
const message={id:'real-mid',created_time:'2026-10-13T02:00:00Z',from:{id:'222'},to:{data:[{id:'111'}]},message:'Provider-returned inbound text'};
const response=(messages:any[])=>({data:[{participants:{data:[{id:'111'},{id:'222'}]},messages:{data:messages}}]});
const read=(data:any,c:any=conn)=>readRecentInbox({request:vi.fn().mockResolvedValue(data)} as any,c,'test-token','111',vi.fn(),now);
describe('bounded recent-message fallback',()=>{
 it.each(['facebook','instagram'])('adopts only exact %s inbound provider evidence',async channel=>{
  const graph={request:vi.fn().mockResolvedValue(response([message]))};
  const result=await readRecentInbox(graph as any,{...conn,channel},'test-token','111',vi.fn(),now);
  expect(result.events).toHaveLength(1);expect(result.complete).toBe(false);
  expect(graph.request.mock.calls[0][2]).toMatchObject({limit:5,fields:'id,participants{id},messages.limit(20){id,created_time,from,to,message}',...(channel==='instagram'?{platform:'instagram'}:{})});
 });
 it('rejects another recipient, ambiguous participants, old and pre-connect messages',async()=>{
  for(const bad of [{from:{id:'111'},to:{data:[{id:'222'},{id:'333'}]}},{to:{data:[{id:'999'}]}},{from:{id:'999'}},{created_time:'2026-10-10T00:00:00Z'},{message:undefined},{created_time:'2026-10-13T04:00:00Z'}])expect((await read(response([{...message,...bad}]))).events).toEqual([]);
  expect((await read(response([message]),{...conn,connected_at:'2026-10-13T02:30:00Z'})).events).toEqual([]);
 });
 it('reports truncated history without following provider URLs or claiming completeness',async()=>{
  const value=response([message]);(value as any).paging={next:'https://attacker.invalid/token'};
  const result=await read(value);expect(result).toMatchObject({reason:'bounded_history_gap',more_available:true,complete:false});
 });
 it('does not invent unavailable messages or suppress authority revocation',async()=>{
  const graph={request:vi.fn().mockRejectedValue(new MetaError('meta_permission_or_token_invalid'))};
  expect(await readRecentInbox(graph as any,conn,'test-token','111',vi.fn(),now)).toMatchObject({events:[],state:'unavailable',complete:false});
  await expect(readRecentInbox(graph as any,conn,'test-token','111',async()=>{throw new MetaError('connection_health_authority_changed');},now)).rejects.toThrow();
 });
});

it.each(['facebook','instagram'])('recovers verified %s outbound with chronology and no delivery claim',async channel=>{
 const sent={...message,id:'outgoing-mid',from:{id:'111'},to:{data:[{id:'222'}]},created_time:'2026-10-13T02:01:00Z',message:'Actual provider reply'};
 const result=await read(response([sent,message]),{...conn,channel});
 expect(result.events.map(e=>e.kind)).toEqual(['incoming','echo']);
 expect(result.events[1]).toMatchObject({peer_id:'222',event_id:'outgoing-mid',body:'Actual provider reply'});
 expect(result.events[1]).not.toHaveProperty('delivery_verified');
});
