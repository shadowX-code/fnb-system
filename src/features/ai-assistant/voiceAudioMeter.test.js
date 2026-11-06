import {it,expect,vi,afterEach} from 'vitest';
import {createVoiceAudioMeter} from './voiceAudioMeter.js';
afterEach(()=>vi.useRealTimers());
it('observes SDK sender/receiver frequencies, silence and cleanup without capturing or stopping tracks',async()=>{
 vi.useFakeTimers();let phase='listening',hidden=false;
 const mic={kind:'audio',stop:vi.fn()},out={kind:'audio',stop:vi.fn()},data=new Map([[mic,0],[out,0]]),nodes=[];
 class Context{state='running';resume=vi.fn(async()=>{this.state='running';});suspend=vi.fn(async()=>{this.state='suspended';});close=vi.fn(async()=>{});createMediaStreamSource(stream){let analyser;const n={connect(a){analyser=a;analyser.track=stream.tracks[0];},disconnect:vi.fn()};nodes.push(n);return n;}createAnalyser(){return{frequencyBinCount:128,getByteFrequencyData(array){array.fill(data.get(this.track));}};}}
 const emit=vi.fn(),meter=createVoiceAudioMeter({emit,Context,Stream:class{constructor(tracks){this.tracks=tracks;}},phase:()=>phase,hidden:()=>hidden,reduced:()=>false});
 const peer={getSenders:()=>[{track:mic}],getReceivers:()=>[{track:out}]};
 await meter.resume(peer);expect(emit.mock.lastCall[0].level).toBe(0);
 data.set(mic,190);await vi.advanceTimersByTimeAsync(50);expect(emit.mock.lastCall[0].level).toBeGreaterThan(.5);expect(emit.mock.lastCall[0].source).toBe('microphone');
 phase='speaking';data.set(out,240);await vi.advanceTimersByTimeAsync(50);expect(emit.mock.lastCall[0].level).toBeGreaterThan(.9);expect(emit.mock.lastCall[0].source).toBe('output');
 phase='thinking';await vi.advanceTimersByTimeAsync(50);expect(emit.mock.lastCall[0].level).toBe(0);
 hidden=true;meter.pause();expect(emit.mock.lastCall[0].source).toBe('none');hidden=false;await meter.resume(peer);expect(nodes).toHaveLength(2);
 meter.close();expect(nodes.every(n=>n.disconnect.mock.calls.length===1)).toBe(true);expect(mic.stop).not.toHaveBeenCalled();expect(out.stop).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
