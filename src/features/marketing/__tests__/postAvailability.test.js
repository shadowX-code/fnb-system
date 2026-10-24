import {it,expect} from 'vitest';
import {publicationAvailability,liveAvailabilityInfo} from '../postAvailability.js';
const channel=(channel,state)=>({channel,provider_post_id:channel==='facebook'?'111_222':'333',status:'published',availability:{state}});
it('distinguishes manual from provider proof and keeps mixed confirmed removal explicit',()=>{
 expect(liveAvailabilityInfo({state:'manually_removed'}).help).toContain('not provider-verified');
 expect(publicationAvailability([channel('facebook','deleted'),channel('instagram','manually_removed')])).toMatchObject({state:'removed',label:'Removed · mixed confirmation'});
 expect(publicationAvailability([channel('facebook','manually_removed'),channel('instagram','available')]).label).toBe('Partly removed');
 expect(liveAvailabilityInfo({state:'available',manual_confirmation:{state:'conflict'}}).help).toContain('conflicting evidence');
 const recovered=channel('instagram','available');recovered.availability.manual_confirmation={state:'conflict'};
 expect(publicationAvailability([channel('facebook','available'),recovered])).toMatchObject({tone:'warning'});
 expect(publicationAvailability([channel('facebook','available'),recovered]).details).toContain('staff confirmation conflict');
});
it('keeps draft/no-receipt rows separate from live availability',()=>{expect(publicationAvailability([{channel:'facebook',status:'draft'}])).toBeNull();expect(publicationAvailability([channel('facebook','unknown')]).label).toBe('Not checked');});
it('preserves partial channel availability without changing publication status',()=>{const channels=[channel('facebook','deleted'),channel('instagram','available')];expect(publicationAvailability(channels)).toMatchObject({state:'partial',label:'Partly removed'});expect(channels.every(c=>c.status==='published')).toBe(true);});
it('distinguishes access errors, temporary failures, unavailable objects and explicit removal',()=>{expect(new Set(['available','unavailable','access_restricted','temporarily_unavailable','deleted','unknown'].map(state=>liveAvailabilityInfo({state}).label)).size).toBe(6);expect(liveAvailabilityInfo({state:'unavailable'}).help).toContain('does not prove deletion');expect(publicationAvailability([channel('facebook','available'),channel('instagram','unknown')]).label).toBe('Partly checked');});
