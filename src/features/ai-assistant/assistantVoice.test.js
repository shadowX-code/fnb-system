import {it,expect,vi,afterEach} from 'vitest';
vi.mock('./nativeAssistantService.js',()=>({assistantCall:vi.fn()}));
import {createAssistantVoice} from './assistantVoice.js';
afterEach(()=>vi.unstubAllGlobals());
it('cancels delayed TTS without creating or playing stale audio (fixture)',async()=>{
 vi.stubGlobal('cancelAnimationFrame',vi.fn());let finish;const call=vi.fn(()=>new Promise(r=>{finish=r;})),Audio=vi.fn();vi.stubGlobal('Audio',Audio);
 const post=vi.fn(),v=createAssistantVoice({getSession:()=> 'session',post,call});v.setAvailable({tts:true});v.setOutput(true);const pending=v.speak('session','turn');v.stop();finish({audio:btoa('fixture'),mime:'audio/wav'});await pending;expect(Audio).not.toHaveBeenCalled();expect(post.mock.calls.some(x=>x[1].state==='speaking')).toBe(false);v.destroy();
});
it('unavailable STT does not open a microphone; pending permission is fenced on stop (fixture)',async()=>{
 vi.stubGlobal('cancelAnimationFrame',vi.fn());let acquired;const stopped=vi.fn(),media={getUserMedia:vi.fn(()=>new Promise(r=>acquired=r))};vi.stubGlobal('AudioContext',class{resume(){return Promise.resolve();}close(){return Promise.resolve();}});
 const v=createAssistantVoice({getSession:()=> 'session',post:vi.fn(),media});await v.start();expect(media.getUserMedia).not.toHaveBeenCalled();v.setAvailable({stt:true});const pending=v.start();v.stop();acquired({getTracks:()=>[{stop:stopped}]});await pending;expect(stopped).toHaveBeenCalledOnce();v.destroy();
});
