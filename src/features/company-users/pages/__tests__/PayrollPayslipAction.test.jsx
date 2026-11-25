import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { vi, it, expect, afterEach } from 'vitest';
import PayrollPayslipAction from '../PayrollPayslipAction.jsx';
import { payrollService } from '../../../../services/payrollService.js';
vi.mock('../../../../services/payrollService.js',()=>({payrollService:{openPayslip:vi.fn()}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('opens current Admin draft without settlement controls',async()=>{
 payrollService.openPayslip.mockResolvedValue({document_url:'https://example.test/pdf?ticket=1',download_url:'https://example.test/pdf?ticket=1&download=1',file_name:'Payslip_2026-09_陈 美 琪_DRAFT.pdf'});
 render(<PayrollPayslipAction runId="run" employeeId="employee" draft />);
 fireEvent.click(screen.getByRole('button',{name:'Draft Payslip'}));
 expect((await screen.findByTitle('Draft Payslip')).getAttribute('src')).toBe('https://example.test/pdf?ticket=1');
 expect(screen.getByRole('link',{name:'Open Draft Payslip'}).getAttribute('href')).toBe('https://example.test/pdf?ticket=1');
 const download=screen.getByRole('link',{name:'Download Draft Payslip'});
 expect(download.getAttribute('href')).toBe('https://example.test/pdf?ticket=1&download=1');
 expect(download.getAttribute('download')).toBe('Payslip_2026-09_陈 美 琪_DRAFT.pdf');
 expect(payrollService.openPayslip).toHaveBeenCalledWith({runId:'run',employeeId:'employee',draft:true});
 expect(screen.getByText(/DRAFT · NOT FINAL/)).toBeTruthy();
 expect(screen.queryByText(/Settlement/)).toBeNull();
});
it('uses the private Final Payslip path',async()=>{
 payrollService.openPayslip.mockResolvedValue({document_url:'https://example.test/private'});
 render(<PayrollPayslipAction runId="final" employeeId="employee" />);
 fireEvent.click(screen.getByRole('button',{name:'Payslip'}));
 expect(await screen.findByTitle('Payslip')).toBeTruthy();
 expect(payrollService.openPayslip).toHaveBeenCalledWith({runId:'final',employeeId:'employee',draft:false});
});
it('shows read failure and retry instead of a fake document',async()=>{
 payrollService.openPayslip.mockRejectedValue(new Error('Refresh Employee Calculation'));
 render(<PayrollPayslipAction runId="run" employeeId="employee" draft />);
 fireEvent.click(screen.getByRole('button',{name:'Draft Payslip'}));
 expect((await screen.findByRole('alert')).textContent).toContain('Refresh Employee Calculation');
 expect(screen.queryByTitle('Draft Payslip')).toBeNull();
});
