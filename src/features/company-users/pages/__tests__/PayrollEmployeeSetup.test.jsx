import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
const mocks=vi.hoisted(()=>({ readStatutoryInput:vi.fn(),recommendStatutory:vi.fn(),confirmStatutoryRecommendation:vi.fn(),reviewStatutoryInput:vi.fn(),adjustRecurring:vi.fn() }));
vi.mock('../../../../services/payrollService.js',()=>({ payrollService:mocks }));
import { StatutoryCategoryForm } from '../PayrollPage.jsx';
import Components, { componentTimeline } from '../PayrollEmployeeComponents.jsx';
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.readStatutoryInput.mockResolvedValue({versions:[]});
  mocks.recommendStatutory.mockResolvedValue({categories:{epf:'malaysian_under_60',socso:'first_category_base',eis:'standard'},issues:{},effective_from:'2026-09-26',fingerprint:'trusted',can_confirm:true});
});
afterEach(cleanup);
describe('Payroll employee setup',()=>{
  it('confirms server recommendation without repetitive source/reason inputs',async()=>{
    const saved=vi.fn(),close=vi.fn();
    render(<StatutoryCategoryForm profile={{id:'p',employee_name:'QA'}} onSaved={saved} onClose={close} />);
    await screen.findByText('System Recommendation');
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Confirm Recommendation'}));
    await vi.waitFor(()=>expect(close).toHaveBeenCalled());
    expect(mocks.confirmStatutoryRecommendation).toHaveBeenCalledWith('p','trusted');
    expect(saved).toHaveBeenCalled();
  });
  it('insufficient evidence disables confirmation and override requires evidence/reason',async()=>{
    mocks.recommendStatutory.mockResolvedValueOnce({categories:{epf:null},issues:{epf:'epf_birthdate_unverified'},effective_from:'2026-09-26',can_confirm:false});
    render(<StatutoryCategoryForm profile={{id:'p'}} onSaved={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText(/Needs evidence/);
    expect(screen.getByRole('button',{name:'Confirm Recommendation'}).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Override / Provide Evidence'}));
    expect(screen.getByRole('button',{name:'Save Override'}).disabled).toBe(true);
    expect(screen.getByRole('textbox',{name:/Evidence \/ source/})).not.toBeNull();
    expect(screen.getByRole('textbox',{name:/Override reason/})).not.toBeNull();
  });
  it('keeps historical amount independent of scheduled change/stop',()=>{
    const versions=[{effective_from:'2026-01-01',amount:100,is_active:true},{effective_from:'2026-10-01',amount:200,is_active:true},{effective_from:'2026-11-01',amount:0,is_active:false}];
    expect(componentTimeline(versions,'2026-07-31').current.amount).toBe(100);
    expect(componentTimeline(versions,'2026-09-26').upcoming).toHaveLength(2);
    expect(componentTimeline(versions,'2026-11-01').current.is_active).toBe(false);
  });
  it('shows component history and exposes append-only Change Amount and Stop',async()=>{
    render(<Components date="2026-09-26" profile={{id:'p',employee_name:'QA',recurring:[{id:'v1',component_id:'c',effective_from:'2026-01-01',amount:100,is_active:true,reason:'Original'},{id:'v2',component_id:'c',effective_from:'2026-10-01',amount:200,is_active:true,reason:'Scheduled'}]}}
      components={[{id:'c',name:'Allowance',component_type:'allowance',is_active:true}]} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText('Scheduled change')).not.toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'View'}));
    expect(screen.getByText('Future Changes')).not.toBeNull();
    expect(screen.getByText('Effective-dated History')).not.toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Stop Component'}));
    expect(screen.getByRole('button',{name:'Stop Component'}).disabled).toBe(true);
    expect(screen.getByText(/scheduled changes cannot overlap/)).not.toBeNull();
  });
});
