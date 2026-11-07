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
  fireEvent.click(screen.getByRole('button', {name:'Show details for 2026-09-25'}));
  expect(screen.getByText('Late arrival · Early departure')).toBeTruthy();
  expect(screen.getAllByText('7.50 h')).toHaveLength(2);
  expect(screen.getByText('Proposed 6.50 h')).toBeTruthy();
  expect(screen.getByText(/RM\s*100\.75/)).toBeTruthy();
  expect(screen.getByRole('cell', {name:'Needs Review'})).toBeTruthy();
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
it('keeps an unsupported saved response on the same date without duplicating the decision', async () => {
  mocks.decideTime.mockClear().mockResolvedValue({id:'saved'});
  const close=vi.fn();
  const readBack=vi.fn().mockRejectedValue(new Error('Unsupported decision response. Do not submit another decision; return to Employee Review to reload the saved evidence.'));
  render(<PayrollPayableTimeReview employee={{...employee,time:[row,{...row,id:'next',work_date:'2026-09-26'}]}} runId="run" month="2026-09" canManage onClose={close} onDecisionSaved={readBack} />);
  fireEvent.click(screen.getByRole('button',{name:'Continue Review'}));
  fireEvent.change(screen.getByRole('textbox',{name:/Decision reason/}),{target:{value:'Reviewed evidence'}});
  fireEvent.click(screen.getByRole('button',{name:'Save & Next'}));
  await screen.findByText(/Unsupported decision response/);
  expect(screen.getByText('1 of 2 exceptions')).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Refresh Review'}));
  await waitFor(()=>expect(readBack).toHaveBeenCalledTimes(2));
  expect(mocks.decideTime).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Back to Employee Review'}));
  expect(close).toHaveBeenCalledTimes(1);
});
it('clean days and read-only access do not offer a decision',()=>{
  render(<PayrollPayableTimeReview employee={{...employee,time:[{...row,status:'approved_auto',approved_minutes:390,issue_codes:[]}]}} month="2026-09" canManage={false} onClose={()=>{}} />);
  expect(screen.getByRole('cell', {name:'Approved'})).toBeTruthy();
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
  fireEvent.click(screen.getByRole('button',{name:'Decision'}));
  fireEvent.click(screen.getByRole('option',{name:'Adjust Payable Time'}));
  fireEvent.click(screen.getByRole('button',{name:'Decision'}));
  fireEvent.click(screen.getByRole('option',{name:'Approve Roster Hours'}));
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
  fireEvent.click(screen.getByRole('button',{name:'Decision'}));
  fireEvent.click(screen.getByRole('option',{name:'Adjust Payable Time'}));
  expect(screen.queryByRole('button',{name:'Approve Roster Hours'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Approve proposed time'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Decision'}));
  fireEvent.click(screen.getByRole('option',{name:'Reject / Non-payable'}));
  fireEvent.click(screen.getByRole('button',{name:'Absence confirmed'}));
  fireEvent.click(screen.getByRole('button',{name:'Save & Finish'}));
  await waitFor(()=>expect(mocks.decideTime).toHaveBeenCalledWith(expect.objectContaining({action:'reject',approvedMinutes:0,extraMinutes:0,classification:'non_payable'})));
});

it('retains a real zero proposal and requires canonical read-back before advancing',async()=>{
  mocks.decideTime.mockClear().mockResolvedValue({});
  const zero={...row,proposed_minutes:0};
  render(<PayrollPayableTimeReview employee={{...employee,time:[zero]}} month="2026-09" canManage onClose={()=>{}} onDecisionSaved={async()=>[zero]} />);
  fireEvent.click(screen.getByRole('button',{name:'Continue Review'}));
  fireEvent.click(screen.getByRole('button',{name:'Decision'}));
  expect(screen.getByRole('option',{name:'Approve proposed time'})).toBeTruthy();
  fireEvent.click(screen.getByRole('option',{name:'Approve proposed time'}));
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
  expect(screen.getByText('PH review separate')).toBeTruthy();
  expect(screen.queryByText('Saved Approved Hours')).toBeNull();
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
 fireEvent.click(screen.getByRole('button',{name:'Adjust Payable Time'}));
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
 fireEvent.click(screen.getByRole('button',{name:'Show details for 2026-09-25'}));
 expect(screen.getByRole('link',{name:'View in Leave'}).getAttribute('href')).toBe('/crew/workforce/leave');
 expect(screen.queryByRole('button',{name:'Correct Decision'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Adjust Payable Time'})).toBeNull();
 view.rerender(<PayrollPayableTimeReview employee={{...employee,time:[{...row,status:'approved_manual',approved_minutes:390}]}} month="2026-09" canManage={false} frozen onClose={()=>{}} />);
 expect(screen.queryByRole('button',{name:/Correct Decision|Review exception/})).toBeNull();
 expect(screen.queryByRole('link',{name:'View in Leave'})).toBeNull();
 expect(screen.getByText(/Finalized evidence/)).toBeTruthy();
});

it.each([25, 17])('shows all %s unsynchronized Monthly dates without offering to save a decision', count => {
  const openSync = vi.fn();
  const time = Array.from({length:count}, (_, index) => ({
    ...row, id:`source-${index}`, work_date:`2026-10-${String(index + 1).padStart(2, '0')}`,
    status:'unreconciled', issue_codes:['missing_punch'],
    review_state:{required:true, state:'unreconciled'},
  }));
  render(<PayrollPayableTimeReview employee={{...employee,time,timeExceptionCount:count,pay:{pay_basis:'monthly'}}}
    month="2026-10" canManage onClose={()=>{}} onOpenSynchronization={openSync} />);
  expect(screen.getAllByRole('cell', {name:'Needs Sync'})).toHaveLength(count);
  expect(screen.getAllByText('Missing clock evidence')).toHaveLength(count);
  expect(screen.queryByText(/Time & Attendance — Ready/)).toBeNull();
  expect(screen.queryByRole('button',{name:/Review exception|Continue Review/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Go to Evidence Sync'}));
  expect(openSync).toHaveBeenCalledOnce();
});

it('fails closed when the run has exceptions but daily details are unavailable', () => {
  render(<PayrollPayableTimeReview employee={{...employee,time:[],timeExceptionCount:17}}
    month="2026-10" onClose={()=>{}} />);
  expect(screen.getByText(/Evidence incomplete/)).toBeTruthy();
  expect(screen.queryByText(/Time & Attendance — Ready/)).toBeNull();
});

it('shows a newer published roster alongside the bound roster in Draft review only', () => {
  const time = [{...row, evidence: {...row.evidence, roster_entry_type: 'off'},
    latest_published_roster: {revision: 4, entry_type: 'working', start_time: '17:00', end_time: '22:00', break_minutes: 0}}];
  const props = {employee: {...employee, time}, month: '2026-09', canManage: true, onClose: vi.fn()};
  const view = render(<PayrollPayableTimeReview {...props} />);
  expect(screen.queryByText('Latest published roster · Rev 4')).toBeNull();
  fireEvent.click(screen.getByRole('button', {name:'Show details for 2026-09-25'}));
  expect(screen.getByText('Latest published roster · Rev 4')).toBeTruthy();
  expect(screen.getByText(/17:00 – 22:00/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: 'Review exception'}));
  expect(screen.getByText('Roster used for this review')).toBeTruthy();
  expect(screen.getByText('Latest published roster · Rev 4')).toBeTruthy();
  view.unmount();
  render(<PayrollPayableTimeReview {...props} frozen />);
  expect(screen.queryByText('Latest published roster · Rev 4')).toBeNull();
});

it('filters dates without changing the clock totals or hiding approved decision history', () => {
  const time = [row,
    {...row, id:'approved', work_date:'2026-10-02', status:'approved_manual', approved_minutes:285, actual_minutes:1441,
      history:[{id:'v2', status:'approved_manual', approved_minutes:285}]},
    {...row, id:'sync', work_date:'2026-10-03', review_state:{state:'unreconciled',required:true}},
  ];
  render(<PayrollPayableTimeReview employee={{...employee,time}} month="2026-10" canManage onClose={()=>{}} />);
  fireEvent.click(screen.getByRole('button', {name:'Approved 1'}));
  expect(screen.queryByRole('button', {name:'Show details for 2026-10-03'})).toBeNull();
  fireEvent.click(screen.getByRole('button', {name:'Show details for 2026-10-02'}));
  expect(screen.getByText('Approved Manual · 4.75 h')).toBeTruthy();
  expect(screen.getByText('24.02 h across 1 span of 24h or more')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'Needs Sync 1'}));
  expect(screen.getByRole('button', {name:'Show details for 2026-10-03'})).toBeTruthy();
  expect(screen.queryByRole('button', {name:'Correct Decision'})).toBeNull();
});

it('keeps saved approvals visible while changed evidence blocks Regular earnings', () => {
  const time = [{...row,status:'approved_manual',approved_minutes:300,source_state:{updated:true}}];
  render(<PayrollPayableTimeReview employee={{...employee,time,result:{earningsAvailable:true,earningsCurrent:false},
    calculation:{status:'review_required',lines:[],issues:['stale_time_evidence:2026-09-25']}}} month="2026-09" canManage onClose={()=>{}} />);
  expect(screen.getByRole('cell', {name:'Needs Review'})).toBeTruthy();
  expect(screen.getByText('Source Updated')).toBeTruthy();
  expect(screen.getByText('5.00 h Regular · 0.00 h other')).toBeTruthy();
  expect(screen.getByText('Pending')).toBeTruthy();
  expect(screen.getByText('Resolve changed time evidence')).toBeTruthy();
  expect(screen.queryByText(/RM\s*0\.00/)).toBeNull();
});
