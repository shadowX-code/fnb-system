// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ProfitArchitecture } from '../FinanceAnalyticalVisuals.jsx';
import { FinanceAnalysis } from '../FinanceAnalysisPage.jsx';
import { FinanceCosts } from '../FinanceCostsPage.jsx';
import { FinanceCash } from '../FinanceCashPage.jsx';
import { FinanceChart, financeChartMovement, useFinanceGeometry } from '../FinanceChart.jsx';
import { readFinanceAnalysis } from '../analysis.js';
import { createFixtureProvider } from '../providers/fixtureProvider.js';
import { monthlyPeriod } from '../foundation.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const fixture = () => readFinanceAnalysis(createFixtureProvider({development:true}), {scope:{kind:'group',id:'demo-group'},period:monthlyPeriod('2026-10'),currency:'MYR'}, {allowDemo:true,outlets:[{id:'demo-kl',name:'Demo KL',legalEntityId:'demo-entity-a'},{id:'demo-pj',name:'Demo PJ',legalEntityId:'demo-entity-a'}]});

it('focus discloses precise evidence, keyboard selection emphasizes the same object, and Escape dismisses the tooltip', async () => {
  render(<FinanceAnalysis analysis={await fixture()}/>);
  const driver = screen.getByRole('button',{name:'Explore Revenue driver'});
  fireEvent.focus(driver);
  expect(screen.getByRole('tooltip').textContent).toContain('Cumulative EBITDA');
  expect(driver.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  fireEvent.keyDown(driver,{key:' '});
  expect(driver.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button',{name:'Explore COGS driver'}).classList.contains('is-receded')).toBe(true);
  expect(screen.getByRole('region',{name:'Selected analysis context'}).textContent).toContain('Revenue');
  fireEvent.keyDown(driver,{key:'Escape'});
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.pointerEnter(driver,{pointerType:'mouse'});
  expect(screen.getByRole('tooltip')).toBeTruthy();
  fireEvent.pointerLeave(driver,{pointerType:'mouse'});
  expect(screen.queryByRole('tooltip')).toBeNull();
});
it('profit partitions consume supplied inputs, retain every amount, and withhold proportional geometry for incompatible evidence',async()=>{
  const analysis=await fixture(), before=JSON.stringify(analysis);
  const view=render(<ProfitArchitecture dataset={analysis.current} onSelect={()=>{}}/>);
  const chart=screen.getByRole('group',{name:'Revenue consumption and retained profit structure'});
  expect(within(chart).getByRole('button',{name:'Explore COGS flow'}).querySelector('rect').getAttribute('fill')).toBe('var(--chart-violet)');
  const cogs=within(chart).getByRole('button',{name:'Explore COGS flow'});
  fireEvent.click(cogs);
  expect(within(chart).getByRole('button',{name:'Explore COGS flow'})).toBeTruthy();
  expect(JSON.stringify(analysis)).toBe(before);
  const partial={...analysis.current,metrics:{...analysis.current.metrics,labour:{...analysis.current.metrics.labour,value:null,completeness:'unavailable'}}};
  view.rerender(<ProfitArchitecture dataset={partial} onSelect={()=>{}}/>);
  expect(chart.querySelectorAll('.chart-pressure')).toHaveLength(0);
  expect(chart.querySelectorAll('.chart-pending')).toHaveLength(6);
});
it('cost drill replaces field objects with supplied classifications and retains one action context',async()=>{
  render(<FinanceCosts analysis={await fixture()}/>);
  const chart=screen.getByRole('group',{name:'Cost growth relative to Revenue and margin impact'});
  expect(within(chart).getByRole('button',{name:'Investigate COGS pressure'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Investigate COGS',exact:true}));
  fireEvent.click(screen.getByRole('tab',{name:'Break down'}));
  expect(within(chart).queryByRole('button',{name:'Investigate COGS pressure'})).toBeNull();
  const food=within(chart).getByRole('button',{name:'Investigate Food pressure'});
  fireEvent.click(food);
  expect(screen.getByRole('navigation',{name:'Cost drill path'}).textContent).toContain('COGS/Food');
  expect(screen.getAllByRole('region',{name:'Selected analysis context'})).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab',{name:'Compare'}));
  expect(screen.getByRole('table',{name:'Food · period comparison'})).toBeTruthy();
});
it('same-day cash events retain distinct touch targets and exact date coordinates without changing the cash trajectory',async()=>{
  render(<FinanceCash analysis={await fixture()}/>);
  const chart=screen.getByRole('group',{name:'Horizontal Liquidity Timeline'}), path=chart.querySelector('.finance-timeline-path').getAttribute('d');
  const rent=within(chart).getByRole('button',{name:'Select Illustrative rent commitment on timeline'}), supplier=within(chart).getByRole('button',{name:'Select Illustrative supplier commitment on timeline'});
  const a=rent.querySelector('circle'),b=supplier.querySelector('circle');
  expect(a.getAttribute('cx')).toBe(b.getAttribute('cx'));
  expect(a.getAttribute('cy')).not.toBe(b.getAttribute('cy'));
  fireEvent.click(supplier);
  expect(chart.querySelector('.finance-timeline-path').getAttribute('d')).toBe(path);
  expect(screen.getByRole('tooltip').textContent).toContain('2026-11-05');
  expect(screen.getByRole('region',{name:'Selected analysis context'}).textContent).toContain('Forecast');
});
it('reduced motion applies updated geometry immediately and missing objects are never tweened into fake values',()=>{
  vi.stubGlobal('matchMedia',()=>({matches:true}));
  function Geometry({target}) { const g=useFinanceGeometry(target); return <output>{JSON.stringify(g)}</output>; }
  const view=render(<Geometry target={{cash:[20,30]}}/>);
  view.rerender(<Geometry target={{cash:[60,90]}}/>);
  expect(screen.getByRole('status').textContent).toBe('{"cash":[60,90]}');
  view.rerender(<Geometry target={{}}/>);
  expect(screen.getByRole('status').textContent).toBe('{}');
});
it('measures narrow canvases instead of hiding or horizontally scrolling the analytical field',()=>{
  let resize;
  vi.stubGlobal('ResizeObserver',class { constructor(callback){resize=callback;} observe(){} disconnect(){} });
  render(<FinanceChart label="Measured field">{width=><text>{width}</text>}</FinanceChart>);
  act(()=>resize([{contentRect:{width:288}}]));
  expect(screen.getByRole('group',{name:'Measured field'}).getAttribute('viewBox')).toBe('0 0 288 300');
});
it('uses a bounded geometry transition without delaying selection or retaining removed evidence',()=>{
  let frame;
  vi.stubGlobal('requestAnimationFrame',callback=>{frame=callback;return 1;});
  vi.stubGlobal('cancelAnimationFrame',vi.fn());
  function Geometry({target}) { const g=useFinanceGeometry(target); return <output>{JSON.stringify(g)}</output>; }
  const view=render(<Geometry target={{outlet:[20,30]}}/>);
  view.rerender(<Geometry target={{outlet:[60,90]}}/>);
  act(()=>frame(0)); act(()=>frame(110));
  const halfway=JSON.parse(screen.getByRole('status').textContent).outlet;
  expect(halfway[0]).toBeGreaterThan(20); expect(halfway[0]).toBeLessThan(60);
  act(()=>frame(220));
  expect(screen.getByRole('status').textContent).toBe('{"outlet":[60,90]}');
  view.rerender(<Geometry target={{}}/>);
  expect(screen.getByRole('status').textContent).toBe('{}');
});
it('returns preserved outlet context to the scope when the next read has no evidence for that outlet',async()=>{
  const analysis=await fixture(), view=render(<FinanceAnalysis analysis={analysis}/>);
  fireEvent.click(screen.getByRole('button',{name:/^Demo KL: revenue growth/}));
  expect(screen.getByRole('region',{name:'Selected outlet performance'})).toBeTruthy();
  view.rerender(<FinanceAnalysis analysis={{...analysis,outlets:[]}}/>);
  expect(screen.queryByRole('region',{name:'Selected outlet performance'})).toBeNull();
  expect(screen.queryByRole('region',{name:'Selected analysis context'})).toBeNull();
});

it('formats rounded share movement neutrally without losing precise evidence',()=>{
 expect(financeChartMovement(-0.000000001,3)).toBe('0.000');
 expect(financeChartMovement(-.125,3)).toBe('-0.125');
 expect(financeChartMovement(.125,3)).toBe('+0.125');
 expect(financeChartMovement(null)).toBe('—');
});
