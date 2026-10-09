import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FinanceOverview } from '../FinanceWorkspacePage.jsx';
import { FinanceAnalysis } from '../FinanceAnalysisPage.jsx';
import { FinanceCosts } from '../FinanceCostsPage.jsx';
import { FinanceCash } from '../FinanceCashPage.jsx';
import { DriverContribution } from '../FinanceAnalyticalVisuals.jsx';
import { profitMovement, readFinanceAnalysis } from '../analysis.js';
import { readFinanceOverview } from '../financeService.js';
import { monthlyPeriod } from '../foundation.js';
import { createFixtureProvider } from '../providers/fixtureProvider.js';
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
const request={scope:{kind:'group',id:'demo-group'},period:monthlyPeriod('2026-10'),currency:'MYR'};
it('all four pages use canonical summary and analytical owners with unchanged evidence', async () => {
 const provider=createFixtureProvider({development:true}), pair=await readFinanceAnalysis(provider,request,{allowDemo:true}), dataset=await readFinanceOverview(provider,request,{allowDemo:true});
 const before=JSON.stringify(pair);
 for (const [Component,props,label,count] of [[FinanceOverview,{dataset},'Financial state',5],[FinanceAnalysis,{analysis:pair},'Financial performance',5],[FinanceCosts,{analysis:pair},'Cost state',5],[FinanceCash,{analysis:pair},'Current financial position',6]]) {
  const view=render(<Component {...props}/>);
  expect(within(screen.getByRole('region',{name:label})).getAllByText(/RM |%/).length).toBeGreaterThan(0);
  expect(screen.getByRole('region',{name:label}).querySelectorAll('[data-admin-summary-card]')).toHaveLength(count);
  expect(view.container.querySelectorAll('[data-admin-analytical-surface]')).toHaveLength(Component === FinanceOverview ? 5 : Component === FinanceAnalysis || Component === FinanceCosts ? 3 : 2);
  expect(view.container.querySelectorAll('.finance-metric,.finance-performance-strip')).toHaveLength(0);
  view.unmount();
 }
 expect(JSON.stringify(pair)).toBe(before);
});
it('bridge preserves ordered endpoints, precise signed contributions and responsive keyboard selection',async()=>{
 const pair=await readFinanceAnalysis(createFixtureProvider({development:true}),request,{allowDemo:true}), onSelect=vi.fn();
 let resize;
 vi.stubGlobal('ResizeObserver',class {constructor(callback){resize=callback;}observe(){}disconnect(){}});
 render(<DriverContribution pair={pair} movement={profitMovement(pair,pair.profitDriverModel)} onSelect={onSelect}/>);
 const chart=screen.getByRole('group',{name:'Driver Contribution'});
 expect([...chart.querySelectorAll('[role=button]')].map(mark=>mark.getAttribute('aria-label'))).toEqual(['Explore previous EBITDA','Explore Revenue driver','Explore COGS driver','Explore Labour Cost driver','Explore OPEX driver','Explore EBITDA movement']);
 expect(chart.querySelectorAll('[data-bridge-connector]')).toHaveLength(5);
 const cost=within(chart).getByRole('button',{name:'Explore COGS driver'});
 fireEvent.focus(cost);
 expect(screen.getByRole('tooltip').textContent).toContain('4,404');
 expect(screen.getByRole('tooltip').textContent).toContain('Cumulative EBITDA');
 act(()=>resize([{contentRect:{width:288}}]));
 expect(chart.getAttribute('viewBox')).toBe('0 0 288 414');
 fireEvent.keyDown(cost,{key:'Enter'});
 expect(onSelect).toHaveBeenCalledWith('cogs','driver');
});
it('withholds bridge relationships when attribution is incomplete',async()=>{
 const pair=await readFinanceAnalysis(createFixtureProvider({development:true}),request,{allowDemo:true});
 const invalid={...profitMovement(pair,pair.profitDriverModel),attributable:false};
 const view=render(<DriverContribution pair={pair} movement={invalid} onSelect={()=>{}}/>);
 expect(view.container.querySelectorAll('[data-bridge-connector]')).toHaveLength(0);
 expect(view.container.querySelectorAll('.chart-support,.chart-pressure')).toHaveLength(0);
 expect(view.container.querySelectorAll('.chart-pending')).toHaveLength(4);
});

it('respects excluded labour and displays negative EBITDA without changing the validated pair',async()=>{
 const pair=await readFinanceAnalysis(createFixtureProvider({development:true}),request,{allowDemo:true});
 const model={...pair.profitDriverModel,drivers:['revenue','cogs','opex']};
 for(const dataset of [pair.previous,pair.current]) dataset.metrics.ebitda.value=dataset.metrics.revenue.value-dataset.metrics.cogs.value-dataset.metrics.opex.value;
 let movement=profitMovement(pair,model);
 expect(movement.attributable).toBe(true);
 const view=render(<DriverContribution pair={pair} movement={movement} onSelect={()=>{}}/>);
 const labour=screen.getByRole('button',{name:'Explore Labour Cost driver'});
 expect(labour.querySelector('.chart-pending')).toBeTruthy();
 expect(labour.querySelector('.chart-pressure,.chart-support')).toBeNull();
 fireEvent.focus(labour);
 expect(screen.getByRole('tooltip').textContent).toContain('Outside this EBITDA basis');
 const values=[{revenue:50,cogs:35,labour:5,opex:5,ebitda:5},{revenue:30,cogs:40,labour:10,opex:5,ebitda:-25}];
 [pair.previous,pair.current].forEach((dataset,index)=>Object.entries(values[index]).forEach(([id,value])=>{dataset.metrics[id].value=value;}));
 const before=JSON.stringify(pair);
 movement=profitMovement(pair,pair.profitDriverModel);
 expect(movement.attributable).toBe(true);
 view.rerender(<DriverContribution pair={pair} movement={movement} onSelect={()=>{}}/>);
 fireEvent.focus(screen.getByRole('button',{name:'Explore EBITDA movement'}));
 expect(screen.getByRole('tooltip').textContent).toMatch(/-RM\s25\.00/);
 expect(view.container.querySelectorAll('[data-bridge-connector]')).toHaveLength(5);
 expect(JSON.stringify(pair)).toBe(before);
});

it('selecting Previous EBITDA opens its comparison and emphasizes only that endpoint in both bridge consumers',async()=>{
 const provider=createFixtureProvider({development:true}), pair=await readFinanceAnalysis(provider,request,{allowDemo:true}), dataset=await readFinanceOverview(provider,request,{allowDemo:true});
 for(const [Component,props] of [[FinanceOverview,{dataset}],[FinanceAnalysis,{analysis:pair}]]) {
  const view=render(<Component {...props}/>);
  fireEvent.keyDown(screen.getByRole('button',{name:'Explore previous EBITDA'}),{key:'Enter'});
  expect(screen.getByRole('button',{name:'Explore previous EBITDA'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button',{name:'Explore EBITDA movement'}).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('tab',{name:'Compare'}).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tabpanel',{name:'Compare'}).textContent).toContain('149,870');
  view.unmount();
 }
});
