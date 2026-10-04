import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ reconcileTimeSource: vi.fn(), decideTime: vi.fn() }));
vi.mock('../../../../services/payrollService.js', () => ({ payrollService: mocks }));
import PayrollPayableTimeReview from '../PayrollPayableTimeReview.jsx';
import { sourceChanges } from '../PayrollTimeExceptionsTab.jsx';
afterEach(cleanup);
const changes = [
 {field:'holiday_id',before:null,after:'holiday'},
 {field:'paid_holiday_policy',before:null,after:{holidays:[{holiday:{name:'Hari Malaysia'}}]}},
 {field:'classification',before:'regular',after:'public_holiday'},
 {field:'issue_codes',before:['missing_punch'],after:['public_holiday_review','missing_punch']},
];
it('shows material holiday and roster changes without treating a new hash as proof', () => {
 expect(sourceChanges(changes)).toContain('Holiday: None → Hari Malaysia');
 expect(sourceChanges(changes)).toContain('Classification: Regular → Public Holiday');
 expect(sourceChanges(changes)).toContain('Review: Missing Punch → Public Holiday Review + Missing Punch');
 expect(sourceChanges([{field:'scheduled_start_at',before:'2026-09-16T03:00:00Z',after:'2026-09-16T04:00:00Z'}])).toEqual(['Scheduled Start At: 11:00 → 12:00']);
});
it('reconciles explicitly, approves nothing automatically and saves into the retained next-date queue', async () => {
 const old={id:'old',employee_id:'employee',employee_name:'QA Employee',work_date:'2026-09-16',status:'approved_manual',approved_minutes:300,classification:'regular',issue_codes:['missing_punch'],evidence:{},source_state:{updated:true,fingerprint:'new-source',changes}};
 const next={...old,id:'next',work_date:'2026-09-17',status:'review_required',approved_minutes:null,source_state:{updated:false}};
 let rows=[old,next];
 const rebased={...old,id:'rebased',status:'review_required',approved_minutes:null,classification:'public_holiday',source_state:{updated:false},history:[{id:'old',revision:1,status:'approved_manual',approved_minutes:300}]};
 const saved={...rebased,id:'saved',status:'approved_manual',approved_minutes:300};
 mocks.reconcileTimeSource.mockResolvedValue({row:rebased,calculation_stale:true});
 mocks.decideTime.mockResolvedValue({row:saved,calculation_stale:true});
 const onSaved=vi.fn(async result => { rows=rows.map(r=>r.work_date===result.row.work_date?result.row:r); return rows; });
 render(<PayrollPayableTimeReview employee={{name:'QA Employee',time:rows,pay:{pay_basis:'hourly',hourly_rate:8},result:{},calculation:{}}} month="2026-09" runId="run" canManage onClose={vi.fn()} onDecisionSaved={onSaved}/>);
 fireEvent.click(screen.getByRole('button',{name:'Review source changes'}));
 expect(screen.getByRole('button',{name:'Reconcile & Review'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Save & Next'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Reconcile & Review'}));
 await waitFor(()=>expect(mocks.reconcileTimeSource).toHaveBeenCalledWith('run','old','new-source'));
 await screen.findByRole('button',{name:'Save & Next'});
 expect(mocks.decideTime).not.toHaveBeenCalled();
 expect(screen.getByRole('spinbutton',{name:/Approved payable minutes/}).value).toBe('');
 fireEvent.change(screen.getByRole('spinbutton',{name:/Approved payable minutes/}),{target:{value:'300'}});
 fireEvent.change(screen.getByRole('textbox',{name:/Decision reason/}),{target:{value:'Confirmed attendance after source review'}});
 fireEvent.click(screen.getByRole('button',{name:'Save & Next'}));
 await screen.findByText('2 of 2 exceptions');
 expect(mocks.decideTime).toHaveBeenCalledWith(expect.objectContaining({id:'rebased',classification:'public_holiday',correction:false}));
 expect(onSaved).toHaveBeenCalledTimes(2);
});
