import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {PayrollPhPolicy} from '../PayrollPhWork.jsx';
const api=vi.hoisted(()=>({readPhPolicy:vi.fn(),savePhPolicy:vi.fn(),saveDefaultPhPolicy:vi.fn()}));
vi.mock('../../../../services/payrollService.js',()=>({payrollService:api}));
const entities=[{id:'entity',name:'QA company',is_active:true}];
beforeEach(()=>{vi.clearAllMocks();api.readPhPolicy.mockResolvedValue([{id:'current',effective_from:'2026-01-01',treatment:'additional_pay'},{id:'old',effective_from:'2025-01-01',treatment:'replacement_leave'}]);api.savePhPolicy.mockResolvedValue('new');});
afterEach(cleanup);
it('shows current default and unchanged read-only company formulas; history is collapsed',async()=>{render(<PayrollPhPolicy entities={entities} selectedCompany="entity" canManage/>);await screen.findByText('Company PH Allowance');expect(screen.getByText('+1 ordinary day · Basic Salary ÷ 26')).toBeTruthy();expect(screen.getByText('Approved PH Hours × Hourly Rate')).toBeTruthy();expect(screen.getByText('View history').closest('details').open).toBe(false);expect(screen.queryByText('Working on a Paid Holiday')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Change Default PH Pay Treatment'}));fireEvent.click(screen.getByRole('button',{name:'Default PH Pay Treatment'}));expect(screen.getByRole('button',{name:'Statutory PH Pay'})).toBeTruthy();expect(screen.getByRole('button',{name:'No default — decide during Payroll'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Replacement Leave'})).toBeNull();});
it('ignores future policy for current presentation and retains it in history',async()=>{api.readPhPolicy.mockResolvedValue([{id:'future',effective_from:'2099-01-01',treatment:'statutory'},{id:'now',effective_from:'2026-01-01',treatment:'additional_pay'}]);render(<PayrollPhPolicy entities={entities} selectedCompany="entity"/>);await screen.findByText('Company PH Allowance');expect(screen.getByText(/2099-01-01/)).toBeTruthy();});

it('keeps a retained Replacement Leave policy out of the current cash treatment',async()=>{api.readPhPolicy.mockResolvedValue([{id:'leave',effective_from:'2026-01-01',treatment:'replacement_leave'}]);render(<PayrollPhPolicy entities={entities} selectedCompany="entity"/>);await screen.findByText('No default — decide during Payroll');expect(screen.getByText('Replacement Leave · retained Leave policy').closest('details').open).toBe(false);});
