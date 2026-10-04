import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import PayrollPhStatutory from '../PayrollPhStatutory.jsx';
const service=vi.hoisted(()=>({readPhStatutory:vi.fn(),confirmPhStatutory:vi.fn(),readPhProfile:vi.fn(),savePhProfile:vi.fn(),savePhHistoricalWages:vi.fn()}));
vi.mock('../../../../services/payrollService.js',()=>({payrollService:service}));
const profile={status:'verified',profile_status:'verified',issues:[],basis:{legal_entity_id:'entity'},revision:{id:'profile'},wages:{status:'verified',origin:'payroll'}};
const row={date:'2026-09-16',context_fingerprint:'server-current',issues:['ph_occurrence_review_required'],profile,context:{compensation:{pay_basis:'hourly'},time:{status:'approved_manual',approved_minutes:480,scheduled_minutes:480,actual_minutes:null},source:{leave_type:null},company_policy:null},review:null};
beforeEach(()=>{vi.clearAllMocks();service.readPhStatutory.mockResolvedValue([row]);service.confirmPhStatutory.mockResolvedValue({review_id:'verified'});});
afterEach(cleanup);
describe('PH occurrence review consumes reusable profile',()=>{
 it('submits day intent only and never asks for statutory pricing internals',async()=>{
  const changed=vi.fn();render(<PayrollPhStatutory runId="run" employeeId="employee" canManage onChanged={changed}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Review Holiday'}));
  expect(screen.queryByLabelText('First Schedule coverage')).toBeNull();expect(screen.queryByText(/Preceding qualifying wages/)).toBeNull();expect(screen.getByText('Historical wages: Derived from canonical Payroll')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Decision / correction reason'),{target:{value:'Verified actual day evidence'}});
  fireEvent.click(screen.getByRole('button',{name:'Confirm Holiday Decision'}));
  await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));
  const input=service.confirmPhStatutory.mock.calls[0][0];expect(input.context_fingerprint).toBe('server-current');expect(input.decision).toBe('keep_approved');expect(input.evidence).toBeUndefined();expect(input.amount).toBeUndefined();
 });
 it('requires an explicit roster decision; missing Attendance is not approval',async()=>{
  service.readPhStatutory.mockResolvedValue([{...row,context:{...row.context,time:{status:'review_required',scheduled_minutes:480}}}]);
  render(<PayrollPhStatutory runId="run" employeeId="employee" canManage/>);fireEvent.click(await screen.findByRole('button',{name:'Review Holiday'}));
  fireEvent.click(screen.getByRole('button',{name:'Select day decision'}));expect(screen.queryByRole('button',{name:'Confirm approved payable time'})).toBeNull();expect(screen.getByRole('button',{name:'Approve Roster Hours'})).toBeTruthy();expect(screen.getByRole('button',{name:'Confirm Holiday Decision'}).disabled).toBe(true);
 });
 it('displays changed evidence and keeps finalized read-only',async()=>{
  service.readPhStatutory.mockResolvedValue([{...row,issues:['ph_eligibility_evidence_changed'],review:{id:'r',official_reference:'Original ledger',reason:'Previous review',created_at:'2026-10-04'}}]);
  render(<PayrollPhStatutory runId="run" employeeId="employee" canManage={false}/>);expect(await screen.findByText(/evidence changed/)).toBeTruthy();expect(screen.queryByRole('button',{name:/Review Holiday/})).toBeNull();expect(screen.getByText(/Original ledger/)).toBeTruthy();
 });
 it('surfaces server validation and retains the same day for correction',async()=>{
  service.confirmPhStatutory.mockRejectedValue(new Error('PH work premium requires review'));
  render(<PayrollPhStatutory runId="run" employeeId="employee" canManage/>);fireEvent.click(await screen.findByRole('button',{name:'Review Holiday'}));fireEvent.change(screen.getByLabelText('Decision / correction reason'),{target:{value:'Reviewed actual day'}});fireEvent.click(screen.getByRole('button',{name:'Confirm Holiday Decision'}));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent','PH work premium requires review');expect(screen.getByText('Review Paid Holiday · 2026-09-16')).toBeTruthy();
 });
 it('returns from one reusable setup to the same holiday and reuses it for a second date',async()=>{
  const missing={...profile,status:'review_required',profile_status:'review_required',issues:['ph_pay_profile_required']};
  service.readPhStatutory.mockResolvedValueOnce([{...row,profile:missing},{...row,date:'2026-09-17',profile:missing}]).mockResolvedValue([{...row},{...row,date:'2026-09-17'}]);
  service.readPhProfile.mockResolvedValue({basis_fingerprint:'basis',basis:{employment_type:'full_time',pay_basis:'monthly',derived:{coverage:'full_time',normal_minutes:480,normal_weekly_minutes:2400}},compensation:{pay_basis:'monthly'},evidence:{coverage:'full_time',schedule_category:'general'},issues:[],history:[]});service.savePhProfile.mockResolvedValue({id:'profile'});
  render(<PayrollPhStatutory runId="run" employeeId="employee" canManage/>);fireEvent.click((await screen.findAllByRole('button',{name:'Review Holiday'}))[0]);fireEvent.click(screen.getByRole('button',{name:'Setup PH Pay Profile'}));
  fireEvent.change(await screen.findByLabelText('Evidence / contract reference'),{target:{value:'Signed employment contract'}});fireEvent.change(screen.getByLabelText('Confirmation / correction reason'),{target:{value:'Verified reusable evidence'}});fireEvent.click(screen.getByRole('button',{name:'Confirm PH Pay Profile'}));
  expect(await screen.findByText('Review Paid Holiday · 2026-09-16')).toBeTruthy();expect(screen.queryByRole('button',{name:'Setup PH Pay Profile'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Cancel'}));fireEvent.click(screen.getAllByRole('button',{name:'Review Holiday'})[1]);expect(screen.getByText('Review Paid Holiday · 2026-09-17')).toBeTruthy();expect(screen.queryByRole('button',{name:'Setup PH Pay Profile'})).toBeNull();expect(service.savePhProfile).toHaveBeenCalledTimes(1);
 });
 it('blocks occurrence save while reusable setup is missing',async()=>{
  service.readPhStatutory.mockResolvedValue([{...row,profile:{...profile,status:'review_required',profile_status:'review_required',issues:['ph_pay_profile_required']}}]);
  render(<PayrollPhStatutory runId="run" employeeId="employee" canManage/>);fireEvent.click(await screen.findByRole('button',{name:'Review Holiday'}));expect(screen.getByRole('button',{name:'Setup PH Pay Profile'})).toBeTruthy();expect(screen.getByRole('button',{name:'Confirm Holiday Decision'}).disabled).toBe(true);
 });
});
