import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(()=>({decideTime:vi.fn()}));
vi.mock('../../../../services/payrollService.js',()=>({payrollService:mocks}));
import PayrollPayableTimeReview from '../PayrollPayableTimeReview.jsx';
afterEach(cleanup);
const row = {id:'time',employee_name:'QA Hourly',work_date:'2026-09-25',status:'review_required',classification:'regular',issue_codes:['late_arrival','early_departure'],scheduled_minutes:480,actual_minutes:450,proposed_minutes:390,approved_minutes:null,evidence:{scheduled_start_at:'2026-09-25T01:00:00Z',scheduled_end_at:'2026-09-25T10:00:00Z',clock_in_at:'2026-09-25T01:30:00Z',clock_out_at:'2026-09-25T09:00:00Z',roster_break_minutes:60}};
const employee = {name:'QA Hourly',time:[row],pay:{pay_basis:'hourly',hourly_rate:15.5},result:{earningsCurrent:true},calculation:{lines:[{kind:'earning',code:'regular',rate_per_minute:15.5/60,amount:100.75}]}};
it('shows source comparison and pending approval without calculating earnings from Attendance',()=>{
  render(<PayrollPayableTimeReview employee={employee} month="2026-09" canManage onClose={()=>{}} />);
  expect(screen.getByText('Late arrival · Early departure')).toBeTruthy();
  expect(screen.getAllByText('7.50 h')).toHaveLength(2);
  expect(screen.getByText('Proposed 6.50 h')).toBeTruthy();
  expect(screen.getByText(/RM\s*100\.75/)).toBeTruthy();
  expect(screen.getByText(/review pending/)).toBeTruthy();
});
it('does not submit a saved decision again when payroll refresh fails',async()=>{
  mocks.decideTime.mockResolvedValue({});
  const refresh=vi.fn().mockRejectedValueOnce(new Error('Calculation temporarily unavailable')).mockResolvedValueOnce();
  render(<PayrollPayableTimeReview employee={employee} month="2026-09" canManage onClose={()=>{}} onDecisionSaved={refresh} />);
  fireEvent.click(screen.getByRole('button',{name:'Review exception'}));
  fireEvent.change(screen.getByRole('textbox',{name:/Decision reason/}),{target:{value:'Reviewed clock evidence'}});
  fireEvent.click(screen.getByRole('button',{name:'Record Decision'}));
  await screen.findByRole('button',{name:'Refresh Review'});
  fireEvent.click(screen.getByRole('button',{name:'Refresh Review'}));
  await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(2));
  expect(mocks.decideTime).toHaveBeenCalledTimes(1);
  expect(mocks.decideTime).toHaveBeenCalledWith(expect.objectContaining({id:'time',approvedMinutes:390,reason:'Reviewed clock evidence'}));
});
it('clean days and read-only access do not offer a decision',()=>{
  render(<PayrollPayableTimeReview employee={{...employee,time:[{...row,status:'approved_auto',approved_minutes:390,issue_codes:[]}]}} month="2026-09" canManage={false} onClose={()=>{}} />);
  expect(screen.getByText('Approved automatically')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Review exception'})).toBeNull();
});
