import { bounded } from "./interviewRecovery.js";
import { recruitmentService } from "./recruitmentService.js";

// Local journal partition only, never an authorization key. No invitation token
// or candidate data is stored in the journal or sent as diagnostic content.
function journalKey(token) {
  let a=2166136261,b=0x9e3779b9;
  for(const char of token){a=Math.imul(a^char.charCodeAt(0),16777619);b=Math.imul(b^char.charCodeAt(0),16777619);}
  return `feedx-interview-recovery:${(a>>>0).toString(16)}${(b>>>0).toString(16)}`;
}
const types=new Set(['recovery.transition','recovery.error','recovery.bootstrap','recovery.visibility','recovery.media','recovery.command']);
export function recoveryRecord(input) {
  if(!types.has(input.type))return null;
  const record={type:input.type,at:Number.isFinite(input.at)?input.at:Date.now(),hidden:!!input.hidden};
  for(const key of ['state','stage','code','audio_state'])if(typeof input[key]==='string'&&/^[\w .:-]*$/.test(input[key]))record[key]=input[key].slice(0,100);
  if(typeof input.request_id==='string'&&/^[a-f0-9-]{36}$/.test(input.request_id))record.request_id=input.request_id;
  if(Array.isArray(input.tracks))record.tracks=input.tracks.slice(0,4).map(t=>({kind:t.kind==='audio'?'audio':'video',state:t.state==='live'?'live':'ended',muted:!!t.muted}));
  return record;
}
export class InterviewRecoveryTrace {
  constructor(token) {
    this.token=token;this.key=journalKey(token);this.events=[];this.pageId=crypto.randomUUID();this.sequence=0;this.persistent=false;
    try {
      const saved=JSON.parse(sessionStorage.getItem(this.key)||'[]');this.persistent=true;
      if(Array.isArray(saved))this.events=saved.slice(-160).filter(x=>typeof x.key==='string'&&x.key.length<=200&&recoveryRecord(x.record)).map(x=>({...x,record:recoveryRecord(x.record)}));
    } catch { /* Diagnostics must not require usable browser storage. */ }
  }
  save() {
    try {
      // A late acknowledgement from an older page/controller cannot erase newer checkpoints.
      const saved=JSON.parse(sessionStorage.getItem(this.key)||'[]'),merged=new Map();
      if(Array.isArray(saved))for(const event of saved)if(typeof event.key==='string'&&event.key.length<=200&&recoveryRecord(event.record))merged.set(event.key,{...event,record:recoveryRecord(event.record)});
      for(const event of this.events){event.sent=!!(event.sent||merged.get(event.key)?.sent);merged.set(event.key,event);}
      this.events=[...merged.values()].sort((a,b)=>a.record.at-b.record.at).slice(-160);
      sessionStorage.setItem(this.key,JSON.stringify(this.events));this.persistent=true;
    } catch {this.persistent=false;/* Memory-only diagnostics still flush when online. */}
  }
  append(type,details={}) {
    const record=recoveryRecord({type,at:Date.now(),hidden:document.hidden,...details});if(!record)return;
    this.events.push({key:`${this.pageId}:${String(++this.sequence).padStart(6,"0")}`,record,sent:false});this.events=this.events.slice(-160);
    this.save(); // Synchronous checkpoint before a native call can suspend JavaScript.
    queueMicrotask(()=>this.flush()); // Never start network work before gesture acquisition.
  }
  identify(clientId) {this.clientId=clientId;queueMicrotask(()=>this.flush());}
  flush() {
    if(!this.clientId||this.flushing)return this.flushing;
    this.flushing=(async()=>{
      for(const event of this.events.filter(e=>!e.sent)) {
        try {
          await bounded(recruitmentService.observeRecovery(this.token,this.clientId,event.key,event.record),'Saving recovery diagnostics',{timeoutMs:5000});
          event.sent=true;this.save();
        } catch {break;} // Retain for the next lifecycle event/refresh; no retry loop.
      }
    })().finally(()=>{this.flushing=null;});
    return this.flushing;
  }
  latestRequest() {
    const reverse=[...this.events].reverse();
    return reverse.find(e=>e.record.stage==='continue.tap')?.record.request_id||reverse.find(e=>e.record.request_id)?.record.request_id;
  }
  unfinished() {
    const requestId=this.latestRequest();if(!requestId)return;
    if(this.events.some(e=>e.record.request_id===requestId&&e.record.type==='recovery.transition'&&['RESUMED','RECOVERY_REQUIRED','TERMINAL'].includes(e.record.state)))return;
    return [...this.events].reverse().find(e=>e.record.request_id===requestId)?.record;
  }
}
