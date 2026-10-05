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
  expect(screen.getByText('Resolved automatically')).toBeTruthy();
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
  fireEvent.click((screen.queryByRole('button',{name:'Decision'}) || screen.getByRole('button',{name:/^(Adjust Payable Time|Approve proposed time)$/})));
  fireEvent.click((screen.queryByRole('option',{name:'Adjust Payable Time'}) || screen.getAllByRole('button',{name:'Adjust Payable Time'}).at(-1)));
  fireEvent.click((screen.queryByRole('button',{name:'Decision'}) || screen.getByRole('button',{name:/^(Adjust Payable Time|Approve proposed time)$/})));
  fireEvent.click((screen.queryByRole('option',{name:'Approve Roster Hours'}) || screen.getAllByRole('button',{name:'Approve Roster Hours'}).at(-1)));
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
  fireEvent.click((screen.queryByRole('button',{name:'Decision'}) || screen.getByRole('button',{name:/^(Adjust Payable Time|Approve proposed time)$/})));
  fireEvent.click((screen.queryByRole('option',{name:'Adjust Payable Time'}) || screen.getAllByRole('button',{name:'Adjust Payable Time'}).at(-1)));
  expect(screen.queryByRole('button',{name:'Approve Roster Hours'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Approve proposed time'})).toBeNull();
  fireEvent.click((screen.queryByRole('button',{name:'Decision'}) || screen.getByRole('button',{name:/^(Adjust Payable Time|Approve proposed time)$/})));
  fireEvent.click((screen.queryByRole('option',{name:'Reject / Non-payable'}) || screen.getAllByRole('button',{name:'Reject / Non-payable'}).at(-1)));
  fireEvent.click(screen.getByRole('button',{name:'Absence confirmed'}));
  fireEvent.click(screen.getByRole('button',{name:'Save & Finish'}));
  await waitFor(()=>expect(mocks.decideTime).toHaveBeenCalledWith(expect.objectContaining({action:'reject',approvedMinutes:0,extraMinutes:0,classification:'non_payable'})));
});

it('retains a real zero proposal and requires canonical read-back before advancing',async()=>{
  mocks.decideTime.mockClear().mockResolvedValue({});
  const zero={...row,proposed_minutes:0};
  render(<PayrollPayableTimeReview employee={{...employee,time:[zero]}} month="2026-09" canManage onClose={()=>{}} onDecisionSaved={async()=>[zero]} />);
  fireEvent.click(screen.getByRole('button',{name:'Continue Review'}));
  fireEvent.click((screen.queryByRole('button',{name:'Decision'}) || screen.getByRole('button',{name:/^(Adjust Payable Time|Approve proposed time)$/})));
  expect((screen.queryByRole('option',{name:'Approve proposed time'}) || screen.getAllByRole('button',{name:'Approve proposed time'}).at(-1))).toBeTruthy();
  fireEvent.click((screen.queryByRole('option',{name:'Approve proposed time'}) || screen.getAllByRole('button',{name:'Approve proposed time'}).at(-1)));
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

it('shows recorded hours and reason on Previous without making the decision editable', async () => {
  mocks.decideTime.mockClear().mockResolvedValue({});
  const next={...row,id:'next',work_date:'2026-09-26'};
  render(<PayrollPayableTimeReview employee={{...employee,time:[row,next]}} month="2026-09" canManage onClose={()=>{}} onDecisionSaved={async()=>[{...row,id:'saved',status:'approved_manual',approved_minutes:420,approved_extra_minutes:30,decision_reason:'Original verified evidence'},next]} />);
  fireEvent.click(screen.getByRole('button',{name:'Continue Review'}));
  fireEvent.click(screen.getByRole('button',{name:'Clock evidence reviewed'}));
  fireEvent.click(screen.getByRole('button',{name:'Save & Next'}));
  await screen.findByRole('button',{name:'Save & Finish'});
  fireEvent.click(screen.getByRole('button',{name:'Previous'}));
  expect(screen.getByRole('spinbutton',{name:/Approved payable minutes/}).value).toBe('420');
  expect(screen.getByRole('spinbutton',{name:/Approved extra/}).value).toBe('30');
  const reason=screen.getByRole('textbox',{name:/Decision reason/});
  expect(reason.value).toBe('Original verified evidence');
  expect(reason.disabled).toBe(true);
  expect(mocks.decideTime).toHaveBeenCalledTimes(1);
});

it('uses server pay-impact states for Monthly evidence and excludes PH from the generic queue', () => {
  const normal = {...row,id:'normal',status:'review_required',review_state:{required:false,automatic:true,state:'ready'}};
  const absence = {...row,id:'absence',work_date:'2026-09-26',review_state:{required:true,automatic:false,state:'review_required'}};
  const ph = {...row,id:'ph',work_date:'2026-09-16',classification:'public_holiday',review_state:{required:false,automatic:false,state:'ph_review'}};
  render(<PayrollPayableTimeReview employee={{...employee,pay:{pay_basis:'monthly',basic_salary:3000},time:[normal,absence,ph]}} month="2026-09" canManage onClose={()=>{}} />);
  expect(screen.getByText('Resolved automatically')).toBeTruthy();
  expect(screen.getAllByRole('button',{name:'Review exception'})).toHaveLength(1);
  expect(screen.getByText('2026-09-16')).toBeTruthy();
  expect(screen.getByText('PH treatment is separate in Employee Review.')).toBeTruthy();
  expect(screen.queryByText('Approved Payable Hours')).toBeNull();
  expect(screen.queryByText('Hourly Rate')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Continue Review'}));
  expect(screen.getByText('1 of 1 exceptions')).toBeTruthy();
});

it('opens an automatically resolved Monthly day for an explicit audited adjustment', async () => {
 mocks.decideTime.mockClear().mockResolvedValue({});
 const ready={...row,status:'review_required',issue_codes:[],review_state:{required:false,automatic:true,state:'ready'}};
 const close=vi.fn();
 render(<PayrollPayableTimeReview employee={{...employee,pay:{pay_basis:'monthly',basic_salary:3000},time:[ready]}} runId="run" month="2026-09" canManage onClose={close} onDecisionSaved={async()=>[{...ready,status:'approved_manual',approved_minutes:300,review_state:{required:true,automatic:false,state:'ready'}}]} />);
 expect(screen.queryByRole('button',{name:'Continue Review'})).toBeNull();
 fireEvent.click(screen.getAllByRole('button',{name:'Adjust Payable Time'}).at(-1));
 fireEvent.change(screen.getByRole('spinbutton',{name:/Approved payable minutes/}),{target:{value:'300'}});
 fireEvent.change(screen.getByRole('textbox',{name:/Correction reason/}),{target:{value:'Supporting evidence confirms short attendance'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Correction'}));
 await waitFor(()=>expect(mocks.decideTime).toHaveBeenCalledWith(expect.objectContaining({correction:false,approvedMinutes:300,runId:'run'})));
 await screen.findByRole('button',{name:'Correct Decision'});
 expect(close).not.toHaveBeenCalled();
});
it('keeps approved unpaid Leave source-owned and finalized evidence read-only', () => {
 const leave={...row,status:'non_payable',approved_minutes:0,evidence:{leave_id:'leave',leave_type:'unpaid'},review_state:{required:false,automatic:true,state:'ready'}};
 const view=render(<PayrollPayableTimeReview employee={{...employee,time:[leave]}} month="2026-09" canManage canViewLeave onClose={()=>{}} />);
 expect(screen.getByText('Approved Unpaid Leave')).toBeTruthy();
 expect(screen.getByRole('link',{name:'View in Leave'}).getAttribute('href')).toBe('/crew/workforce/leave');
 expect(screen.queryByRole('button',{name:'Correct Decision'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Adjust Payable Time'})).toBeNull();
 view.rerender(<PayrollPayableTimeReview employee={{...employee,time:[{...row,status:'approved_manual',approved_minutes:390}]}} month="2026-09" canManage={false} frozen onClose={()=>{}} />);
 expect(screen.queryByRole('button',{name:/Correct Decision|Review exception/})).toBeNull();
 expect(screen.queryByRole('link',{name:'View in Leave'})).toBeNull();
 expect(screen.getByText(/Finalized evidence/)).toBeTruthy();
});
