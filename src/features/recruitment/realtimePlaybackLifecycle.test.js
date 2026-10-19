import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const qa=vi.hoisted(()=>({secret:vi.fn(),connected:vi.fn(),trace:vi.fn(),disconnected:vi.fn()}));
vi.mock('./recruitmentService.js',()=>({recruitmentService:{realtimeSecret:qa.secret,providerConnected:qa.connected,providerDisconnected:qa.disconnected,trace:qa.trace}}));
vi.mock('./interviewTranscriptQueue.js',()=>({interviewTranscriptQueue:{put:vi.fn(),list:vi.fn().mockResolvedValue([]),remove:vi.fn()}}));
import {RecruitmentRealtimeSession} from './RecruitmentRealtimeSession.js';
let peers=[];let sessions=[];
beforeEach(()=>{
 vi.clearAllMocks();qa.secret.mockResolvedValue({generation:1,conversation_protocol:'continuity-v2',conversation_instructions:'[FEEDX ORIENTATION]opening[/FEEDX ORIENTATION]',first_response_instructions:'opening'});qa.connected.mockResolvedValue();qa.disconnected.mockResolvedValue();
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,text:async()=> 'sdp'}));
 vi.stubGlobal('RTCPeerConnection',class{
  constructor(){peers.push(this);}addTrack(){} createDataChannel(){return {readyState:'open',send:vi.fn(),close:vi.fn()};}
  createOffer(){return Promise.resolve({sdp:'offer'});}setLocalDescription(){return Promise.resolve();}
  setRemoteDescription(){this.ontrack({streams:[{}]});return Promise.resolve();}close(){}
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
