import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { vi,it,expect } from 'vitest';
import PayrollPayslipPayment from '../PayrollPayslipPayment.jsx';
import { payrollService } from '../../../../services/payrollService.js';
vi.mock('../../../../services/payrollService.js',()=>({payrollService:{readPayment:vi.fn(),recordPayment:vi.fn(),openPayslip:vi.fn()}}));
it('shows current settlement separately and records evidence without recalculation',async()=>{
 payrollService.readPayment.mockResolvedValue({current:true,can_record:true,payslip_available:true,settlement:{amount_due:100,paid_amount:25,outstanding_amount:75,overpaid_amount:0,status:'partially_paid',entitlement_change:0,entries:[]}});
 payrollService.recordPayment.mockResolvedValue({});
 render(<PayrollPayslipPayment runId="run" employeeId="employee" />);
 expect(await screen.findByText('Partially Paid')).toBeTruthy();
 fireEvent.click(screen.getByText('Record Settlement'));
 fireEvent.change(screen.getByLabelText(/Amount/),{target:{value:'75'}});
 fireEvent.click(screen.getByText('Record Evidence'));
 await waitFor(()=>expect(payrollService.recordPayment).toHaveBeenCalledWith(expect.objectContaining({amount:'75',kind:'payment',runId:'run',employeeId:'employee'})));
});
