import {afterEach,expect,it,vi} from 'vitest';
const {instances,coverage}=vi.hoisted(()=>({instances:[],coverage:vi.fn()}));
vi.mock('./RecruitmentRealtimeSession.js',()=>({RecruitmentRealtimeSession:class{
 constructor(options){Object.assign(this,options);instances.push(this);}
 connect(){return Promise.resolve();} flush(){return Promise.resolve();}
 refreshContext(){return Promise.resolve();} close(){this.closed=true;}
}}));
vi.mock('./recruitmentService.js',()=>({recruitmentService:{evidence:coverage}}));
import {InterviewTransportGeneration} from './InterviewTransportGeneration.js';
afterEach(()=>{instances.splice(0).forEach(t=>t.close());vi.useRealTimers();vi.clearAllMocks();});
const connect=m=>m.connectInterviewer({onStatus:vi.fn(),onRemote:vi.fn(),onRecovery:vi.fn(),onCompletion:vi.fn()});
it('continuous candidate turns cannot extend the server coverage cache indefinitely',async()=>{
 vi.useFakeTimers();coverage.mockResolvedValue({can_finish:false});const m=new InterviewTransportGeneration();await connect(m);
 await m.assess();await vi.advanceTimersByTimeAsync(6000);await m.assess();expect(coverage).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(5000);await m.assess();expect(coverage).toHaveBeenCalledTimes(2);m.cancel();
});
it('late old coverage cannot clear or overwrite a replacement generation assessment',async()=>{
 let oldResolve,newResolve;coverage.mockImplementationOnce(()=>new Promise(r=>oldResolve=r)).mockImplementationOnce(()=>new Promise(r=>newResolve=r));
 const m=new InterviewTransportGeneration();await connect(m);const old=m.assess();await Promise.resolve();await Promise.resolve();
 await connect(m);const fresh=m.assess();await Promise.resolve();await Promise.resolve();oldResolve({can_finish:true});await old;
 expect(m.assessment).not.toBeNull();expect(m.lastAssessment).toBeNull();newResolve({can_finish:false});await fresh;expect(m.lastAssessment.can_finish).toBe(false);m.cancel();
});
