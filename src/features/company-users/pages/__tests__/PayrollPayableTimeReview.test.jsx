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
  const refresh=vi.fn().mockRejectedValueOnce(new Error('Calculation temporarily unavailable')).mockResolvedValueOnce([{...row,id:'saved',status:'approved_manual',approved_minutes:390}]);
  render(<PayrollPayableTimeReview employee={employee} month="2026-09" canManage onClose={()=>{}} onDecisionSaved={refresh} />);
  fireEvent.click(screen.getByRole('button',{name:'Review exception'}));
  fireEvent.change(screen.getByRole('textbox',{name:/Decision reason/}),{target:{value:'Reviewed clock evidence'}});
  fireEvent.click(screen.getByRole('button',{name:'Save & Finish'}));
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

it('reviews a queue, inspects a saved date with Previous, reopens unresolved dates and finishes once', async () => {
  mocks.decideTime.mockClear().mockResolvedValue({});
  const close = vi.fn();
  let time = [row, {...row,id:'second',work_date:'2026-09-26'}, {...row,id:'third',work_date:'2026-09-27'}];
  const refresh = vi.fn(async () => {
    const payload = mocks.decideTime.mock.calls.at(-1)[0];
    time = time.map(item => item.id === payload.id ? {...item,id:`saved-${item.id}`,status:'approved_manual',approved_minutes:payload.approvedMinutes} : item);
    return [...time].reverse();
  });
  const props = {employee:{...employee,time},month:'2026-09',canManage:true,onClose:close,onDecisionSaved:refresh};
  const view = render(<PayrollPayableTimeReview {...props} />);
  fireEvent.click(screen.getByRole('button',{name:'Continue Review'}));
  expect(screen.getByText('1 of 3 exceptions')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Clock evidence reviewed'}));
  fireEvent.change(screen.getByRole('textbox',{name:/Decision reason/}),{target:{value:'Explicit QA review with supporting evidence'}});
  fireEvent.click(screen.getByRole('button',{name:'Save & Next'}));
  await screen.findByText('2 of 3 exceptions');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Previous'}));
  expect(screen.getByText(/Decision already recorded/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Save & Next'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Next unresolved exception'}));
  expect(screen.getByText('2 of 3 exceptions')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Back to Employee Review'}));
  expect(close).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<PayrollPayableTimeReview {...props} employee={{...employee,time}} />);
  fireEvent.click(screen.getByRole('button',{name:'Continue Review'}));
  expect(screen.getByRole('heading',{name:'QA Hourly · 2026-09-26'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Clock evidence reviewed'}));
  fireEvent.click(screen.getByRole('button',{name:'Save & Next'}));
  await screen.findByRole('button',{name:'Save & Finish'});
  fireEvent.click(screen.getByRole('button',{name:'Clock evidence reviewed'}));
  fireEvent.click(screen.getByRole('button',{name:'Save & Finish'}));
  await waitFor(()=>expect(close).toHaveBeenCalledTimes(2));
  expect(mocks.decideTime).toHaveBeenCalledTimes(3);
});

it('offers published roster hours explicitly without approving a missing proposal, and preserves editable reason', async () => {
  mocks.decideTime.mockClear().mockResolvedValue({});
  const missing = {...row,proposed_minutes:null,actual_minutes:null,issue_codes:['missing_punch'],evidence:{...row.evidence,roster_publication_id:'published',roster_entry_id:'shift',roster_entry_type:'working'}};
  const refresh = vi.fn(async () => [{...missing,id:'saved',status:'approved_manual',approved_minutes:480}]);
  render(<PayrollPayableTimeReview employee={{...employee,time:[missing]}} month="2026-09" canManage onClose={()=>{}} onDecisionSaved={refresh} />);
  fireEvent.click(screen.getByRole('button',{name:'Continue Review'}));
  expect(screen.queryByRole('button',{name:'Approve proposed time'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Adjust Payable Time'}));
  fireEvent.click(screen.getByRole('button',{name:'Approve Roster Hours'}));
  expect(screen.getByRole('spinbutton',{name:/Approved payable minutes/}).value).toBe('480');
  expect(screen.getByRole('button',{name:'Save & Finish'}).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Roster hours verified'}));
  fireEvent.change(screen.getByRole('textbox',{name:/Decision reason/}),{target:{value:'QA roster hours independently verified'}});
  fireEvent.click(screen.getByRole('button',{name:'Save & Finish'}));
  await waitFor(()=>expect(mocks.decideTime).toHaveBeenCalledWith(expect.objectContaining({action:'adjust',approvedMinutes:480,classification:'regular',reason:'QA roster hours independently verified'})));
});

it('rejects explicitly at zero and does not offer unpublished roster or null proposal approval',async()=>{
  mocks.decideTime.mockClear().mockResolvedValue({});
  const missing={...row,proposed_minutes:null,issue_codes:['missing_punch']};
  render(<PayrollPayableTimeReview employee={{...employee,time:[missing]}} month="2026-09" canManage onClose={()=>{}} onDecisionSaved={async()=>[{...missing,status:'non_payable',approved_minutes:0}]} />);
  fireEvent.click(screen.getByRole('button',{name:'Continue Review'}));
  fireEvent.click(screen.getByRole('button',{name:'Adjust Payable Time'}));
  expect(screen.queryByRole('button',{name:'Approve Roster Hours'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Approve proposed time'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Reject / Non-payable'}));
  fireEvent.click(screen.getByRole('button',{name:'Absence confirmed'}));
  fireEvent.click(screen.getByRole('button',{name:'Save & Finish'}));
  await waitFor(()=>expect(mocks.decideTime).toHaveBeenCalledWith(expect.objectContaining({action:'reject',approvedMinutes:0,extraMinutes:0,classification:'non_payable'})));
});

it('retains a real zero proposal and requires canonical read-back before advancing',async()=>{
  mocks.decideTime.mockClear().mockResolvedValue({});
  const zero={...row,proposed_minutes:0};
  render(<PayrollPayableTimeReview employee={{...employee,time:[zero]}} month="2026-09" canManage onClose={()=>{}} onDecisionSaved={async()=>[zero]} />);
  fireEvent.click(screen.getByRole('button',{name:'Continue Review'}));
  expect(screen.getByRole('button',{name:'Approve proposed time'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Clock evidence reviewed'}));
  fireEvent.click(screen.getByRole('button',{name:'Save & Finish'}));
  await screen.findByRole('alert');
  expect(screen.getByRole('button',{name:'Refresh Review'})).toBeTruthy();
  expect(mocks.decideTime).toHaveBeenCalledWith(expect.objectContaining({approvedMinutes:0}));
});

it('corrects a reviewed date with a new mandatory reason and preserves the review screen',async()=>{
 mocks.decideTime.mockClear().mockResolvedValue({});
 const saved={...row,status:'approved_manual',approved_minutes:390,history:[{id:'time',revision:2,status:'approved_manual',approved_minutes:390,reason:'Original approved reason'}]};
 const close=vi.fn(); const refreshed=vi.fn(async()=>[{...saved,id:'corrected',approved_minutes:300}]);
 render(<PayrollPayableTimeReview employee={{...employee,time:[saved]}} runId="run" month="2026-09" canManage onClose={close} onDecisionSaved={refreshed}/>);
 fireEvent.click(screen.getByRole('button',{name:'Correct Decision'}));
 expect(screen.getByRole('textbox',{name:'Correction reason *'}).value).toBe('');
 expect(screen.getByRole('button',{name:'Save Correction'}).disabled).toBe(true);
 fireEvent.change(screen.getByRole('spinbutton',{name:/Approved payable minutes/}),{target:{value:'300'}});
 fireEvent.change(screen.getByRole('textbox',{name:/Correction reason/}),{target:{value:'Corrected after evidence review'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Correction'}));
 await waitFor(()=>expect(mocks.decideTime).toHaveBeenCalledWith(expect.objectContaining({runId:'run',correction:true,approvedMinutes:300,reason:'Corrected after evidence review'})));
 await screen.findByRole('button',{name:'Correct Decision'}); expect(close).not.toHaveBeenCalled();
});
