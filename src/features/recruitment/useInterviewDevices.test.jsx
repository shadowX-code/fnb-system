import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useInterviewDevices} from './useInterviewDevices.js';
let acquire;
const track=kind=>({kind,readyState:'live',muted:false,stop:vi.fn(),getSettings:()=>({})});
const stream=()=>{const tracks=[track('audio'),track('video')];return {getTracks:()=>tracks,getVideoTracks:()=>tracks.filter(t=>t.kind==='video'),getAudioTracks:()=>tracks.filter(t=>t.kind==='audio')};};
beforeEach(()=>{acquire=vi.fn();vi.stubGlobal('cancelAnimationFrame',vi.fn());Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:acquire}});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('fresh native recovery capture retains echo protection synchronously',async()=>{
 const fresh=stream();acquire.mockResolvedValue(fresh);const {result}=renderHook(()=>useInterviewDevices());let request;
 act(()=>{request=result.current.start({meter:false});expect(acquire).toHaveBeenCalledWith({video:{facingMode:'user'},audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});});
 await act(async()=>expect(await request).toBe(fresh));
});
it('propagates native denial distinctly, with actual evidence',async()=>{
 acquire.mockRejectedValue(Object.assign(Error('denied'),{name:'NotAllowedError'}));const {result}=renderHook(()=>useInterviewDevices());
 await act(async()=>expect(result.current.start({meter:false})).rejects.toMatchObject({code:'NotAllowedError',message:expect.stringMatching(/access was denied/)}));
});
it('native hardware failure is not permission denial',async()=>{
 acquire.mockRejectedValue(new DOMException('busy','NotReadableError'));const {result}=renderHook(()=>useInterviewDevices());
 await act(async()=>expect(result.current.start({meter:false})).rejects.toMatchObject({code:'NotReadableError',message:expect.stringMatching(/device is unavailable/)}));
});
it('hung acquisition preserves timeout code and late old tracks cannot replace retry',async()=>{
 vi.useFakeTimers();let resolveOld;acquire.mockImplementationOnce(()=>new Promise(resolve=>resolveOld=resolve));const fresh=stream();acquire.mockResolvedValueOnce(fresh);
 const {result}=renderHook(()=>useInterviewDevices());let request;
 act(()=>{request=result.current.start({meter:false});request.catch(()=>{});});
 await act(async()=>vi.advanceTimersByTimeAsync(15100));await expect(request).rejects.toMatchObject({code:'recovery_timeout'});
 await act(async()=>expect(await result.current.start({meter:false})).toBe(fresh));
 const old=stream();await act(async()=>resolveOld(old));old.getTracks().forEach(t=>expect(t.stop).toHaveBeenCalled());
 expect(result.current.streamRef.current).toBe(fresh);fresh.getTracks().forEach(t=>expect(t.stop).not.toHaveBeenCalled());
});
it('cancelling an obsolete acquisition cannot stop newer tracks',async()=>{
 const oldController=new AbortController();let resolveOld;acquire.mockImplementationOnce(()=>new Promise(resolve=>resolveOld=resolve));const fresh=stream();acquire.mockResolvedValueOnce(fresh);
 const {result}=renderHook(()=>useInterviewDevices());let request;act(()=>{request=result.current.start({meter:false,signal:oldController.signal});request.catch(()=>{});});
 await act(async()=>result.current.start({meter:false}));await act(async()=>oldController.abort());
 await expect(request).rejects.toMatchObject({code:'recovery_cancelled'});await act(async()=>resolveOld(stream()));
 expect(result.current.streamRef.current).toBe(fresh);fresh.getTracks().forEach(t=>expect(t.stop).not.toHaveBeenCalled());
});
it('the preparation microphone meter activates native audio in the same Check gesture',async()=>{
 const fresh=stream();acquire.mockResolvedValue(fresh);const resume=vi.fn().mockResolvedValue();
 vi.stubGlobal('requestAnimationFrame',vi.fn());
 vi.stubGlobal('AudioContext',class {resume(){return resume();}close(){return Promise.resolve();}createMediaStreamSource(){return {connect:vi.fn()};}createAnalyser(){return {getByteTimeDomainData:a=>a.fill(128)};}});
 const {result}=renderHook(()=>useInterviewDevices());let request;
 act(()=>{request=result.current.start();expect(acquire).toHaveBeenCalledOnce();expect(resume).toHaveBeenCalledOnce();});
 await act(async()=>request);expect(result.current.state.status).toBe('ready');
});
