import {describe,it,expect} from 'vitest';
import {weekOf,monthWeeks,allowedMoves,plannerSummary,sortedTasks,filterTasks,currentMonth} from '../contentPlanner.js';
const task=(id,patch={})=>({id,title:id,brand_id:'brand',brand_name:'Brand',status:'planned',due_date:'2026-10-12',created_at:'2026-10-01',manual_order:0,...patch});
describe('Creative planner presentation',()=>{
 it('uses Malaysia month independently of browser time zone',()=>expect(currentMonth(new Date('2026-09-30T17:00:00Z'))).toBe('2026-10-01'));
 it('keeps Monday planning weeks independent from deadlines',()=>{expect(weekOf('2026-10-01')).toBe('2026-09-28');expect(monthWeeks('2026-10-01')).toEqual(['2026-09-28','2026-10-05','2026-10-12','2026-10-19','2026-10-26']);});
 it('never offers completion through status changes',()=>{for(const status of ['planned','in_progress','revision_needed','in_review','completed'])expect(allowedMoves(task('x',{status}),true)).not.toContain('completed');expect(allowedMoves(task('x'),false)).toEqual([]);});
 it('blocks review while blocked and exposes revision recovery',()=>{expect(allowedMoves(task('x',{status:'in_progress',blocked:true}),true)).toEqual(['planned']);expect(allowedMoves(task('x',{status:'revision_needed'}),true)).toContain('in_review');});
 it('counts outstanding deadlines separately from completed production',()=>expect(plannerSummary([task('a',{due_date:'2026-10-10'}),task('b',{blocked:true}),task('c',{status:'completed',due_date:'2026-10-10'}),task('d',{due_date:'2026-10-20'})],'2026-10-12')).toEqual({planned:4,completed:1,due:1,overdue:1,blocked:1}));
 it('prioritizes unfinished overdue and blocked work, while manual order is explicit',()=>{const tasks=[task('done',{status:'completed',manual_order:1}),task('upcoming',{due_date:'2026-10-20',manual_order:2}),task('blocked',{blocked:true,manual_order:3}),task('late',{due_date:'2026-10-10',manual_order:4})];expect(sortedTasks(tasks,'workload','2026-10-12').map(t=>t.id)).toEqual(['late','blocked','upcoming','done']);expect(sortedTasks(tasks,'manual').map(t=>t.id)).toEqual(['done','upcoming','blocked','late']);});
 it('applies shared filters without mutating task records',()=>{const tasks=[task('a'),task('b',{brand_id:'other',assignee_id:'employee',blocked:true})];expect(filterTasks(tasks,{brand:'other',assignee:'employee',blocked:true})).toEqual([tasks[1]]);expect(tasks).toHaveLength(2);});
});
