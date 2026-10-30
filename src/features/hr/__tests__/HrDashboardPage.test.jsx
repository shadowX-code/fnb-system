import {render,screen,waitFor,fireEvent,cleanup,within} from '@testing-library/react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import HrDashboardPage from '../HrDashboardPage.jsx';
const mocks=vi.hoisted(()=>({employees:vi.fn(),companies:vi.fn(),payroll:vi.fn()}));
vi.mock('../../../services/employeeService.js',()=>({employeeService:{readWorkforce:mocks.employees}}));
vi.mock('../../../services/payrollService.js',()=>({payrollService:{read:mocks.payroll}}));
vi.mock('../../../services/legalEntityService.js',()=>({legalEntityService:{list:mocks.companies}}));
const auth=codes=>({user:{id:'qa'},hasPermission:code=>codes.includes(code)});
const permissions=['employees.view','legal_entities.view','payroll.view'];
afterEach(cleanup);
beforeEach(()=>{
 vi.resetAllMocks();window.history.replaceState(null,'','/hr/dashboard');
 mocks.employees.mockResolvedValue([{id:'a',legal_entity_id:'c1',employment_type:'night_apprentice',employment_status:'active'},{id:'b',legal_entity_id:'c2',employment_type:null,employment_status:'resigned'}]);
 mocks.companies.mockResolvedValue([{id:'c1',display_name:'Company One'},{id:'c2',display_name:'Company Two'}]);
 mocks.payroll.mockResolvedValue({legal_entities:[{id:'c1',name:'Company One'},{id:'c2',name:'Company Two'}],periods:[{id:'p1',legal_entity_id:'c1',period_start:'2026-10-01',runs:[{id:'r1',status:'draft',revision:1}]}]});
});
describe('Workforce Overview',()=>{
 it('never reads an unauthorized domain or Recruitment',async()=>{
  render(<HrDashboardPage auth={auth(['payroll.view','recruitment.view'])}/>);
  await screen.findByText('Open Payroll Run');
  expect(mocks.employees).not.toHaveBeenCalled();expect(mocks.companies).not.toHaveBeenCalled();
  expect(screen.queryByText('Needs attention')).toBeNull();expect(screen.queryByText('Open roles')).toBeNull();
 });
 it('filters all sections by company and routes to canonical filtered Employees',async()=>{
  window.history.replaceState(null,'','/hr/dashboard?company=c2');
  render(<HrDashboardPage auth={auth(permissions)}/>);
  await screen.findByRole('button',{name:'View Company Two employees'});
  expect(screen.queryByText('Night Apprentice')).toBeNull();expect(screen.getByText('No current or open Payroll periods in this selection.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'View Company Two employees'}));
  expect(window.location.pathname).toBe('/people/employees');expect(new URLSearchParams(window.location.search).get('company')).toBe('c2');
 });
 it('sorts real company rows and opens the exact company/period/Run without a calculation',async()=>{
  render(<HrDashboardPage auth={auth(permissions)}/>);
  await screen.findByRole('button',{name:'View Company One employees'});
  expect(screen.getAllByText('Night Apprentice').length).toBeGreaterThan(0);expect(screen.getAllByText('Active Employees').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button',{name:'Sort by Legal Entity, ascending'}));
  fireEvent.click(screen.getByRole('button',{name:'Open Payroll Run'}));
  expect(window.location.pathname).toBe('/people/payroll');
  expect(Object.fromEntries(new URLSearchParams(window.location.search))).toMatchObject({company:'c1',period:'2026-10',run:'r1'});
 });
 it('applies the shared Company selector without re-reading or broadening sources',async()=>{
  render(<HrDashboardPage auth={auth(permissions)}/>);
  await screen.findByRole('button',{name:'View Company One employees'});
  fireEvent.click(screen.getByRole('button',{name:'Company',exact:true}));
  fireEvent.click(await screen.findByRole('option',{name:'Company Two',exact:true}));
  await screen.findByRole('button',{name:'View Company Two employees'});
  expect(screen.queryByRole('button',{name:'View Company One employees'})).toBeNull();
  expect(screen.queryByText('Night Apprentice')).toBeNull();
  expect(mocks.employees).toHaveBeenCalledTimes(1);
 });
 it('keeps an inaccessible saved company fail-closed instead of showing another company',async()=>{
  window.history.replaceState(null,'','/hr/dashboard?company=forbidden');render(<HrDashboardPage auth={auth(permissions)}/>);
  await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'View Company One employees'})).toBeNull();
 });
 it('reports failed employee reads as unavailable rather than zero and retries',async()=>{
  mocks.employees.mockRejectedValueOnce(new Error('unavailable'));render(<HrDashboardPage auth={auth(permissions)}/>);
  expect(await screen.findByRole('alert')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Retry overview'}));
  await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 });
 it('previews six company groups but retains full totals, sorting and View All access',async()=>{
  mocks.employees.mockResolvedValue(Array.from({length:9},(_,i)=>({id:`e${i}`,legal_entity_id:`c${i}`,employment_type:i%2?'part_time':'probation',employment_status:'active'})));
  mocks.companies.mockResolvedValue(Array.from({length:9},(_,i)=>({id:`c${i}`,display_name:`Company ${i}`})));
  render(<HrDashboardPage auth={auth(permissions)}/>);
  const section=await screen.findByRole('region',{name:'Employees by Company'});
  await within(section).findByRole('button',{name:'View All'});
  expect(within(section).getAllByRole('button',{name:/^View Company .* employees$/})).toHaveLength(6);
  expect(within(section).getAllByText('9')).toHaveLength(2);
  fireEvent.click(within(section).getByRole('button',{name:'View All'}));
  expect(within(section).getAllByRole('button',{name:/^View Company .* employees$/})).toHaveLength(9);
  fireEvent.click(within(section).getByRole('button',{name:'Sort by Legal Entity, ascending'}));
  expect(within(section).getAllByRole('button',{name:/^View Company .* employees$/})[0].getAttribute('aria-label')).toBe('View Company 0 employees');
  fireEvent.click(within(section).getByRole('button',{name:'Show fewer'}));
  expect(within(section).getAllByRole('button',{name:/^View Company .* employees$/})).toHaveLength(6);
 });
 it('keeps older open Payroll periods collapsed without losing direct navigation',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-30T00:00:00Z'));
  mocks.payroll.mockResolvedValue({legal_entities:[{id:'c1',name:'Company One'}],periods:['2026-10-01','2026-09-01'].map((date,i)=>({id:`p${i}`,legal_entity_id:'c1',period_start:date,runs:[{id:`r${i}`,status:'draft',revision:1}]}))});
  render(<HrDashboardPage auth={auth(permissions)}/>);
  await screen.findByText('Other open periods (1)');
  expect(screen.getByText('September 2026').closest('details').open).toBe(false);
  expect(screen.getByText('October 2026').closest('details')).toBeNull();
  vi.useRealTimers();
 });

});
