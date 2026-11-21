import {expect,it} from 'vitest';
import {formatVoiceCost,voiceCostCoverage,usageNumber} from './voiceUsageSummary.js';

it('keeps missing historical and zero-value observations distinct',()=>{
 expect(usageNumber(null)).toBe('—');
 expect(usageNumber(0)).toBe('0');
 expect(formatVoiceCost(null)).toBe('Unavailable');
 expect(formatVoiceCost(0)).toBe('$0.00');
 expect(formatVoiceCost(1)).toBe('< $0.000001');
 expect(voiceCostCoverage({observed_usage:{input_audio_tokens:0}})).toMatchObject({state:'unavailable',amount:'Unavailable',reason:expect.stringMatching(/Historical/)});
});
it('uses server attribution and distinguishes partial from estimated',()=>{
 const row={observed_usage:{pricing_version:'openai-list-usd-2026-11-22'},estimated_cost_nano_usd:148000};
 expect(voiceCostCoverage({...row,charge_status:'partial'})).toMatchObject({state:'partial',amount:'$0.000148'});
 expect(voiceCostCoverage({...row,charge_status:'estimated'}).state).toBe('estimated');
 expect(voiceCostCoverage({...row,charge_status:'unavailable'}).amount).toBe('Unavailable');
});
