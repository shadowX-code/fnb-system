import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const sdk=vi.hoisted(()=>({sessions:[],transports:[]}));
vi.mock('@openai/agents-realtime',()=>{
 class Events{listeners={};on(name,cb){(this.listeners[name]??=[]).push(cb);}emit(name,event){this.listeners[name]?.forEach(f=>f(event));}}
 class Transport extends Events{constructor(){super();this.track={kind:'audio',readyState:'live',muted:false,stop:vi.fn()};this.peer={connectionState:'connected',getSenders:()=>[{track:this.track}],getReceivers:()=>[],addEventListener:vi.fn(),removeEventListener:vi.fn()};this.connectionState={peerConnection:this.peer,dataChannel:{readyState:'open'}};sdk.transports.push(this);}}
 class Session extends Events{constructor(agent,options){super();this.transport=options.transport;sdk.sessions.push(this);}async connect(){this.transport.emit('connection_change','connected');}close(){this.transport.track.stop();this.transport.track.readyState='ended';this.transport.emit('connection_change','disconnected');}}
 return{RealtimeAgent:class{},RealtimeSession:Session,OpenAIRealtimeWebRTC:Transport,tool:x=>x,backgroundResult:x=>x};
});
import {createSdkVoiceBaseline} from './sdkVoiceBaseline.js';
beforeEach(()=>{sdk.sessions.length=sdk.transports.length=0;vi.useFakeTimers();vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function fixture(){
 let hidden=false;
 vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
 const call=vi.fn(async action=>action==='realtime_sdk_connect'?{model:'gpt-realtime-2.1-mini',client_secret:'fixture',webrtc_url:'https://fixture',maximum_seconds:180,tools:[]}:action==='realtime_heartbeat'?{state:'active',expires_at:new Date(Date.now()+180000).toISOString()}:{state:'closed'});
 const onChange=vi.fn(),post=vi.fn();const voice=createSdkVoiceBaseline({call,getSession:()=> 'owned-session',onChange,post});
 return {voice,call,onChange,post,hide:value=>{hidden=value;}};
}
it('tab away/return during listening and speaking retains one SDK connection and lease',async()=>{
 const f=fixture();await f.voice.start('openai','cedar');await f.voice.reconcile();
 for(const speaking of [false,true]){
  if(speaking)sdk.sessions[0].emit('audio_start');f.hide(true);await f.voice.reconcile();
  expect(f.call.mock.calls.filter(([a])=>a==='realtime_end')).toHaveLength(0);
  f.hide(false);await f.voice.reconcile();expect(f.onChange.mock.lastCall[0].state).toBe(speaking?'speaking':'listening');
 }
 expect(sdk.sessions).toHaveLength(1);expect(f.call.mock.calls.filter(([a])=>a==='realtime_sdk_connect')).toHaveLength(1);
 await f.voice.stop();await f.voice.stop();expect(f.call.mock.calls.filter(([a])=>a==='realtime_end')).toHaveLength(1);expect(f.call.mock.calls.filter(([a])=>a==='voice_usage_report')).toHaveLength(1);expect(sdk.transports[0].track.stop).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('a failed peer releases state and can restart without refresh; return does not auto-create a call',async()=>{
 const f=fixture();await f.voice.start('openai','cedar');await f.voice.reconcile();sdk.transports[0].peer.connectionState='failed';await f.voice.reconcile();
 expect(f.onChange.mock.lastCall[0]).toMatchObject({state:'error',active:false});expect(sdk.transports[0].track.stop).toHaveBeenCalledTimes(1);
 await f.voice.reconcile();expect(sdk.sessions).toHaveLength(1);await f.voice.start('openai','cedar');expect(sdk.sessions).toHaveLength(2);await f.voice.stop();
});
it('server-confirmed expiry closes once and permits a clean new user-initiated session',async()=>{
 const f=fixture();await f.voice.start('openai','cedar');await f.voice.reconcile();const base=f.call.getMockImplementation();let expired=true;
 f.call.mockImplementation((action,...args)=>action==='realtime_heartbeat'&&expired?Promise.reject(Object.assign(Error('expired'),{code:'voice_session_expired'})):base(action,...args));
 await f.voice.reconcile();expect(f.onChange.mock.lastCall[0].state).toBe('error');expect(f.call.mock.calls.filter(([a])=>a==='realtime_end')).toHaveLength(1);expired=false;await f.voice.start('openai','cedar');expect(sdk.sessions).toHaveLength(2);await f.voice.stop();
});
it('a transient lease-network error does not intentionally close a healthy peer',async()=>{
 const f=fixture();await f.voice.start('openai','cedar');await f.voice.reconcile();const base=f.call.getMockImplementation();let offline=true;
 f.call.mockImplementation((action,...args)=>action==='realtime_heartbeat'&&offline?Promise.reject(Error('network')):base(action,...args));
 await f.voice.reconcile();expect(f.onChange.mock.lastCall[0].state).toBe('reconnecting');expect(f.call.mock.calls.some(([a])=>a==='realtime_end')).toBe(false);offline=false;await f.voice.reconcile();expect(f.onChange.mock.lastCall[0].state).toBe('listening');await f.voice.stop();
});
