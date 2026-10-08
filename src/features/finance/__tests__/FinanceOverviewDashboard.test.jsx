import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {FinanceOverview} from '../FinanceWorkspacePage.jsx';
import {readFinanceOverview} from '../financeService.js';
import {createFixtureProvider,fixtureScopes} from '../providers/fixtureProvider.js';
import {monthlyPeriod} from '../foundation.js';
import {overviewHistory,profitConversion} from '../overviewDashboard.js';
import {useOverviewAnalysisIntent} from '../overviewNavigation.js';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const request={scope:{kind:'group',id:'demo-group'},period:monthlyPeriod('2026-10'),currency:'MYR'};
const outlets=fixtureScopes.filter(row=>row.kind==='outlet').map(row=>({id:row.id,name:row.label,legalEntityId:row.legalEntityId}));
const read=()=>readFinanceOverview(createFixtureProvider({development:true}),request,{allowDemo:true,outlets});
it('bounds and deduplicates monthly/outlet provider reads, preserves failed historical gaps and scopes',async()=>{
 const base=createFixtureProvider({development:true});let active=0,peak=0;const keys=[];
 const provider={...base,readOverview:vi.fn(async query=>{active++;peak=Math.max(peak,active);keys.push(JSON.stringify([query.scope,query.period]));try{await Promise.resolve();if(query.period.start==='2026-06-01')throw Error('missing');return await base.readOverview(query);}finally{active--;}})};
 const dataset=await readFinanceOverview(provider,request,{allowDemo:true,outlets});
 expect(dataset.history).toHaveLength(12);expect(dataset.history[0].period.start).toBe('2025-11-01');expect(dataset.outlets).toHaveLength(3);
 expect(peak).toBeLessThanOrEqual(4);expect(new Set(keys).size).toBe(keys.length);expect(keys).toHaveLength(15);
 expect(overviewHistory(dataset).find(row=>row.period.start==='2026-06-01').revenue).toBeNull();
 const entity=await readFinanceOverview(base,{...request,scope:{kind:'legal_entity',id:'demo-entity-a'}},{allowDemo:true,outlets});expect(entity.outlets.map(row=>row.id)).toEqual(['demo-kl','demo-pj']);
});
it('withholds a 100% composition for missing, overlapping, negative or unreconciled inputs',async()=>{
 const dataset=await read();expect(profitConversion(dataset).complete).toBe(true);
 expect(profitConversion(dataset).rows.reduce((sum,row)=>sum+row.share,0)).toBeCloseTo(100,6);
 for(const mutate of [d=>d.metrics.labour.completeness='partial',d=>d.metrics.opex.value+=1,d=>d.metrics.cogs_percent.value+=1,d=>d.profitDriverModel.drivers=['revenue','cogs','opex'],d=>d.metrics.ebitda.value=-1]){
  const invalid=structuredClone(dataset);mutate(invalid);const projection=profitConversion(invalid);expect(projection.complete).toBe(false);expect(projection.rows.every(row=>row.share===null)).toBe(true);
 }
});
it('withholds partial, mixed-basis and forecast cash history without filling gaps',async()=>{
 const dataset=await read();dataset.history[6].dataset.metrics.cash.completeness='partial';dataset.history[7].dataset.metrics.cash.provenance.forEach(source=>source.semantic='FORECAST');dataset.history[8].dataset.metrics.revenue.provenance.forEach(source=>source.semantic='OPERATIONAL');
 const rows=overviewHistory(dataset);expect(rows[0].cash).toBeNull();expect(rows[1].cash).toBeNull();expect(rows[2].revenue).toBeNull();expect(rows.at(-1).cash).toBe(401800);
});
it('renders four charts, switches units/history and expands the existing bridge with precise keyboard tooltips',async()=>{
 const dataset=await read(),before=JSON.stringify(dataset);render(<FinanceOverview dataset={dataset}/>);
 expect(screen.getByRole('region',{name:'Financial state'}).querySelectorAll('[data-admin-summary-card]')).toHaveLength(5);
 for(const title of ['Revenue & EBITDA Trend','Profit Conversion','Outlet Performance','Cash Position Trend'])expect(screen.getByRole('heading',{name:title})).toBeTruthy();
 expect(screen.queryByRole('navigation',{name:'Continue financial investigation'})).toBeNull();
 const trend=screen.getByRole('group',{name:'Monthly Revenue and EBITDA history'});expect(trend.querySelectorAll('[role=button]')).toHaveLength(12);
 fireEvent.click(screen.getByRole('tablist',{name:'Performance history'}).querySelectorAll('[role=tab]')[1]);expect(trend.querySelectorAll('[role=button]')).toHaveLength(24);
 fireEvent.click(screen.getByRole('tab',{name:'Margin %'}));expect(trend.querySelectorAll('[role=button]')).toHaveLength(12);
 fireEvent.focus(within(trend).getAllByRole('button')[0]);expect(screen.getByRole('tooltip').textContent).toContain('%');expect(screen.getByRole('tooltip').textContent).not.toContain('RM');
 fireEvent.keyDown(trend,{key:'Escape'});expect(screen.queryByRole('tooltip')).toBeNull();
 expect(screen.queryByRole('group',{name:'Driver Contribution'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:/What changed this month/}));expect(screen.getByRole('group',{name:'Driver Contribution'})).toBeTruthy();
 expect(screen.getByText(/does not establish available bank funds/)).toBeTruthy();expect(JSON.stringify(dataset)).toBe(before);
});
it('preserves selected period/outlet when opening Analysis and separates simulated from live intent',async()=>{
 const dataset=await read();render(<FinanceOverview dataset={dataset}/>);
 fireEvent.keyDown(screen.getByRole('button',{name:'Select Demo · Petaling Jaya outlet'}),{key:'Enter'});fireEvent.click(screen.getByRole('button',{name:'Open Analysis'}));expect(window.location.pathname).toBe('/finance/analysis');cleanup();
 function Probe({demo}){const intent=useOverviewAnalysisIntent(demo);return <p>{intent?`${intent.month}:${intent.scope.id}`:'none'}</p>;}
 const live=render(<Probe demo={false}/>);expect(screen.getByText('none')).toBeTruthy();live.unmount();render(<Probe demo/>);expect(screen.getByText('2026-10:demo-pj')).toBeTruthy();
});

it('keeps first/latest month labels apart in a narrow chart and omits immaterial ratio sparklines',async()=>{
 const dataset=await read();const resize=[];
 vi.stubGlobal('ResizeObserver',class{constructor(callback){resize.push(callback);}observe(){}disconnect(){}});
 const {act}=await import('@testing-library/react');
 render(<FinanceOverview dataset={dataset}/>);
 act(()=>resize.forEach(callback=>callback([{contentRect:{width:272}}])));
 const trend=screen.getByRole('group',{name:'Monthly Revenue and EBITDA history'});
 const labels=[...trend.querySelectorAll('text')].map(node=>node.textContent).filter(text=>/^(May|Jun|Jul|Aug|Sept|Oct) 26$/.test(text));
 expect(labels).toEqual(['May 26','Jul 26','Oct 26']);
 expect(screen.queryByRole('img',{name:'Gross Margin monthly evidence'})).toBeNull();
 expect(screen.getByRole('img',{name:'Cash monthly evidence'})).toBeTruthy();
});
