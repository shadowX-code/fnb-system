import {afterEach,expect,it,vi} from 'vitest';
import {activateInterviewPlayback,interviewPlaybackOwner} from './InterviewPlayback.js';
afterEach(()=>vi.restoreAllMocks());
function context(){return {createMediaStreamDestination:()=>({stream:{getTracks:()=>[]}}),createConstantSource:()=>({offset:{value:1},connect:vi.fn(),start:vi.fn(),stop:vi.fn(),disconnect:vi.fn()})};}
it('native HTML audio starts synchronously from the gesture and an old owner cannot stop replacement playback',async()=>{
 const element={play:vi.fn().mockResolvedValue(),pause:vi.fn()};
 const old=activateInterviewPlayback(element,context());expect(element.play).toHaveBeenCalledOnce();
 const fresh=activateInterviewPlayback(element,context());const count=element.pause.mock.calls.length;
 old.dispose();expect(element.pause).toHaveBeenCalledTimes(count);expect(interviewPlaybackOwner(element)).toBe(fresh);
 await fresh.ready;fresh.dispose();expect(element.srcObject).toBeNull();
});
it('native playback rejection remains an actionable rejected dependency rather than a silent unlock',async()=>{
 const element={play:vi.fn().mockRejectedValue(new DOMException('denied','NotAllowedError')),pause:vi.fn()};
 const owner=activateInterviewPlayback(element,context());await expect(owner.ready).rejects.toMatchObject({name:'NotAllowedError'});owner.dispose();
});
