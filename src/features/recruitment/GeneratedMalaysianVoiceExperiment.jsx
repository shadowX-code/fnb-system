import {useEffect,useRef,useState} from 'react';
import {supabase} from '../../lib/supabase.ts';
import {RecruitmentSection} from './RecruitmentPresentation.jsx';
export default function GeneratedMalaysianVoiceExperiment(){
 const operation=useRef(0);
 const [state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function check(action,signal){const id=++operation.current;setBusy(true);setError('');try{
 const {data,error:failure}=await supabase.functions.invoke('recruitment-generated-voice-lab',{body:{action},signal});
 if(failure){const detail=await failure.context?.json?.().catch(()=>null);throw Error(detail?.error||'Capability check unavailable.');}
 if(operation.current===id)setState(data);
 }catch(e){if(operation.current===id)setError(signal.aborted?'Check timed out. Reload to read the saved result; voice creation is never automatically retried.':e.message);}finally{if(operation.current===id)setBusy(false);}}
 useEffect(()=>{const controller=new AbortController();check('status',AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));return()=>{operation.current++;controller.abort();};},[]);
 return <RecruitmentSection title="Generated Malaysian Voice Experiment"><div className="p-4 grid gap-3">
 <p className="text-sm text-text-secondary">Isolated Staging feasibility check. Prompt-created voices require GPT-Live; the interview and existing Realtime comparisons remain unchanged.</p>
 {state?.status==='blocked'&&<p role="status">Project access blocked: {state.message} (HTTP {state.provider_status}{state.provider_code?`, ${state.provider_code}`:''}). No voice samples generated.</p>}
 {state?.status==='checking'&&<p role="status">{state.message}</p>}
 {state?.status==='available'&&<p role="status">Prompt-created voice available: {state.voice?.name}. Multilingual samples pending isolated harness verification.</p>}
 {error&&<p role="alert">{error}</p>}
 {(!state||state.status==='not_checked')&&<button className="btn-secondary justify-self-start" disabled={busy} onClick={()=>check('probe',AbortSignal.timeout(80000))}>{busy?'Checking…':'Check project access'}</button>}
 </div></RecruitmentSection>;
}
