import {expect,it,vi} from 'vitest';
vi.mock('./nativeAssistantService.js',()=>({assistantCall:vi.fn()}));
import {createAssistantBridge,validAssistantMessage} from './useAssistantBridge.js';
const sid='10000000-0000-4000-8000-000000000001',rid='10000000-0000-4000-8000-000000000002',tid='10000000-0000-4000-8000-000000000003';
function fixture(overrides={}){const source={postMessage:vi.fn()};const call=vi.fn(async a=>({status:{runtime:{ready:true,model:'gpt-4o-mini'}},session_list:{sessions:[{id:sid,title:'Fixture'}]},history:{turns:[]},begin:{turn_id:tid,state:'pending'},respond:{state:'completed',reply:'Fixture answer'},cancel:{state:'cancelled'}}[a]));if(overrides.call)call.mockImplementation(overrides.call);const b=createAssistantBridge({getWindow:()=>source,userId:'one',call,storage:{getItem:()=>overrides.saved===undefined?sid:overrides.saved,setItem:vi.fn()}});const send=(action,extra={})=>b.receive({source,origin:'null',data:{protocol:'feedx.assistant.text.v1',action,request_id:rid,...extra}});const posts=()=>source.postMessage.mock.calls.map(x=>x[0]);return {b,source,call,send,posts};}
it('rejects origin/source spoofing and privileged messages',()=>{const source={};const event={source,origin:'null',data:{protocol:'feedx.assistant.text.v1',action:'ready'}};expect(validAssistantMessage(event,source)).toBe(true);expect(validAssistantMessage({...event,origin:'https://evil.example'},source)).toBe(false);expect(validAssistantMessage(event,{})).toBe(false);expect(validAssistantMessage({...event,data:{...event.data,actor:'x'}},source)).toBe(false);expect(validAssistantMessage({...event,data:{...event.data,action:'configure'}},source)).toBe(false);});
it('forwards only text results and thinks after server acceptance (fixture)',async()=>{const f=fixture();await f.send('ready');await f.send('send',{session_id:sid,text:'hello'});await vi.waitFor(()=>expect(f.posts().some(x=>x.type==='result')).toBe(true));expect(f.posts().find(x=>x.type==='state').state).toBe('thinking');expect(f.call.mock.calls.find(x=>x[0]==='begin')[1]).toEqual({session_id:sid,request_id:rid,text:'hello'});expect(JSON.stringify(f.posts())).not.toMatch(/access_token|Authorization|credential|lease_id/);f.b.destroy();});
it('cancels a late begin and isolates its reply (fixture)',async()=>{let accept;const f=fixture();const base=f.call.getMockImplementation();f.call.mockImplementation((a,...args)=>a==='begin'?new Promise(r=>{accept=r;}):base(a,...args));await f.send('ready');await f.send('send',{session_id:sid,text:'late'});await f.send('cancel');accept({turn_id:tid,state:'pending'});await vi.waitFor(()=>expect(f.call.mock.calls.some(x=>x[0]==='cancel')).toBe(true));expect(f.call.mock.calls.some(x=>x[0]==='respond')).toBe(false);expect(f.posts().some(x=>x.type==='result')).toBe(false);f.b.destroy();});
it('unconfigured begin produces a genuine error without Thinking or Speaking (fixture)',async()=>{const f=fixture();const base=f.call.getMockImplementation();f.call.mockImplementation((a,...args)=>a==='begin'?Promise.reject(Object.assign(new Error('Provider not authorized'),{code:'provider_not_authorized'})):base(a,...args));await f.send('ready');await f.send('send',{session_id:sid,text:'hello'});await vi.waitFor(()=>expect(f.posts().some(x=>x.type==='error')).toBe(true));expect(f.posts().some(x=>x.type==='state')).toBe(false);f.b.destroy();});
it('recover pending history with one claimed response and fence destroyed identity (fixture)',async()=>{const f=fixture();const base=f.call.getMockImplementation();let resolve;f.call.mockImplementation((a,...args)=>a==='history'?Promise.resolve({turns:[{id:tid,request_id:rid,state:'pending'}]}):a==='respond'?new Promise(r=>{resolve=r;}):base(a,...args));await f.send('ready');await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));f.b.destroy();resolve({state:'completed',reply:'Must not leak'});await Promise.resolve();expect(f.posts().some(x=>x.reply==='Must not leak')).toBe(false);});

it('restores a saved voice conversation without allocating a new one when tab storage is empty',async()=>{
 const f=fixture({saved:null});
 const base=f.call.getMockImplementation();
 const turns=[{id:tid,request_id:rid,state:'completed',prompt:'Stock?',reply:'Stock checked.',voice:true,evidence:{capability:'read_factory_finished_goods'}}];
 f.call.mockImplementation((action,args)=>{
  if(action==='status')return Promise.reject(new Error('Readiness temporarily unavailable'));
  if(action==='session_list')return Promise.resolve({sessions:[{id:tid,title:'New conversation'},{id:sid,title:'Stock?'}]});
  if(action==='history'){expect(args).toEqual({session_id:sid});return Promise.resolve({turns});}
  return base(action,args);
 });
 await f.send('ready');
 expect(f.call.mock.calls.some(([action])=>action==='session_new')).toBe(false);
 expect(f.posts().find(x=>x.type==='history')).toMatchObject({session_id:sid,turns});
});

it('does not create an empty startup thread and blocks navigation while voice is active',async()=>{
 const source={postMessage:vi.fn()},call=vi.fn(async action=>action==='session_list'?{sessions:[]}:{runtime:{}});
 let voiceActive=false;
 const bridge=createAssistantBridge({getWindow:()=>source,userId:'one',call,storage:{getItem:()=>null},voice:{isActive:()=>voiceActive}});
 await bridge.receive({source,origin:'null',data:{protocol:'feedx.assistant.text.v1',action:'ready'}});
 expect(call.mock.calls.some(([a])=>a==='session_new')).toBe(false);
 voiceActive=true;
 await expect(bridge.transition('history',sid)).rejects.toThrow('End voice');
 await expect(bridge.transition('new')).rejects.toThrow('End voice');
 await expect(bridge.transition('delete',sid)).rejects.toThrow('End voice');
 expect(call.mock.calls.map(([a])=>a)).toEqual(['status','session_list']);
 bridge.destroy();
});

it('pages older turns using the server-owned cursor without changing threads',async()=>{
 const f=fixture();
 const base=f.call.getMockImplementation();
 f.call.mockImplementation((action,args)=>action==='history'?Promise.resolve(args.before_seq?
  {turns:[{seq:20}],has_more:false}:{title:'First page',turns:[{seq:21}],has_more:true}):base(action,args));
 await f.send('ready');await f.send('older');
 expect(f.call.mock.calls).toContainEqual(['history',{session_id:sid,before_seq:21}]);
 expect(f.posts().find(x=>x.type==='older')).toMatchObject({session_id:sid,has_more:false,turns:[{seq:20}]});
 expect(f.b.getSession()).toBe(sid);
 f.b.destroy();
});

it('New stays local and allocates exactly once on the first message',async()=>{
 const f=fixture();const base=f.call.getMockImplementation();
 f.call.mockImplementation((action,...args)=>action==='session_new'?Promise.resolve({session_id:sid}):base(action,...args));
 await f.send('ready');await f.b.transition('new');await f.b.transition('new');
 expect(f.b.getSession()).toBeNull();expect(f.call.mock.calls.filter(([a])=>a==='session_new')).toHaveLength(0);
 await f.send('send',{session_id:null,text:'A real first question'});
 await vi.waitFor(()=>expect(f.posts().some(x=>x.type==='result')).toBe(true));
 expect(f.call.mock.calls.filter(([a])=>a==='session_new')).toHaveLength(1);
 f.b.destroy();
});
