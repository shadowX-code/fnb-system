import {it,expect} from 'vitest';
import {preferenceObservation,preferenceSchema,preferenceInstructions} from '../../../supabase/functions/recruitment-evidence/preference.ts';
import {interviewInstructions} from '../../../supabase/functions/recruitment-realtime/prompt.ts';
import {continuationContext} from '../../../supabase/functions/recruitment-realtime/context.ts';
const turns=[{turn_number:1,speaker:'ai',transcript:'Do you prefer part time?'},{turn_number:2,speaker:'candidate',transcript:'I want part time.'}];
it('requires an exact candidate citation, accepts Both, and rejects fabricated/AI/unknown observations',()=>{
 expect(preferenceObservation({preference:'part_time',turn_number:2,quote:'I want part time.'},turns)).toEqual({p_preference:'part_time',p_turn_number:2,p_quote:'I want part time.'});
 for(const value of [null,{preference:'unknown',turn_number:2,quote:'I want part time.'},{preference:'full_time',turn_number:1,quote:'Do you prefer part time?'},{preference:'both',turn_number:2,quote:'Either works'},{preference:'both',turn_number:'2',quote:'I want part time.'}]) expect(preferenceObservation(value,turns)).toBeNull();
 expect(preferenceObservation({preference:'both',turn_number:3,quote:'我全职兼职都可以'},[{turn_number:3,speaker:'candidate',transcript:'我全职兼职都可以'}])?.p_preference).toBe('both');
 expect(preferenceSchema.anyOf[1].properties.preference.enum).not.toContain('unknown');
 expect(preferenceInstructions).toContain('availability alone');
});
it('initial/replacement/quiet context uses only canonical application preference and retains separate offering context',()=>{
 const state={turns:[],topics:[],scenarios:[],max_ends_at:new Date(Date.now()+60000).toISOString()};
 for(const preference of ['full_time','part_time','both','unknown']) {
  const context=continuationContext(state,{provider_generation:2},{target_minutes:10},{employment_preference:preference,private_payroll:'not authorized'},[]);
  expect(context.employment_preference).toBe(preference);
  const instructions=interviewInstructions(context);
  expect(instructions).toContain(`employment preference (candidate information only): ${preference}`);
  expect(instructions).toContain('do not ask the preference again');
  expect(instructions).toContain('never a merged package');
  expect(JSON.stringify(context)).not.toContain('private_payroll');
 }
});
