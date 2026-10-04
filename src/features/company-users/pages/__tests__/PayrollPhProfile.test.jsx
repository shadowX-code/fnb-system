import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import PayrollPhProfile,{PayrollPhHistoricalWages} from '../PayrollPhProfile.jsx';
const service=vi.hoisted(()=>({readPhProfile:vi.fn(),savePhProfile:vi.fn(),savePhHistoricalWages:vi.fn()}));
vi.mock('../../../../services/payrollService.js',()=>({payrollService:service}));
const read={status:'review_required',issues:['ph_pay_profile_required'],basis_fingerprint:'server-basis',basis:{employment_type:'full_time',pay_basis:'monthly',derived:{coverage:'full_time',normal_minutes:480,normal_weekly_minutes:2400}},compensation:{pay_basis:'monthly'},evidence:{coverage:'full_time',normal_minutes:480,normal_weekly_minutes:2400},history:[]};
beforeEach(()=>{vi.clearAllMocks();service.readPhProfile.mockResolvedValue(read);service.savePhProfile.mockResolvedValue({id:'revision'});service.savePhHistoricalWages.mockResolvedValue({id:'wage'});});afterEach(cleanup);
describe('reusable PH Pay Profile',()=>{
 it('derives known category/contract hours and submits effective evidence without employee reactivation',async()=>{
  const saved=vi.fn(),close=vi.fn();render(<PayrollPhProfile employeeId="employee" date="2026-09-16" onSaved={saved} onClose={close}/>);
  await screen.findByText('Dated employment evidence');expect(screen.queryByLabelText('Contractual normal daily minutes')).toBeNull();expect(screen.queryByLabelText('Statutory monthly wage basis (RM)')).toBeNull();
  fireEvent.change(screen.getByLabelText('Evidence / contract reference'),{target:{value:'Signed contract and official evidence'}});fireEvent.change(screen.getByLabelText('Confirmation / correction reason'),{target:{value:'Verified reusable category'}});fireEvent.click(screen.getByRole('button',{name:'Confirm PH Pay Profile'}));await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1));expect(close).toHaveBeenCalledTimes(1);
  const input=service.savePhProfile.mock.calls[0][0];expect(input.effective_from).toBe('2026-09-16');expect(input.basis_fingerprint).toBe('server-basis');expect(input.evidence.normal_minutes).toBe(480);expect(input.employment_status).toBeUndefined();
 });
 it('shows regular part-time comparison only for its category',async()=>{
  service.readPhProfile.mockResolvedValue({...read,basis:{employment_type:'part_time',pay_basis:'hourly',derived:{}},evidence:{coverage:'part_time'},compensation:{pay_basis:'hourly'}});
  render(<PayrollPhProfile employeeId="employee" date="2026-09-16" onClose={()=>{}}/>);expect(await screen.findByLabelText('Comparable full-time daily minutes')).toBeTruthy();expect(screen.getByLabelText('Statutory monthly wage basis (RM)')).toBeTruthy();
 });
 it('confirms one preceding month without repricing or changing old Payroll',async()=>{
  const saved=vi.fn();render(<PayrollPhHistoricalWages employeeId="employee" profile={{basis:{legal_entity_id:'entity'},wages:{period_start:'2026-08-01',period_end:'2026-08-31',source_fingerprint:'historical-source'}}} onSaved={saved} onClose={()=>{}}/>);
  for(const [label,value] of [['Qualifying wages (RM)','1040'],['Qualifying worked days','20'],['Historical wage reference','Original August ledger'],['Historical confirmation / correction reason','Historical evidence confirmed']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.click(screen.getByRole('button',{name:'Confirm Historical Wages'}));await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1));const input=service.savePhHistoricalWages.mock.calls[0][0];expect(input.period_start).toBe('2026-08-01');expect(input.source_fingerprint).toBe('historical-source');expect(input.amount).toBeUndefined();
 });
});
