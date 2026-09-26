import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
const mocks=vi.hoisted(()=>({ readStatutorySetup:vi.fn(),confirmStatutorySetup:vi.fn(),adjustRecurring:vi.fn() }));
vi.mock('../../../../services/payrollService.js',()=>({ payrollService:mocks }));
import StatutorySetup, { statutorySchemeLabel } from '../PayrollStatutorySetup.jsx';
import Components, { componentTimeline } from '../PayrollEmployeeComponents.jsx';
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.readStatutorySetup.mockResolvedValue({history:{applicability:[],categories:[]},applicability:{epf:false,socso:true,eis:true,pcb:false},schemes:{epf:{state:'not_applicable'},socso:{recommendation:'first_category_base'},eis:{recommendation:'standard'},pcb:{state:'not_applicable'}},next_effective_from:'2026-09-28',fingerprint:'trusted'});
});
afterEach(cleanup);
describe('Payroll employee setup',()=>{
  it('confirms server recommendation without repetitive source/reason inputs',async()=>{
    const saved=vi.fn(),close=vi.fn();
    render(<StatutorySetup profile={{id:'p',employee_name:'QA'}} onSaved={saved} onClose={close} />);
    await screen.findByText('Recommended · Act 4 · First Category');
    expect(screen.queryByRole('textbox',{name:/Evidence \/ source/})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Confirm Setup'}));
    await vi.waitFor(()=>expect(close).toHaveBeenCalled());
    expect(mocks.confirmStatutorySetup).toHaveBeenCalledWith(expect.objectContaining({profileId:'p',fingerprint:'trusted',categories:{socso:'first_category_base',eis:'standard'}}));
    expect(screen.queryByText('EPF category')).toBeNull();
    expect(saved).toHaveBeenCalled();
  });
  it('insufficient evidence disables confirmation and override requires evidence/reason',async()=>{
    mocks.readStatutorySetup.mockResolvedValue({history:{applicability:[],categories:[]},applicability:{epf:true,socso:false,eis:false,pcb:false},schemes:{epf:{issue:'epf_birthdate_unverified'}},next_effective_from:'2026-09-28',fingerprint:'trusted'});
    render(<StatutorySetup profile={{id:'p'}} onSaved={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText(/epf birthdate unverified/);
    expect(screen.getByRole('button',{name:'Confirm Setup'}).disabled).toBe(true);
    expect(screen.getByRole('textbox',{name:/Evidence \/ source/})).not.toBeNull();
    expect(screen.getByRole('textbox',{name:/Setup \/ override reason/})).not.toBeNull();
  });
  it('Not Applicable is terminal and PCB has no category concept',()=>{
    expect(statutorySchemeLabel('epf',{state:'not_applicable'})).toBe('Not Applicable');
    expect(statutorySchemeLabel('pcb',{state:'not_applicable'})).toBe('Not Applicable');
    expect(statutorySchemeLabel('pcb',{state:'confirmed'})).toBe('Applicable · monthly confirmation');
    expect(statutorySchemeLabel('socso',{state:'setup_required'})).toBe('Setup Required');
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
