import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {AdminChart,AdminChartMark,adminChartScale,useAdminChartGeometry} from '../AdminChart.jsx';
import MetricCard from '../MetricCard.jsx';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('uses zero-inclusive readable scales for positive, negative, constant and tiny evidence',()=>{
 expect(adminChartScale([352800,401800,null]).ticks).toEqual([0,100000,200000,300000,400000,500000]);
 for(const values of [[-12,5],[0,0],[.001,.003],[-400,-200]]){
  const {min,max,ticks}=adminChartScale(values);expect(min).toBeLessThanOrEqual(Math.min(0,...values));expect(max).toBeGreaterThanOrEqual(Math.max(0,...values));expect(ticks.every(Number.isFinite)).toBe(true);
 }
});
it('navigates canonical marks with arrows and selects through the same keyboard/touch callback',()=>{
 const select=vi.fn();render(<AdminChart label="Evidence">{()=>['May','June'].map(label=><AdminChartMark key={label} label={label} tooltip={<span>{label} exact 123.45</span>} onSelect={()=>select(label)}><rect width="44" height="44"/></AdminChartMark>)}</AdminChart>);
 const may=screen.getByRole('button',{name:'May'}),june=screen.getByRole('button',{name:'June'});act(()=>may.focus());fireEvent.keyDown(may,{key:'ArrowRight'});expect(document.activeElement).toBe(june);expect(screen.getByRole('tooltip').textContent).toContain('June exact');fireEvent.keyDown(june,{key:'Enter'});expect(select).toHaveBeenLastCalledWith('June');fireEvent.click(may);expect(select).toHaveBeenLastCalledWith('May');fireEvent.keyDown(may,{key:'Escape'});expect(screen.queryByRole('tooltip')).toBeNull();
});
it('does not schedule motion for unchanged geometry or reduced-motion evidence updates',()=>{
 const raf=vi.fn();vi.stubGlobal('requestAnimationFrame',raf);vi.stubGlobal('cancelAnimationFrame',vi.fn());vi.stubGlobal('matchMedia',()=>({matches:true}));
 function Probe({amount}){const geometry=useAdminChartGeometry({balance:[amount]});return <span>{geometry.balance[0]}</span>;}
 const view=render(<Probe amount={10}/>);expect(raf).not.toHaveBeenCalled();view.rerender(<Probe amount={20}/>);expect(screen.getByText('20')).toBeTruthy();expect(raf).not.toHaveBeenCalled();
});
it('retains zero-inclusive spark geometry and exposes exact dated values through focus and arrows',()=>{
 render(<MetricCard label="Cash" value="RM 100" sparklineLabel="Cash history" sparklineFormatValue={value=>`RM ${value.toFixed(2)}`} sparklineData={[{label:'Sep',value:99},{label:'Oct',value:100}]}/>);
 const spark=screen.getByRole('img',{name:'Cash history'});expect(spark.querySelector('path').getAttribute('d')).toContain('4,4.24');fireEvent.focus(spark);expect(screen.getByRole('tooltip').textContent).toContain('OctRM 100.00');fireEvent.keyDown(spark,{key:'ArrowLeft'});expect(screen.getByRole('tooltip').textContent).toContain('SepRM 99.00');fireEvent.keyDown(spark,{key:'Escape'});expect(screen.queryByRole('tooltip')).toBeNull();
});
