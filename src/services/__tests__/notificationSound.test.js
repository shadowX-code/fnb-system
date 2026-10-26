import {expect,it,vi} from 'vitest';
import {createNotificationSound} from '../notificationSound.js';
function setup(shared) {
 const values=shared?.values??new Map(),contexts=[],played=[];
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const host=new EventTarget();host.localStorage=storage;
 const locks=shared?.locks??{request:vi.fn(async(name,options,callback)=>callback({name}))};
 class Audio {
  constructor(){this.state='suspended';this.currentTime=0;this.destination={};contexts.push(this)}
  resume=vi.fn(async()=>{this.state='running';this.onstatechange?.()});
  suspend=vi.fn(async()=>{this.state='suspended';this.onstatechange?.()});
  close=vi.fn(async()=>{this.state='closed';this.onstatechange?.()});
  createGain(){return {gain:{setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()}}
  createOscillator(){return {frequency:{setValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn(),start:()=>played.push('tone'),stop:vi.fn()}}
 }
 const client=createNotificationSound('employee',{window:host,storage,locks,AudioContext:Audio});
 client.setActive(true);
 return {client,values,contexts,played,locks,host};
}
const base=Date.parse('2026-10-26T08:00:00Z'),iso=n=>new Date(base+n*1000).toISOString();
const event=(id='message:one',kind='inbound',time=1,extra={})=>({id,kind,created_at:iso(time),occurred_at:iso(time),...extra});
const snapshot=(time,events=[])=>({observed_at:iso(time),sound_events:events});
async function ready(s){await s.client.enable();await s.client.observe(snapshot(0,[event('message:initial','inbound',-1)]))}
it('defaults off, requires explicit audio permission and never sounds initial history',async()=>{
 const s=setup();expect(s.client.getSnapshot().enabled).toBe(false);expect(s.contexts).toHaveLength(0);
 await ready(s);expect(s.client.getSnapshot().ready).toBe(true);expect(s.played).toHaveLength(0);
 await s.client.observe(snapshot(5,[event()]));expect(s.played).toHaveLength(1);
});
it('deduplicates retries and reconnect snapshots, and never sounds outbound, history or normal AI handling',async()=>{
 const s=setup();await ready(s);
 await s.client.observe(snapshot(5,[event(),event('outbound:own','echo'),event('message:old','inbound',-180),event('message:ai','inbound',1,{automatic_candidate:true})]));
 await s.client.observe(snapshot(10,[event()]));expect(s.played).toHaveLength(1);
 await s.client.observe(snapshot(180,[event('message:offline','inbound',175)]));expect(s.played).toHaveLength(1);
 await s.client.observe(snapshot(190,[event('message:new','inbound',185)]));expect(s.played).toHaveLength(2);
});
it('coordinates one coalesced tone across two ready tabs and prioritizes a handoff',async()=>{
 let held=false;
 const locks={request:vi.fn(async(name,options,callback)=>{if(held)return callback(null);held=true;try{return await callback({name})}finally{held=false}})};
 const a=setup({values:new Map(),locks}),b=setup(a);await ready(a);await ready(b);
 const batch=snapshot(8,[event(),event('handoff:risk','handoff',3)]);
 await Promise.all([a.client.observe(batch),b.client.observe(batch)]);
 expect(a.played.length+b.played.length).toBe(1);
 const seen=JSON.parse(a.values.get('feedx.notifications.sound.employee.seen'));expect(seen).toHaveLength(2);
});
it('preserves visual counts independently: unavailable audio, storage and browser locks fail silent',async()=>{
 const s=setup();await ready(s);s.contexts[0].state='suspended';s.contexts[0].onstatechange();
 await s.client.observe(snapshot(5,[event()]));expect(s.played).toHaveLength(0);expect(s.client.getSnapshot().ready).toBe(false);
 const noLocks=createNotificationSound('employee',{window:s.host,locks:{},AudioContext:class{}});expect(noLocks.getSnapshot().available).toBe(false);
 const blocked=setup();blocked.values.set('feedx.notifications.sound.employee.seen','invalid');await ready(blocked);await blocked.client.observe(snapshot(5,[event()]));expect(blocked.played).toHaveLength(0);
});
it('honors off, zero volume, workspace exit and cross-tab revocation before a claim',async()=>{
 const s=setup();await ready(s);s.client.setVolume(0);await s.client.observe(snapshot(5,[event()]));expect(s.played).toHaveLength(0);
 s.client.setVolume(.5);await s.client.observe(snapshot(6));s.client.setActive(false);await s.client.observe(snapshot(10,[event('message:x','inbound',9)]));expect(s.played).toHaveLength(0);
 s.client.setActive(true);await s.client.observe(snapshot(11));s.values.set('feedx.notifications.sound.employee',JSON.stringify({enabled:false,volume:.5}));await s.client.observe(snapshot(15,[event('message:x','inbound',14)]));expect(s.played).toHaveLength(0);
 s.client.disable();expect(s.client.getSnapshot().enabled).toBe(false);expect(s.contexts[0].suspend).toHaveBeenCalled();
});
it('requires a fresh quiet baseline after re-enabling and rejects stale out-of-order snapshots',async()=>{
 const s=setup();await ready(s);await s.client.observe(snapshot(5,[event()]));s.client.disable();await s.client.enable();
 await s.client.observe(snapshot(10,[event('message:while-off','inbound',9)]));expect(s.played).toHaveLength(1);
 await s.client.observe(snapshot(8,[event('message:stale','inbound',7)]));expect(s.played).toHaveLength(1);
 await s.client.observe(snapshot(15,[event('message:fresh','inbound',14)]));expect(s.played).toHaveLength(2);
});
it('never instantiates or plays audio because of a stored preference alone',async()=>{
 const s=setup();s.values.set('feedx.notifications.sound.employee',JSON.stringify({enabled:true,volume:.4}));const other=setup(s);
 expect(other.client.getSnapshot().enabled).toBe(true);expect(other.client.getSnapshot().ready).toBe(false);expect(other.contexts).toHaveLength(0);
 await other.client.observe(snapshot(0));await other.client.observe(snapshot(5,[event()]));expect(other.played).toHaveLength(0);
});
