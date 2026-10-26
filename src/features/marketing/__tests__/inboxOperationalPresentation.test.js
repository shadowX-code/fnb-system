import {it,expect} from 'vitest';
import {inboxRowAttention,inboxMessageSource,inboxMessageContinues,inboxActivityLabel} from '../inboxPresentation.js';
it('presents one primary action without inventing a lifecycle or masking human attention',()=>{
 expect(inboxRowAttention({ai_handoff:true,unread_count:4,needs_reply:true}).label).toBe('Needs human');
 expect(inboxRowAttention({unread_count:4,needs_reply:true}).label).toBe('Needs reply');
 expect(inboxRowAttention({status:'pending'}).label).toBe('Waiting for customer');
 expect(inboxRowAttention({assigned_to:'staff',status:'open'}).label).toBe('Staff handling');
});
it('groups presentation only for consecutive, same-source messages within the same local day',()=>{
 const a={id:'1',kind:'echo',sender_type:'feedx_ai',evidence_source:'signed_webhook',occurred_at:'2026-10-26T07:00:00Z'},b={...a,id:'2',occurred_at:'2026-10-26T07:01:00Z'};
 expect(inboxMessageContinues(a,b)).toBe(true);expect(inboxMessageContinues(a,{...b,sender_type:'feedx_staff'})).toBe(false);expect(inboxMessageContinues(a,{...b,kind:'note'})).toBe(false);expect(inboxMessageContinues(a,{...b,occurred_at:'2026-10-26T07:03:00Z'})).toBe(false);
 expect(inboxMessageContinues({...a,occurred_at:'2026-10-25T15:59:30Z'},{...b,occurred_at:'2026-10-25T16:00:00Z'})).toBe(false);
 expect(inboxMessageSource(a)).toBe('FeedX AI');expect(inboxMessageSource({...a,sender_type:undefined,message_origin:'meta'})).toBe('Meta / external');
 expect(inboxMessageSource({...a,evidence_source:'recent_api'})).toBe('Recovered from Meta');
});
it('shows local calendar dates for older activity rather than an ambiguous time today',()=>{
 expect(inboxActivityLabel('2026-10-19T00:00:00Z',new Date('2026-10-26T00:00:00Z'))).toMatch(/19 Oct/);
 expect(inboxActivityLabel(null)).toBe('Unavailable');
});
