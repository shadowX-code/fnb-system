import { render,screen,fireEvent } from '@testing-library/react';
import { it,expect,vi } from 'vitest';
import CrewPayslipsMobile from '../CrewPayslipsMobile.jsx';
import { payrollService } from '../../../../services/payrollService.js';
vi.mock('../../../../services/payrollService.js',()=>({payrollService:{crewPayslips:vi.fn(),openPayslip:vi.fn()}}));
vi.mock('react-i18next',async original=>({...await original(),useTranslation:()=>({t:key=>key,i18n:{resolvedLanguage:'en'}})}));
it('uses period and opaque session only, with no revision or employee selector',async()=>{
 payrollService.crewPayslips.mockResolvedValue({payslips:[{period_id:'period',period_start:'2026-06-01',net_pay:100,available:true}]});
 payrollService.openPayslip.mockResolvedValue({document_url:'https://private.test/pdf',download_url:'https://private.test/download',file_name:'Payslip_2026-06_陈 美 琪.pdf'});
 render(<CrewPayslipsMobile token="opaque" onBack={()=>{}} />);
 fireEvent.click(await screen.findByText('payslips.view'));
 expect(payrollService.openPayslip).toHaveBeenCalledWith({token:'opaque',periodId:'period'});
 const download=await screen.findByRole('link',{name:'payslips.download'});
 expect(download.getAttribute('href')).toBe('https://private.test/download');
 expect(download.getAttribute('download')).toBe('Payslip_2026-06_陈 美 琪.pdf');
 expect(screen.queryByText(/Revision|Superseded/)).toBeNull();
});
