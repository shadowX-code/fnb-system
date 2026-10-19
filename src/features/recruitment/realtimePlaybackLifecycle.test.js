import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const qa=vi.hoisted(()=>({secret:vi.fn(),connected:vi.fn(),trace:vi.fn(),disconnected:vi.fn()}));
vi.mock('./recruitmentService.js',()=>({recruitmentService:{realtimeSecret:qa.secret,providerConnected:qa.connected,providerDisconnected:qa.disconnected,trace:qa.trace}}));
vi.mock('./interviewTranscriptQueue.js',()=>({interviewTranscriptQueue:{put:vi.fn(),list:vi.fn().mockResolvedValue([]),remove:vi.fn()}}));
import {RecruitmentRealtimeSession} from './RecruitmentRealtimeSession.js';
let peers=[];let sessions=[];let initialPeerState;
beforeEach(()=>{
 initialPeerState="connected";vi.clearAllMocks();qa.secret.mockResolvedValue({generation:1,conversation_protocol:'continuity-v2',conversation_instructions:'[FEEDX ORIENTATION]opening[/FEEDX ORIENTATION]',first_response_instructions:'opening'});qa.connected.mockResolvedValue();qa.disconnected.mockResolvedValue();
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,text:async()=> 'sdp'}));
 vi.stubGlobal('RTCPeerConnection',class{
  constructor(){peers.push(this);this.connectionState=initialPeerState;this.remote=Object.assign(new EventTarget(),{kind:'audio',readyState:'live',muted:false});}addTrack(){} createDataChannel(){return {readyState:'open',send:vi.fn(),close:vi.fn()};}
  createOffer(){return Promise.resolve({sdp:'offer'});}setLocalDescription(){return Promise.resolve();}
  setRemoteDescription(){this.ontrack({track:this.remote,streams:[{}]});return Promise.resolve();}close(){}
 });
});
afterEach(()=>{sessions.forEach(s=>s.close());sessions=[];peers=[];vi.unstubAllGlobals();});
function setup(play=vi.fn().mockResolvedValue()){
 const listeners={};const audio={play,pause:vi.fn(),paused:false,readyState:4,addEventListener:(t,f)=>listeners[t]=f,removeEventListener:vi.fn()};const status=vi.fn();
 const s=new RecruitmentRealtimeSession({token:'a'.repeat(64),clientId:'client',recoveryId:'recovery',mediaStream:{getAudioTracks:()=>[{readyState:'live',getSettings:()=>({echoCancellation:true})}]},audioElement:audio,startedAt:new Date().toISOString(),onStatus:status});
 s.attemptKey='fixture';sessions.push(s);return {s,audio,status,listeners};
}
it('no entry or connected acknowledgement exists until native remote playback is ready',async()=>{
 let ready;const q=setup(vi.fn().mockImplementation(()=>new Promise(r=>ready=r)));const pending=q.s.connect();
 await vi.waitFor(()=>expect(ready).toBeTypeOf('function'));
 expect(qa.connected).not.toHaveBeenCalled();expect(q.s.channel.send).not.toHaveBeenCalled();
 ready();await pending;expect(qa.connected).toHaveBeenCalledOnce();
 expect(q.s.channel.send.mock.calls.filter(([raw])=>JSON.parse(raw).type==='response.create')).toHaveLength(1);
});
it('late rejected playback from a disposed generation cannot trigger recovery on its replacement',async()=>{
 let reject;const q=setup(vi.fn().mockImplementation(()=>new Promise((_,r)=>reject=r)));const pending=q.s.connect();pending.catch(()=>{});
 await vi.waitFor(()=>expect(reject).toBeTypeOf('function'));q.s.close();reject(Error('late blocked'));
 await expect(pending).rejects.toThrow();expect(q.status).not.toHaveBeenCalledWith('audio-blocked');
});
it('queued pause from an older source does not interrupt a currently playing source; actual pause does',async()=>{
 const q=setup();await q.s.connect();q.s.audioPlaying=true;
 q.listeners.pause();expect(q.status).not.toHaveBeenCalledWith('disconnected');
 q.audio.paused=true;q.listeners.pause();expect(q.status).toHaveBeenCalledWith('disconnected');
});

it('a dead remote audio track cannot be acknowledged as connected or create entry speech',async()=>{
 let ready;const q=setup(vi.fn().mockImplementation(()=>new Promise(r=>ready=r)));const pending=q.s.connect();
 await vi.waitFor(()=>expect(ready).toBeTypeOf('function'));
 peers[0].remote.readyState='ended';ready();
 await expect(pending).rejects.toThrow(/audio|track/i);
 expect(qa.connected).not.toHaveBeenCalled();expect(q.s.channel.send).not.toHaveBeenCalled();
});
it('remote audio ending after connection enters the one recovery surface even between responses',async()=>{
 const q=setup();await q.s.connect();q.s.audioPlaying=false;
 peers[0].remote.readyState='ended';peers[0].remote.dispatchEvent(new Event('ended'));
 expect(q.status).toHaveBeenCalledWith('disconnected');
});

it('an open data channel alone cannot declare connected while the peer is still connecting',async()=>{
 initialPeerState='connecting';let ready;const q=setup(vi.fn().mockImplementation(()=>new Promise(r=>ready=r)));const pending=q.s.connect();
 await vi.waitFor(()=>expect(ready).toBeTypeOf('function'));
 ready();await Promise.resolve();await Promise.resolve();
 expect(qa.connected).not.toHaveBeenCalled();expect(q.s.channel.send).not.toHaveBeenCalled();
 peers[0].connectionState='connected';peers[0].onconnectionstatechange();await pending;
 expect(qa.connected).toHaveBeenCalledOnce();
});
it('a hung peer exposes bounded recovery and a late old track cannot affect a new owner',async()=>{
 vi.useFakeTimers();initialPeerState='connecting';let ready;const q=setup(vi.fn().mockImplementation(()=>new Promise(r=>ready=r)));const pending=q.s.connect();pending.catch(()=>{});
 await vi.advanceTimersByTimeAsync(0);ready();
 await vi.advanceTimersByTimeAsync(8100);await expect(pending).rejects.toThrow(/timed out/);
 q.s.close();q.status.mockClear();peers[0].remote.dispatchEvent(new Event('ended'));
 expect(q.status).not.toHaveBeenCalled();vi.useRealTimers();
});

it('a synchronous WebKit playback exception rejects setup instead of escaping the track callback',async()=>{
 const q=setup(vi.fn().mockImplementation(()=>{throw new DOMException('blocked','NotAllowedError');}));
 await expect(q.s.connect()).rejects.toMatchObject({name:'NotAllowedError'});
 expect(qa.connected).not.toHaveBeenCalled();
});
it('track loss during the server connected acknowledgement cannot publish a false connected screen',async()=>{
 let acknowledge;qa.connected.mockImplementationOnce(()=>new Promise(r=>acknowledge=r));
 const q=setup();const pending=q.s.connect();pending.catch(()=>{});
 await vi.waitFor(()=>expect(acknowledge).toBeTypeOf('function'));
 peers[0].remote.readyState='ended';peers[0].remote.dispatchEvent(new Event('ended'));acknowledge();
 await expect(pending).rejects.toThrow();expect(q.status).not.toHaveBeenCalledWith('connected');
 expect(q.s.channel.send).not.toHaveBeenCalled();
});
