import {describe,it,expect} from 'vitest';
import {revisionInstructions,completedAt,recentCompleted,monthDays,taskDueState,todayKey,weekOf,monthWeeks,allowedMoves,plannerSummary,sortedTasks,filterTasks,currentMonth,listStatusMoves,canReorderList,plannerListGroups} from '../contentPlanner.js';
const task=(id,patch={})=>({id,title:id,brand_id:'brand',brand_name:'Brand',status:'planned',due_date:'2026-10-12',created_at:'2026-10-01',manual_order:0,...patch});
describe('Creative planner presentation',()=>{
 it('limits List ordering to a complete unfiltered manual presentation',()=>{
  expect(canReorderList({sort:'manual'},true,500)).toBe(true);
  for(const patch of [{sort:'due'},{brand:'brand'},{groupBy:'status'},{search:'work'},{status:'planned'},{assignee:'member'},{blocked:true}])expect(canReorderList({sort:'manual',...patch},true,2)).toBe(false);
  expect(canReorderList({sort:'manual'},false,2)).toBe(false);expect(canReorderList({sort:'manual'},true,501)).toBe(false);
 });
 it('groups page records by identity without changing their stored order or ownership',()=>{
  const rows=[task('a',{brand_id:'one',brand_name:'Same name',manual_order:2}),task('b',{brand_id:'two',brand_name:'Same name',manual_order:1})],before=JSON.stringify(rows);
  expect(plannerListGroups(rows,'brand').map(g=>g.tasks.map(t=>t.id))).toEqual([['a'],['b']]);expect(JSON.stringify(rows)).toBe(before);expect(plannerListGroups(rows,'assignee')[0].label).toBe('Unassigned');
 });
 it('List review choices depend on reviewer authority and blockers, while reopen depends on edit',()=>{
  expect(listStatusMoves(task('a',{status:'in_review'}),true,false)).toEqual([]);expect(listStatusMoves(task('a',{status:'in_review'}),false,true)).toEqual(['revision_needed','completed']);expect(listStatusMoves(task('a',{status:'in_review',blocked:true}),true,true)).toEqual([]);expect(listStatusMoves(task('a',{status:'completed'}),true,false)).toEqual(['in_progress']);
 });
 it('uses Malaysia month independently of browser time zone',()=>expect(currentMonth(new Date('2026-09-30T17:00:00Z'))).toBe('2026-10-01'));
 it('keeps Monday planning weeks independent from deadlines',()=>{expect(weekOf('2026-10-01')).toBe('2026-09-28');expect(monthWeeks('2026-10-01')).toEqual(['2026-09-28','2026-10-05','2026-10-12','2026-10-19','2026-10-26']);});
 it('never offers completion through status changes',()=>{for(const status of ['planned','in_progress','revision_needed','in_review','completed'])expect(allowedMoves(task('x',{status}),true)).not.toContain('completed');expect(allowedMoves(task('x'),false)).toEqual([]);});
 it('blocks review while blocked and exposes revision recovery',()=>{expect(allowedMoves(task('x',{status:'in_progress',blocked:true}),true)).toEqual(['planned']);expect(allowedMoves(task('x',{status:'revision_needed'}),true)).toContain('in_review');});
 it('counts outstanding deadlines separately from completed production',()=>expect(plannerSummary([task('a',{due_date:'2026-10-10'}),task('b',{blocked:true}),task('c',{status:'completed',due_date:'2026-10-10'}),task('d',{due_date:'2026-10-20'})],'2026-10-12')).toEqual({planned:4,completed:1,due:1,overdue:1,blocked:1}));
 it('prioritizes unfinished overdue and blocked work, while manual order is explicit',()=>{const tasks=[task('done',{status:'completed',manual_order:1}),task('upcoming',{due_date:'2026-10-20',manual_order:2}),task('blocked',{blocked:true,manual_order:3}),task('late',{due_date:'2026-10-10',manual_order:4})];expect(sortedTasks(tasks,'workload','2026-10-12').map(t=>t.id)).toEqual(['late','blocked','upcoming','done']);expect(sortedTasks(tasks,'manual').map(t=>t.id)).toEqual(['done','upcoming','blocked','late']);});
 it('applies shared filters without mutating task records',()=>{const tasks=[task('a'),task('b',{brand_id:'other',assignee_id:'employee',blocked:true})];expect(filterTasks(tasks,{brand:'other',assignee:'employee',blocked:true})).toEqual([tasks[1]]);expect(tasks).toHaveLength(2);});
});

it('attributes production urgency to Malaysia dates and suppresses completed overdue warnings',()=>{expect(todayKey(new Date('2026-10-11T17:00:00Z'))).toBe('2026-10-12');expect(taskDueState({status:'planned',due_date:'2026-10-12'},'2026-10-12')).toBe('today');expect(taskDueState({status:'planned',due_date:'2026-10-13'},'2026-10-12')).toBe('tomorrow');expect(taskDueState({status:'planned',due_date:'2026-10-11'},'2026-10-12')).toBe('overdue');expect(taskDueState({status:'completed',due_date:'2026-10-11'},'2026-10-12')).toBe('normal');});

it('recent completions use seven KL calendar days and the latest approval rather than mutable dates',()=>{
 const task={status:'completed',due_date:'2026-10-13',updated_at:'2026-10-13T02:00:00Z',history:[{revision:1,action:'approve',date:'2026-10-06T15:59:59Z'},{revision:3,action:'approve',date:'2026-10-06T16:00:00Z'},{revision:4,action:'handoff',date:'2026-10-13T02:00:00Z'}]};
 expect(completedAt(task)).toBe('2026-10-06T16:00:00Z');expect(recentCompleted(task,'2026-10-13')).toBe(true);
 expect(recentCompleted({...task,history:task.history.slice(0,1)},'2026-10-13')).toBe(false);
 expect(recentCompleted({...task,history:[]},'2026-10-13')).toBe(false);
});
it('month grids include complete Monday-Sunday rows across year and leap boundaries',()=>{
 expect(monthDays('2026-10-01')).toHaveLength(35);expect(monthDays('2026-10-01')[0]).toBe('2026-09-28');expect(monthDays('2026-10-01').at(-1)).toBe('2026-11-01');expect(monthDays('2024-02-01')).toContain('2024-02-29');
});

it('reads revision instructions only from the active canonical request cycle',()=>{
 const active={status:'revision_needed',revision:8,review_feedback:'Ignore duplicated projection',history:[{revision:2,action:'request_revision',feedback:'Old resolved instructions'},{revision:3,action:'transition'},{revision:5,action:'request_revision',feedback:'  Current instructions\n第二行  '},{revision:7,action:'save',feedback:'Unrelated snapshot text'},{revision:8,action:'ordered'}]};
 expect(revisionInstructions(active)).toBe('Current instructions\n第二行');expect(revisionInstructions({...active,history:[...active.history].reverse()})).toBe('Current instructions\n第二行');
 expect(revisionInstructions({...active,status:'in_progress'})).toBeNull();expect(revisionInstructions({...active,status:'completed'})).toBeNull();
 expect(revisionInstructions({...active,history:[...active.history,{revision:6,action:'transition'}]})).toBe('');expect(revisionInstructions({...active,history:[...active.history,{revision:6,action:'approve'}]})).toBe('');
 expect(revisionInstructions({...active,history:[...active.history,{revision:8,action:'request_revision',feedback:'  '}]})).toBe('');
 expect(revisionInstructions({...active,history:[]})).toBe('');expect(revisionInstructions({...active,history:undefined})).toBe('');
 expect(revisionInstructions({...active,history:[...active.history,{revision:9,action:'request_revision',feedback:'Future snapshot'}]})).toBe('Current instructions\n第二行');
});
