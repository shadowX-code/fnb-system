import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FoundationForm from '../PayrollCompensationForm.jsx';
import { ProfilesTab } from '../PayrollPage.jsx';
import PayrollRunEmployeesPanel from '../PayrollRunEmployeesPanel.jsx';
import { effectivePay } from '../payrollCompensationPresentation.js';
const mocks = vi.hoisted(()=>({adjustCompensation:vi.fn(),createProfile:vi.fn(),readTime:vi.fn().mockResolvedValue([]),readPcb:vi.fn().mockResolvedValue({results:[]}),readPhWork:vi.fn().mockResolvedValue([])}));
vi.mock('../../../../services/payrollService.js',()=>({payrollService:mocks}));
vi.mock('../../../../services/employeeService.js',()=>({employeeService:{readBankInfo:async()=>[]}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const data={legal_entities:[{id:'le',name:'Employer'}],employees:[{id:'emp',name:'Former Employee',employment_status:'resigned',employment_end_date:'2026-09-30',legal_entity_id:null,legal_entity_ids:['le'],joined_date:'2026-09-01'}],profiles:[{id:'profile',employee_id:'emp',compensation:[{id:'later',effective_from:'2026-10-01',pay_basis:'monthly',basic_salary:3400}],statutory:[]} ]};
it('keeps former employees discoverable by historical employer and status',()=>{
 render(<ProfilesTab data={data} reload={vi.fn()}/>);
 expect(screen.getByText('Former Employee')).toBeTruthy();expect(screen.getByText(/Ended 30 Sep.* 2026/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'All employment'}));fireEvent.click(screen.getByRole('button',{name:'Active',exact:true}));
 expect(screen.queryByText('Former Employee')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Active',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Resigned',exact:true}));
 expect(screen.getByText('Former Employee')).toBeTruthy();
});
it('requires explicit historical rate/date/reason without using later pay',async()=>{
 const saved=vi.fn(); render(<FoundationForm mode="compensation" profile={data.profiles[0]} initialEmployeeId="emp" initialEffectiveFrom="2026-09-01" payrollMonth="2026-09" data={data} onSaved={saved} onClose={vi.fn()}/>);
 expect(screen.getByRole('spinbutton').value).toBe('');
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'3000'}});
 fireEvent.change(screen.getByRole('textbox',{name:/Reason/}),{target:{value:'Verified September contract'}});
 fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
 await waitFor(()=>expect(saved).toHaveBeenCalled());
 expect(mocks.adjustCompensation).toHaveBeenCalledWith(expect.objectContaining({profileId:'profile',effectiveFrom:'2026-09-01',rate:3000,reason:'Verified September contract'}));
 expect(mocks.createProfile).not.toHaveBeenCalled();
});
it('same-date correction resolves latest revision while future pay stays unchanged',()=>{
 const versions=[{id:'old',effective_from:'2026-09-01',revision:1},{id:'new',effective_from:'2026-09-01',revision:2},data.profiles[0].compensation[0]];
 expect(effectivePay(versions,'2026-09-30').id).toBe('new');expect(effectivePay(versions,'2026-10-01').id).toBe('later');expect(versions).toHaveLength(3);
});
it('Run Set up pay saves through shared authority, refreshes the same employee and retains Review',async()=>{
 const refresh=vi.fn().mockResolvedValue({}); const changed=vi.fn();
 const runRead={refresh,data:{calculation:{results:[]},statutory:{results:[]},preparation:{results:[{employee_id:'emp',employment:{identity:{legal_entity_id:'le',workplace:'Outlet'}},projection:{status:'review_required',issues:['missing_effective_compensation_or_proration_policy'],inputs:{compensation_start:null,compensation_end:null},lines:[]},statutory_setup:{schemes:{}}}]}}};
 render(<PayrollRunEmployeesPanel run={{id:'run',status:'draft'}} entityId="le" month="2026-09" canManage data={data} runRead={runRead} onChanged={changed}/>);
 await screen.findByText('Former Employee');fireEvent.click(screen.getByRole('button',{name:'Review',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Set up pay',exact:true}));
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'3000'}});fireEvent.change(screen.getByRole('textbox',{name:/Reason/}),{target:{value:'Verified historical pay'}});fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
 await waitFor(()=>expect(refresh).toHaveBeenCalledWith({retryEmployeeId:'emp'}));
 expect(changed).toHaveBeenCalled();expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(changed.mock.invocationCallOrder[0]);await waitFor(()=>expect(screen.queryByRole('heading',{name:'Edit Pay'})).toBeNull());
 expect(screen.getByRole('heading',{name:'Compensation'})).toBeTruthy();expect(screen.getByRole('heading',{name:'Former Employee'})).toBeTruthy();
});
