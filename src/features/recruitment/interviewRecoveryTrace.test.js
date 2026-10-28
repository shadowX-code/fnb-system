import {beforeEach,expect,it,vi} from 'vitest';
const qa=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('./recruitmentService.js',()=>({recruitmentService:{observeRecovery:qa.send}}));
import {InterviewRecoveryTrace,recoveryRecord} from './InterviewRecoveryTrace.js';
beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();qa.send.mockResolvedValue();});
it('checkpoints are synchronous, survive refresh, and never contain token/transcript/device data',()=>{
 const token='b'.repeat(64),trace=new InterviewRecoveryTrace(token),request_id=crypto.randomUUID();
 trace.append('recovery.command',{stage:'native.capture.call',request_id,code:'dependency_started',transcript:'private words',token,stack:'private stack',tracks:[{kind:'audio',state:'live',muted:false,label:'private device',deviceId:'private id'}]});
 expect(qa.send).not.toHaveBeenCalled();
 const saved=sessionStorage.getItem(trace.key);expect(saved).not.toContain(token);expect(saved).not.toContain('private');expect(trace.key).not.toContain(token);
 const replacement=new InterviewRecoveryTrace(token);expect(replacement.unfinished()).toMatchObject({stage:'native.capture.call',request_id});
 expect(replacement.events).toHaveLength(1);expect(replacement.events[0].record.tracks[0]).toEqual({kind:'audio',state:'live',muted:false});
});
it('failed observation delivery remains queued and refresh reuses the original idempotency keys',async()=>{
 const token='c'.repeat(64),trace=new InterviewRecoveryTrace(token);trace.append('recovery.bootstrap',{stage:'page.bootstrap'});const key=trace.events[0].key;
 qa.send.mockRejectedValueOnce(Error('offline'));trace.clientId='client';await trace.flush();expect(trace.events[0].sent).toBe(false);
 const replacement=new InterviewRecoveryTrace(token);replacement.clientId='same-client';await replacement.flush();
 expect(qa.send.mock.calls.at(-1).slice(0,3)).toEqual([token,'same-client',key]);expect(replacement.events[0].sent).toBe(true);
});
it('successful and retryable terminal transitions close pending transaction diagnostics',()=>{
 const trace=new InterviewRecoveryTrace('d'.repeat(64)),request_id=crypto.randomUUID();
 trace.append('recovery.command',{stage:'provider.authorization',code:'dependency_started',request_id});
 trace.append('recovery.transition',{state:'RECOVERY_REQUIRED',request_id});expect(trace.unfinished()).toBeUndefined();
 trace.append('recovery.command',{stage:'remote.playback',code:'dependency_started',request_id:crypto.randomUUID()});expect(trace.unfinished().stage).toBe('remote.playback');
});
it('bounded storage and unsupported storage cannot block native recovery ownership',()=>{
 const trace=new InterviewRecoveryTrace('e'.repeat(64));for(let i=0;i<180;i++)trace.append('recovery.visibility',{stage:'foreground'});
 expect(trace.events).toHaveLength(160);expect(JSON.parse(sessionStorage.getItem(trace.key))).toHaveLength(160);
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('disabled');});
 expect(()=>trace.append('recovery.command',{stage:'continue.tap'})).not.toThrow();vi.restoreAllMocks();
 expect(recoveryRecord({type:'unknown',token:'secret'})).toBeNull();
});
it('late journal writes from a disposed page cannot overwrite a new page recovery checkpoint',()=>{
 const old=new InterviewRecoveryTrace('f'.repeat(64)),first=crypto.randomUUID(),second=crypto.randomUUID();
 old.append('recovery.command',{stage:'continue.tap',request_id:first});
 const fresh=new InterviewRecoveryTrace('f'.repeat(64));fresh.append('recovery.command',{stage:'continue.tap',request_id:second});fresh.append('recovery.command',{stage:'remote.playback',request_id:second,code:'dependency_started'});
 old.append('recovery.error',{stage:'old.cleanup',code:'cleanup_failed',request_id:first});
 const restored=new InterviewRecoveryTrace('f'.repeat(64));expect(restored.events.some(e=>e.record.stage==='remote.playback')).toBe(true);
 expect(restored.latestRequest()).toBe(second);expect(restored.unfinished()).toMatchObject({request_id:second});
});
it('a completed replacement cannot be mistaken for an older abandoned recovery after refresh',()=>{
 const trace=new InterviewRecoveryTrace('g'.repeat(64)),first=crypto.randomUUID(),second=crypto.randomUUID();
 trace.append('recovery.command',{stage:'continue.tap',request_id:first});trace.append('recovery.command',{stage:'provider.authorization',code:'dependency_started',request_id:first});
 trace.append('recovery.command',{stage:'continue.tap',request_id:second});trace.append('recovery.transition',{state:'RESUMED',request_id:second});
 expect(trace.unfinished()).toBeUndefined();
});
