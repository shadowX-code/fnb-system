import {render,screen,waitFor,fireEvent,cleanup} from '@testing-library/react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import HrDashboardPage from '../HrDashboardPage.jsx';
const mocks=vi.hoisted(()=>({employees:vi.fn(),recruitment:vi.fn(),payroll:vi.fn()}));
vi.mock('../../../services/employeeService.js',()=>({employeeService:{listEmployees:mocks.employees}}));
vi.mock('../../../services/payrollService.js',()=>({payrollService:{read:mocks.payroll}}));
vi.mock('../../recruitment/recruitmentService.js',()=>({recruitmentService:{workspace:mocks.recruitment}}));
const auth=codes=>({user:{id:'qa'},hasPermission:code=>codes.includes(code)});
afterEach(cleanup);
beforeEach(()=>{vi.resetAllMocks();mocks.employees.mockResolvedValue([{employment_status:'active'},{employment_status:'resigned'}]);mocks.recruitment.mockResolvedValue({summary:{open_roles:3,needs_review:2}});mocks.payroll.mockResolvedValue({periods:[{runs:[{status:'draft'}]},{runs:[{status:'finalized'}]}]});});
describe('HR summary uses authorized canonical reads',()=>{
 it('never reads or renders an unauthorized domain',async()=>{
  render(<HrDashboardPage auth={auth(['recruitment.view'])} ui={{navigate:vi.fn()}}/>);
  await screen.findByText('Candidates awaiting review');
  expect(mocks.employees).not.toHaveBeenCalled();expect(mocks.payroll).not.toHaveBeenCalled();
  expect(screen.queryByText('Active employees')).toBeNull();
 });
 it('uses server recruitment summaries and Payroll run statuses without financial calculation',async()=>{
  const navigate=vi.fn();render(<HrDashboardPage auth={auth(['employees.view','recruitment.view','payroll.view'])} ui={{navigate}}/>);
  await screen.findByText('Open periods · check each Run’s readiness');
  expect(screen.getByText('Active employees')).toBeTruthy();
  expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button',{name:/Open roles/}));expect(navigate).toHaveBeenCalledWith('recruitment');
 });
 it('reports failed reads as unavailable rather than zero and offers retry',async()=>{
  mocks.payroll.mockRejectedValueOnce(new Error('unavailable'));
  render(<HrDashboardPage auth={auth(['payroll.view'])} ui={{navigate:vi.fn()}}/>);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Retry summaries'}));
  await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 });
});
