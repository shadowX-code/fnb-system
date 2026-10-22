import {expect,it} from 'vitest';
import {activityRuns,plannerActivity} from '../plannerActivity.js';
const row=(revision,action,state={},extra={})=>({revision,action,state,date:'2026-10-22T01:00:00Z',actor:'Kai',...extra});
it('maps canonical events centrally without changing chronological records or copying feedback onto saves',()=>{
 const history=[row(1,'create',{status:'planned'}),row(2,'transition',{status:'in_review'}),row(3,'request_revision',{}, {feedback:'Full\nrevision instructions'}),row(4,'ordered',{}, {feedback:'Inherited feedback'}),row(5,'approve',{}, {feedback:'Ready'})];const before=JSON.stringify(history),events=plannerActivity(history);
 expect(events.map(e=>e.revision)).toEqual([5,4,3,2,1]);expect(events.map(e=>e.title)).toEqual(['Production completed','Board order updated','Revision requested','Submitted for review','Task created']);expect(events.find(e=>e.revision===4).feedback).toBeNull();expect(events.find(e=>e.revision===3).feedback).toBe('Full\nrevision instructions');expect(JSON.stringify(history)).toBe(before);
});
it('shows exact adjacent assignment and priority changes, with nickname or unavailable identity fallback',()=>{
 const events=plannerActivity([row(3,'save',{status:'in_progress',assignee_id:'a',assignee_name:'Lin',priority:'high'}),row(2,'save',{status:'in_progress',assignee_id:null,priority:'normal'}),row(1,'create',{status:'planned',assignee_id:null,priority:'normal'})]);
 expect(events[0].title).toBe('Assignment and priority changed');expect(events[0].metadata).toBe('Unassigned → Lin · Priority: Normal → High');expect(events[1].metadata).toBe('Planned → In Progress');
 const unavailable=plannerActivity([row(2,'save',{assignee_id:'a',priority:'normal'}),row(1,'create',{assignee_id:null,priority:'normal'})]);expect(unavailable[0].metadata).toBe('Unassigned → Team member unavailable');
});
it('does not invent changes when the preceding revision or extended state is unavailable',()=>{
 expect(plannerActivity([row(4,'save',{priority:'high'}),row(2,'create',{priority:'normal'})])[0].metadata).toBe('');expect(plannerActivity([{revision:1,action:'transition'}])[0].title).toBe('Status changed');expect(plannerActivity([row(2,'request_revision',{}, {feedback:''})])[0].feedback).toBe('No revision instructions provided');
});
it('groups only contiguous reorders within one Malaysia-local day while retaining every event',()=>{
 const events=plannerActivity([row(5,'ordered',{}, {date:'2026-10-21T16:30:00Z'}),row(4,'ordered',{}, {date:'2026-10-21T16:20:00Z'}),row(3,'save',{}, {date:'2026-10-21T16:10:00Z'}),row(2,'ordered',{}, {date:'2026-10-21T16:00:00Z'}),row(1,'ordered',{}, {date:'2026-10-21T15:59:00Z'})]);const groups=activityRuns(events);expect(groups.map(g=>g.events.map(e=>e.revision))).toEqual([[5,4],[3],[2],[1]]);expect(groups.flatMap(g=>g.events)).toEqual(events);
});
