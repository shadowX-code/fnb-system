import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import PayrollPhStatutory from '../PayrollPhStatutory.jsx';
const service=vi.hoisted(()=>({readPhStatutory:vi.fn(),confirmPhStatutory:vi.fn()}));
vi.mock('../../../../services/payrollService.js',()=>({payrollService:service}));
const row={date:'2026-09-16',context_fingerprint:'server-current',issues:['ph_eligibility_review_required'],context:{compensation:{pay_basis:'hourly'},time:null,company_policy:null},review:null};
beforeEach(()=>{vi.clearAllMocks();service.readPhStatutory.mockResolvedValue([row]);service.confirmPhStatutory.mockResolvedValue({review_id:'verified'});});
afterEach(cleanup);
describe('canonical PH evidence review',()=>{
 it('keeps missing legal evidence explicit and submits historical wage inputs without computing amounts',async()=>{
  const changed=vi.fn();render(<PayrollPhStatutory runId="run" employeeId="employee" canManage onChanged={changed}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Verify PH Entitlement'}));
  expect(screen.getByText(/2026-08-01 – 2026-08-31/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Preceding qualifying wages (RM)'),{target:{value:'1600'}});
  fireEvent.change(screen.getByLabelText('Preceding qualifying worked days'),{target:{value:'20'}});
  fireEvent.change(screen.getByLabelText('Official / contract / wage evidence reference'),{target:{value:'Official Act265 + verified contract and August ledger'}});
  fireEvent.change(screen.getByLabelText('Review / correction reason'),{target:{value:'Verified actual evidence'}});
  fireEvent.click(screen.getByRole('button',{name:'Confirm PH Evidence'}));
  await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));
  const input=service.confirmPhStatutory.mock.calls[0][0];
  expect(input.context_fingerprint).toBe('server-current');expect(input.evidence.preceding_period_end).toBe('2026-08-31');expect(input.evidence.preceding_qualifying_wages).toBe('1600');expect(input.amount).toBeUndefined();
 });
 it('displays changed evidence and keeps finalized read-only',async()=>{
  service.readPhStatutory.mockResolvedValue([{...row,issues:['ph_eligibility_evidence_changed'],review:{id:'r',official_reference:'Original ledger',reason:'Previous review',created_at:'2026-10-04'}}]);
  render(<PayrollPhStatutory runId="run" employeeId="employee" canManage={false}/>);
  expect(await screen.findByText(/evidence changed/)).toBeTruthy();expect(screen.queryByRole('button',{name:/Verify PH|Review \/ Correct/})).toBeNull();expect(screen.getByText(/Original ledger/)).toBeTruthy();
 });
 it('surfaces server validation and retains the review for correction',async()=>{
  service.confirmPhStatutory.mockRejectedValue(new Error('PH review incomplete: normal hours required'));
  render(<PayrollPhStatutory runId="run" employeeId="employee" canManage/>);fireEvent.click(await screen.findByRole('button',{name:'Verify PH Entitlement'}));
  fireEvent.change(screen.getByLabelText('Official / contract / wage evidence reference'),{target:{value:'Verified contract reference'}});fireEvent.change(screen.getByLabelText('Review / correction reason'),{target:{value:'Review correction'}});fireEvent.click(screen.getByRole('button',{name:'Confirm PH Evidence'}));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent','PH review incomplete: normal hours required');expect(screen.getByRole('button',{name:'Confirm PH Evidence'})).toBeTruthy();
 });
});
