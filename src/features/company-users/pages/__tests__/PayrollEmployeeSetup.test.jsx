import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
const mocks=vi.hoisted(()=>({ readStatutorySetup:vi.fn(),confirmStatutorySetup:vi.fn(),adjustRecurring:vi.fn() }));
vi.mock('../../../../services/payrollService.js',()=>({ payrollService:mocks }));
import StatutorySetup, { statutorySchemeLabel, statutorySetupHelp } from '../PayrollStatutorySetup.jsx';
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
    await screen.findByText(/Act 4 · First Category/);
    expect(screen.queryByRole('textbox',{name:/Evidence \/ source/})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Confirm Statutory Setup'}));
    await vi.waitFor(()=>expect(close).toHaveBeenCalled());
    expect(mocks.confirmStatutorySetup).toHaveBeenCalledWith(expect.objectContaining({profileId:'p',fingerprint:'trusted',categories:{socso:'first_category_base',eis:'standard'}}));
    expect(screen.queryByText('EPF category')).toBeNull();
    expect(saved).toHaveBeenCalled();
  });
  it('insufficient evidence explains the missing fact and expands only Complete Setup guidance',async()=>{
    mocks.readStatutorySetup.mockResolvedValue({history:{applicability:[],categories:[]},applicability:{epf:true,socso:false,eis:false,pcb:false},schemes:{epf:{issue:'epf_birthdate_unverified'}},next_effective_from:'2026-09-28',fingerprint:'trusted'});
    render(<StatutorySetup profile={{id:'p'}} onSaved={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText(/Confirm a valid date of birth/);
    expect(screen.getByRole('button',{name:'Confirm Statutory Setup'}).disabled).toBe(true);
    expect(screen.queryByRole('textbox',{name:/evidence|reason/i})).toBeNull();
    expect(screen.queryByRole('button',{name:'Override'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Complete Setup'}));
    expect(screen.getByText(/Correct missing or inaccurate identity information/)).not.toBeNull();
  });
  it('requires evidence only after changing a recommendation, and clears it when restored',async()=>{
    render(<StatutorySetup profile={{id:'p'}} onSaved={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText(/Act 4 · First Category/);
    fireEvent.click(screen.getAllByRole('button',{name:'Override',exact:true})[0]);
    expect(screen.queryByRole('textbox',{name:/Supporting evidence/})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'SOCSO category'}));
    fireEvent.click(screen.getByRole('button',{name:'Act 4 · Second Category'}));
    expect(screen.getByRole('textbox',{name:/Supporting evidence \/ source/})).not.toBeNull();
    expect(screen.getByRole('textbox',{name:/Override reason/})).not.toBeNull();
    expect(screen.getByRole('button',{name:'Confirm Statutory Setup'}).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Use recommendation'}));
    expect(screen.queryByRole('textbox',{name:/Supporting evidence/})).toBeNull();
    expect(screen.getByRole('button',{name:'Confirm Statutory Setup'}).disabled).toBe(false);
  });
  it('Off to On immediately resolves canonical evidence and does not add PCB category',async()=>{
    mocks.readStatutorySetup.mockImplementation((id,date,input)=>Promise.resolve({history:{applicability:[],categories:[]},applicability:input || {epf:false,socso:false,eis:false,pcb:false},schemes:{epf:input?.epf?{recommendation:'malaysian_under_60'}:{state:'not_applicable'},pcb:{state:'not_applicable'}},next_effective_from:'2026-09-28',fingerprint:'trusted'}));
    render(<StatutorySetup profile={{id:'p'}} onSaved={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole('button',{name:'EPF applicability'});
    fireEvent.click(screen.getByRole('button',{name:'EPF applicability'}));
    fireEvent.click(screen.getByRole('button',{name:'Applicable',exact:true}));
    await screen.findByText(/Malaysian · under 60/);
    expect(mocks.readStatutorySetup).toHaveBeenLastCalledWith('p','2026-09-28',expect.objectContaining({epf:true}));
    expect(screen.queryByRole('textbox',{name:/evidence|reason/i})).toBeNull();
    expect(screen.queryByRole('button',{name:'PCB category'})).toBeNull();
  });
  it('distinguishes unsupported existing evidence from missing evidence',()=>{
    expect(statutorySetupHelp('socso_age_category_review_required',{birthday:'2017-02-01'})).toContain('2017-02-01');
    expect(statutorySetupHelp('eis_prior_contribution_history_unverified')).toContain('Prior contribution history');
    expect(statutorySetupHelp('epf_citizenship_category_unverified',{nationality:'Other'})).toContain('outside the currently supported');
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
