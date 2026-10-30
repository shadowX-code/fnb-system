import {it,expect} from 'vitest';
import {workforceOverview,payrollOverview} from '../workforceOverview.js';
const records=[{id:'a',legal_entity_id:'c1',employment_type:'night_apprentice',employment_status:'active'},
 {id:'b',legal_entity_id:'c1',employment_type:null,employment_status:'resigned'},
 {id:'c',legal_entity_id:'c2',employment_type:'part_time',employment_status:'active'},
 {id:'d',legal_entity_id:null,employment_type:'',employment_status:null}];
it('counts one employee once and reconciles dynamic classifications, statuses and unassigned groups',()=>{
 const result=workforceOverview([...records,records[0]]);
 expect(result.total).toBe(4);expect(result.active).toBe(2);expect(result.companyCount).toBe(2);
 expect(result.types.find(row=>row.key==='').count).toBe(2);
 expect(result.types.find(row=>row.key==='night_apprentice').label).toBe('Night Apprentice');
 for(const collection of [result.types,result.statuses,result.companies])expect(collection.reduce((sum,row)=>sum+(row.count??row.total),0)).toBe(4);
 expect(result.types.reduce((sum,row)=>sum+row.percentage,0)).toBe(100);
 expect(result.companies.reduce((sum,row)=>sum+row.active,0)).toBe(2);
 expect(result.companies.every(row=>row.types.reduce((sum,type)=>sum+type.count,0)===row.total)).toBe(true);
});
it('uses one selected-company population for all summaries and distributions',()=>{
 const result=workforceOverview(records,'c1');expect(result.total).toBe(2);expect(result.active).toBe(1);expect(result.companyCount).toBe(1);
 expect(result.companies).toHaveLength(1);expect(result.types.map(row=>row.key)).not.toContain('part_time');
 expect(workforceOverview(records,'missing').total).toBe(0);
});
it('does not invent classification rows when empty',()=>{expect(workforceOverview([])).toMatchObject({total:0,active:0,companyCount:0,types:[],statuses:[],companies:[]});});
it('prioritizes current and then open periods, preserving the newest actionable canonical revision',()=>{
 const period=(id,date,runs,company='c1')=>({id,period_start:date,legal_entity_id:company,runs});
 const rows=payrollOverview([period('old','2026-08-01',[{id:'closed',status:'finalized',revision:1}]),
  period('overdue','2026-09-01',[{id:'open',status:'review_required',revision:2},{id:'previous',status:'finalized',revision:1}]),
  period('now','2026-10-01',[{id:'draft',status:'draft',revision:1}]),
  period('future','2026-11-01',[{id:'ready',status:'ready',revision:1}]),
  period('other','2026-10-01',[{id:'draft2',status:'draft',revision:1}],'c2')],'c1','2026-10');
 expect(rows.map(row=>row.id)).toEqual(['now','overdue','future']);expect(rows[1].run.id).toBe('open');
});
