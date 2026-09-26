import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProfilesTab, lastPayChange } from '../PayrollPage.jsx';
vi.mock('../../../../services/payrollService.js', () => ({ payrollService: {} }));
afterEach(cleanup);
const base = { effective_from: '2020-01-01', pay_basis: 'monthly', basic_salary: 2000, currency: 'MYR' };
const data = {
  legal_entities: [{id:'le',name:'Employer'}],
  employees: [{id:'e',name:'Employee One',employee_code:'E001',workplace:'Management',joined_date:'2020-01-02',legal_entity_id:'le'}],
  components: [{id:'a',name:'Meal Allowance',component_type:'allowance'},{id:'d',name:'Deduction',component_type:'deduction'}],
  profiles: [{employee_id:'e',compensation:[base],statutory_setup:{status:'Scheduled Change',display_schemes:{
    epf:{state:'confirmed',applicable:true,category:'malaysian_under_60'},
    socso:{state:'not_applicable',applicable:false},
    eis:{state:'confirmation_required',applicable:true},
    pcb:{state:'scheduled',applicable:true,effective_from:'2099-01-01'},
  }},recurring:[{component_id:'a',effective_from:'2020-01-01',is_active:true,amount:100},
    {component_id:'a',effective_from:'2099-01-01',is_active:false,amount:0},
    {component_id:'d',effective_from:'2020-01-01',is_active:true,amount:50}]}],
};
describe('Payroll employee registry',()=>{
  it('uses joined/current effective pay, resolved scheme semantics and recurring assignments',()=>{
    render(<ProfilesTab data={data} reload={vi.fn()} />);
    expect(screen.getByText('2 Jan 2020')).toBeTruthy();
    expect(screen.getByText(/2,000.00/)).toBeTruthy();
    expect(screen.getByText('1 Jan 2020')).toBeTruthy();
    expect(screen.getByRole('button',{name:'EPF — Malaysian · under 60'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'SOCSO — Not Applicable'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'EIS — Confirmation Required'})).toBeTruthy();
    const future = screen.getByRole('button',{name:/PCB.*Scheduled.*Effective 1 Jan 2099/});
    fireEvent.focus(future);
    expect(screen.getByRole('tooltip').textContent).toContain('Scheduled');
    fireEvent.keyDown(future,{key:'Escape'});
    expect(screen.queryByRole('tooltip')).toBeNull();
    const components = screen.getByRole('button',{name:/Meal Allowance[\s\S]*Deduction/});
    expect(components.textContent).toBe('+1 / −1');
    fireEvent.mouseEnter(components);
    expect(screen.getByRole('tooltip').textContent).toContain('100.00');
    expect(screen.queryByText('Statutory Readiness')).toBeNull();
  });
  it('shows missing setup and no active components without inventing evidence',()=>{
    render(<ProfilesTab data={{...data,profiles:[]}} reload={vi.fn()} />);
    expect(screen.getByRole('button',{name:'EPF — Setup Required'})).toBeTruthy();
    expect(screen.getByText('None')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox',{name:'Search'}),{target:{value:'unknown'}});
    expect(screen.getByText('No employees match these filters.')).toBeTruthy();
  });
  it('does not call future or unchanged compensation a current pay change',()=>{
    expect(lastPayChange([base,{...base,effective_from:'2021-01-01'}, {...base,effective_from:'2099-01-01',basic_salary:3000}], '2026-09-26')).toBe('2020-01-01');
  });
  it('keeps entity/status filters and future or stopped components scoped',()=>{
    const fixture = {...data,legal_entities:[...data.legal_entities,{id:'other',name:'Other Employer'}],
      employees:[...data.employees,{id:'other',name:'Other Employee',legal_entity_id:'other'}],
      profiles:[{...data.profiles[0],recurring:[{component_id:'a',effective_from:'2099-01-01',is_active:true,amount:100},
        {component_id:'d',effective_from:'2020-01-01',is_active:false,amount:0}]}]};
    render(<ProfilesTab data={fixture} reload={vi.fn()} />);
    expect(screen.queryByText('Other Employee')).toBeNull();
    expect(screen.getByText('None')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'All',exact:true}));
    fireEvent.click(screen.getByRole('button',{name:'Ready',exact:true}));
    expect(screen.getByText('No employees match these filters.')).toBeTruthy();
  });
});
