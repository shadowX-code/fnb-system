import {describe,it,expect} from 'vitest';
import {inboxStatusDescription,inboxStatusTabs,inboxStatusOptions} from '../inboxStatus.js';
describe('canonical Inbox status presentation',()=>{
 it('keeps waiting distinct from completion',()=>{expect(inboxStatusDescription('pending')).toContain('Waiting for the customer');expect(inboxStatusDescription('resolved')).toContain('reopens');expect(inboxStatusOptions).toHaveLength(3)});
 it('uses complete server-filtered counts and preserves verified zero',()=>{expect(inboxStatusTabs({all:31,open:30,pending:0,resolved:1}).map(x=>x.label)).toEqual(['All 31','Open 30','Pending 0','Resolved 1']);expect(inboxStatusTabs(null)[1].label).toBe('Open')});
});
