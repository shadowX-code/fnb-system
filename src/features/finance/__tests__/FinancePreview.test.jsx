import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import FinancePreviewBoundary, { financePreviewGate } from '../FinancePreviewBoundary.jsx';
import { reportingService } from '../../../services/reportingService.js';
import { createFixtureProvider } from '../providers/fixtureProvider.js';
import { monthlyPeriod } from '../foundation.js';
import { validateDataset } from '../financeService.js';
afterEach(()=>{cleanup();sessionStorage.clear();vi.restoreAllMocks();});
it('fails closed for Production hosts/builds and non-owner roles',()=>{
  const input={development:false,stagingBuild:true,role:'owner',hostname:'fnb-system-staging.vercel.app'};
  expect(financePreviewGate(input)).toBe(true);
  expect(financePreviewGate({...input,stagingBuild:false})).toBe(false);
  expect(financePreviewGate({...input,hostname:'fnb-system.vercel.app'})).toBe(false);
  for(const role of ['admin','manager',undefined])expect(financePreviewGate({...input,role})).toBe(false);
});
it('replaces the presentation tree with simulated evidence and never reads Reporting',async()=>{
  const reporting=vi.spyOn(reportingService,'getMonthlyScopeFinancialReport');
  sessionStorage.setItem('feedx-finance-design-preview','on');
  render(<FinancePreviewBoundary auth={{profile:{role_name:'owner'}}} section="overview"><p>Canonical tree</p></FinancePreviewBoundary>);
  await screen.findByRole('heading',{name:'Profit Architecture'});
  expect(screen.queryByText('Canonical tree')).toBeNull();
  expect(screen.getByText('Simulated evidence · isolated from financial records')).toBeTruthy();
  expect(reporting).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Exit Design Preview'}));
  expect(screen.getByText('Canonical tree')).toBeTruthy();
});
it('does not accept simulated evidence as canonical truth',async()=>{
  const request={scope:{kind:'group',id:'demo-group'},period:monthlyPeriod('2026-10'),currency:'MYR'};
  const dataset=await createFixtureProvider({development:true}).readOverview(request);
  expect(()=>validateDataset(dataset,request)).toThrow('Financial scope or evidence mismatch');
});
