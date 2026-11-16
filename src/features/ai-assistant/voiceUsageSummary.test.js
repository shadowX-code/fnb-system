import {expect,it} from 'vitest';
import {summarizeVoiceUsage,voiceCostCoverage} from './voiceUsageSummary.js';
it('aggregates only recorded nonnegative integer observations and exposes partial coverage',()=>{
 const summary=summarizeVoiceUsage([
  {state:'closed',observed_duration_seconds:72,observed_usage:{input_audio_tokens:0,output_audio_tokens:900}},
  {state:'failed',observed_duration_seconds:0,observed_usage:{input_audio_tokens:null,output_audio_tokens:42}},
  {observed_usage:{input_audio_tokens:-1,output_audio_tokens:'10'},observed_duration_seconds:null},
 ]);
 expect(summary.count).toBe(3);expect(summary.states).toEqual({closed:1,failed:1,historical:1});
 expect(summary.duration).toEqual({value:72,coverage:2});expect(summary.inputAudio).toEqual({value:0,coverage:1});expect(summary.outputAudio).toEqual({value:942,coverage:2});expect(summary.cost).toEqual({value:null,coverage:0});
});
it('never substitutes zero for wholly missing usage or duration',()=>{
 const summary=summarizeVoiceUsage([{}]);for(const field of ['duration','inputAudio','outputAudio'])expect(summary[field]).toEqual({value:null,coverage:0});
});
it('explains absent and incomplete reports and rejects unsupported historical costs',()=>{
 expect(voiceCostCoverage({}).reason).toMatch(/No provider usage report/);
 expect(voiceCostCoverage({observed_usage:{input_audio_tokens:0}}).reason).toMatch(/not recorded completely/);
 const result=voiceCostCoverage({estimated_cost_usd:0.1,provider:'openai',observed_usage:{input_audio_tokens:300,output_audio_tokens:400}});
 expect(result.estimatedUsd).toBeNull();expect(result.reason).toMatch(/Only audio totals/);expect(result.missing).toHaveLength(3);
});
