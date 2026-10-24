import {it,expect,vi} from 'vitest';
import {MetaGraph} from '../../../../supabase/functions/_shared/metaGraph.ts';
import {observePostAvailability,normalizePublicationRemovals} from '../../../../supabase/functions/_shared/metaPostAvailability.ts';
const config={appId:'1',appSecret:'fixture-only',configId:'2',version:'v25.0'};
const graph=(body:any,status=200)=>{const transport=vi.fn(async()=>new Response(JSON.stringify(body),{status}));return {client:new MetaGraph(config,transport),transport};};
it('uses positive owned-feed evidence without another provider call, and never treats omitted posts as deleted',async()=>{
 const g=graph({});const result=await observePostAvailability(g.client,{channel:'facebook'},'fixture-token',[{id:'111_222'}],[{id:'111_222'}],vi.fn());
 expect(result).toEqual([{id:'111_222',state:'available',source:'owned_feed',reason:'provider_observed'}]);expect(g.transport).not.toHaveBeenCalled();
});
it('probes at most one known object without enumerating a second feed or fetching metrics',async()=>{
 const g=graph({id:'111_222',is_published:true}),guard=vi.fn();const result=await observePostAvailability(g.client,{channel:'facebook'},'fixture-token',[],[{id:'111_222'},{id:'111_333'}],guard);
 expect(result[0].state).toBe('available');expect(g.transport).toHaveBeenCalledTimes(1);const [url,request]=g.transport.mock.calls[0];expect(String(url)).toContain('/111_222?');expect(request.method).toBe('GET');expect(String(url)).not.toMatch(/insights|posts/);expect(guard).toHaveBeenCalledTimes(2);
});
it.each([
 [{error:{code:100,error_subcode:33}},400,'unavailable','object_missing_or_unreadable'],
 [{error:{code:10}},403,'access_restricted','permission_or_token'],
 [{error:{code:190}},400,'access_restricted','permission_or_token'],
 [{error:{code:200}},403,'access_restricted','permission_or_token'],
 [{error:{code:4}},429,'temporarily_unavailable','provider_temporary'],
 [{id:'111_222',is_published:false},200,'unavailable','not_public'],
 [{id:'111_999',is_published:true},200,'unavailable','identity_unverified'],
 [{id:'111_222'},200,'unavailable','response_unverified']
])('does not infer deletion from failure or incomplete proof %#',async(body,status,state,reason)=>{
 const g=graph(body,status);const result=await observePostAvailability(g.client,{channel:'facebook'},'fixture-token',[],[{id:'111_222'}],vi.fn());expect(result).toEqual([{id:'111_222',state,source:'object_read',reason}]);expect(JSON.stringify(result)).not.toContain('fixture-token');
});
it('requires exact Instagram media identity and publication URL',async()=>{
 const g=graph({id:'222',permalink:'https://www.instagram.com/reel/fixture/'});expect((await observePostAvailability(g.client,{channel:'instagram'},'fixture-token',[],[{id:'222'}],vi.fn()))[0].state).toBe('available');
});
it('keeps network failures temporary and authority failures outside provider classification',async()=>{
 const transport=vi.fn(async()=>{throw new Error('network');}),g=new MetaGraph(config,transport);
 expect((await observePostAvailability(g,{channel:'facebook'},'fixture-token',[],[{id:'111_222'}],vi.fn()))[0].state).toBe('temporarily_unavailable');
 const denied=vi.fn(async()=>{throw new Error('generation changed');});transport.mockClear();await expect(observePostAvailability(g,{channel:'facebook'},'fixture-token',[],[{id:'111_222'}],denied)).rejects.toThrow('generation changed');expect(transport).not.toHaveBeenCalled();
 const success=graph({id:'111_222',is_published:true});await expect(observePostAvailability(success.client,{channel:'facebook'},'fixture-token',[],[{id:'111_222'}],vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('revoked')))).rejects.toThrow('revoked');
});
const event=(patch:any={})=>({object:'page',entry:[{id:'111',time:Math.floor(Date.now()/1000)-2,changes:[{field:'feed',value:{item:'post',verb:'remove',post_id:'111_222',...patch}}]}]});
it('normalizes only explicit Page-owned post removals, with stable replay identity',async()=>{
 const body=event(),a=await normalizePublicationRemovals(body),b=await normalizePublicationRemovals(body);expect(a).toEqual(b);expect(a[0]).toMatchObject({account_id:'111',id:'111_222',source:'signed_page_feed_remove'});expect(a[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
 body.entry[0].changes.push(body.entry[0].changes[0]);expect(await normalizePublicationRemovals(body)).toHaveLength(1);
});
it.each([{item:'comment'},{verb:'add'},{post_id:'999_222'},{post_id:'222'},{item:'reaction'}])('ignores non-removal or mismatched evidence %j',async patch=>{expect(await normalizePublicationRemovals(event(patch))).toEqual([]);});
it('does not promote Instagram events, API recovery, FAQ suggestions or malformed timestamps into deletion proof',async()=>{
 expect(await normalizePublicationRemovals({...event(),object:'instagram'})).toEqual([]);expect(await normalizePublicationRemovals({object:'page',entry:[{id:'111',messaging:[{message:{is_echo:true,text:'removed'}}]}]})).toEqual([]);
 const body=event();body.entry[0].time=Date.now()+600000;expect(await normalizePublicationRemovals(body)).toEqual([]);
 body.entry[0].time=Date.now()-1000;const result=await normalizePublicationRemovals(body);expect(result[0].occurred_at).toBe(body.entry[0].time/1000);
});
it('requires an exact object check when a feed echo conflicts with signed removal evidence',async()=>{
 const g=graph({error:{code:100,error_subcode:33}},400);const result=await observePostAvailability(g.client,{channel:'facebook'},'fixture-token',[{id:'111_222'}],[{id:'111_222',require_object_read:true}],vi.fn());expect(g.transport).toHaveBeenCalledTimes(1);expect(result).toEqual([{id:'111_222',state:'unavailable',source:'object_read',reason:'object_missing_or_unreadable'}]);
});

it.each([
 ['facebook','622626120924115','622626120924115_122185112336804842','622626120924115_122171025848804842',10,null],
 ['facebook','622626120924115','622626120924115_122185797554804842','622626120924115_122171025848804842',10,null],
 ['facebook','622626120924115','622626120924115_122185805978804842','622626120924115_122171025848804842',10,null],
 ['facebook','622626120924115','622626120924115_122185828154804842','622626120924115_122171025848804842',10,null],
 ['instagram','17841473217923034','17994359174848654','17980316511001412',100,33],
 ['instagram','17841473217923034','18150091540612612','17980316511001412',100,33],
 ['instagram','17841473217923034','18099943967385775','17980316511001412',100,33],
 ['instagram','17841473217923034','18097331618228238','17980316511001412',100,33]
])('replays actual read-only %s case %s/%s with a same-token positive control, never deletion',async(channel,account,target,control,code,subcode)=>{
 const transport=vi.fn(async(url:any)=>new Response(JSON.stringify(String(url).includes('/'+target+'?')?{error:{code,error_subcode:subcode}}:{id:control,is_published:true,permalink:'https://www.instagram.com/p/fixture/'}),{status:String(url).includes('/'+target+'?')?400:200}));
 const client=new MetaGraph(config,transport),result=await observePostAvailability(client,{channel,provider_account_id:account},'fixture-token',[{id:control}],[{id:target},{id:'777'}],vi.fn());
 expect(transport).toHaveBeenCalledTimes(2);expect(result.find(o=>o.id===target)).toMatchObject({calendar_control_id:control,graph_error_code:code,graph_error_subcode:subcode});
 expect(result.find(o=>o.id===control)).toMatchObject({state:'available',source:'object_read',calendar_control_check:true});expect(result.some(o=>(o.state as any)==='deleted')).toBe(false);
 const calls=transport.mock.calls;expect(new URL(String(calls[0][0])).searchParams.get('fields')).toBe(new URL(String(calls[1][0])).searchParams.get('fields'));
});
it.each([190,200,4])('never qualifies account-wide or temporary error %s',async code=>{
 const g=graph({error:{code}},400);const result=await observePostAvailability(g.client,{channel:'facebook',provider_account_id:'111'},'fixture-token',[{id:'111_444'}],[{id:'111_222'}],vi.fn());
 expect(g.transport).toHaveBeenCalledTimes(1);expect(result.find(o=>o.id==='111_222')).toMatchObject({calendar_control_check:true});expect(result.find(o=>o.id==='111_222')?.calendar_control_id).toBeUndefined();
});
it('failed live control blocks the streak and is bounded to two reads',async()=>{
 const g=graph({error:{code:10}},400);const result=await observePostAvailability(g.client,{channel:'facebook',provider_account_id:'111'},'fixture-token',[{id:'111_444'}],[{id:'111_222'}],vi.fn());
 expect(g.transport).toHaveBeenCalledTimes(2);expect(result.find(o=>o.id==='111_444')).toMatchObject({state:'temporarily_unavailable',calendar_control_check:true});
});
it('no live control, another Page control or Story cannot qualify',async()=>{
 for(const posts of [[],[{id:'999_444'}],[{id:'111_444',media_product_type:'STORY'}]]){
  const g=graph({error:{code:10}},400);const result=await observePostAvailability(g.client,{channel:'facebook',provider_account_id:'111'},'fixture-token',posts,[{id:'111_222'}],vi.fn());expect(g.transport).toHaveBeenCalledTimes(1);expect(result.find(o=>o.id==='111_222')?.calendar_control_id).toBeUndefined();
 }
});

it.each([429,500,503])('retryable HTTP %s never qualifies even if Meta reuses object error code 10',async status=>{
 const g=graph({error:{code:10}},status);const result=await observePostAvailability(g.client,{channel:'facebook',provider_account_id:'111'},'fixture-token',[{id:'111_444'}],[{id:'111_222'}],vi.fn());
 expect(g.transport).toHaveBeenCalledTimes(1);expect(result.find(o=>o.id==='111_222')?.calendar_control_id).toBeUndefined();expect(result.find(o=>o.id==='111_222')).toMatchObject({calendar_control_check:true});
});
it('transient Meta object errors cannot qualify on a successful HTTP transport',async()=>{
 const g=graph({error:{code:10,is_transient:true}},400);const result=await observePostAvailability(g.client,{channel:'facebook',provider_account_id:'111'},'fixture-token',[{id:'111_444'}],[{id:'111_222'}],vi.fn());expect(g.transport).toHaveBeenCalledTimes(1);expect(result.find(o=>o.id==='111_222')?.calendar_control_id).toBeUndefined();
});
