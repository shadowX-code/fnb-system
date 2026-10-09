import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {adminChartLinePath,AdminChart,AdminChartMark,adminChartTooltipPosition,adminChartScale,useAdminChartGeometry} from '../AdminChart.jsx';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('uses zero-inclusive readable scales for positive, negative, constant and tiny evidence',()=>{
 expect(adminChartScale([352800,401800,null]).ticks).toEqual([0,100000,200000,300000,400000,500000]);
 for(const values of [[-12,5],[0,0],[.001,.003],[-400,-200]]){
  const {min,max,ticks}=adminChartScale(values);expect(min).toBeLessThanOrEqual(Math.min(0,...values));expect(max).toBeGreaterThanOrEqual(Math.max(0,...values));expect(ticks.every(Number.isFinite)).toBe(true);
 }
});
it('navigates canonical marks with arrows and selects through the same keyboard/touch callback',()=>{
 const select=vi.fn();render(<AdminChart label="Evidence">{()=>['May','June'].map(label=><AdminChartMark key={label} label={label} tooltip={<span>{label} exact 123.45</span>} onSelect={()=>select(label)}><rect width="44" height="44"/></AdminChartMark>)}</AdminChart>);
 const may=screen.getByRole('button',{name:'May'}),june=screen.getByRole('button',{name:'June'});act(()=>may.focus());fireEvent.keyDown(may,{key:'ArrowRight'});expect(document.activeElement).toBe(june);expect(screen.getByRole('tooltip').textContent).toContain('June exact');fireEvent.pointerEnter(may,{pointerType:'mouse'});expect(screen.getByRole('tooltip').textContent).toContain('June exact');fireEvent.pointerLeave(may,{pointerType:'mouse'});expect(screen.getByRole('tooltip').textContent).toContain('June exact');fireEvent.keyDown(june,{key:'Enter'});expect(select).toHaveBeenLastCalledWith('June');fireEvent.click(may);expect(select).toHaveBeenLastCalledWith('May');fireEvent.keyDown(may,{key:'Escape'});expect(screen.queryByRole('tooltip')).toBeNull();
});
it('does not schedule motion for unchanged geometry or reduced-motion evidence updates',()=>{
 const raf=vi.fn();vi.stubGlobal('requestAnimationFrame',raf);vi.stubGlobal('cancelAnimationFrame',vi.fn());vi.stubGlobal('matchMedia',()=>({matches:true}));
 function Probe({amount}){const geometry=useAdminChartGeometry({balance:[amount]});return <span>{geometry.balance[0]}</span>;}
 const view=render(<Probe amount={10}/>);expect(raf).not.toHaveBeenCalled();view.rerender(<Probe amount={20}/>);expect(screen.getByText('20')).toBeTruthy();expect(raf).not.toHaveBeenCalled();
});
it('keeps keyboard inspection authoritative across chart surfaces and clears prior hover tips',()=>{
 render(<><AdminChart label="First">{()=> <AdminChartMark label="First mark" tooltip="First exact value" onSelect={()=>{}}><rect width="44" height="44"/></AdminChartMark>}</AdminChart><AdminChart label="Second">{()=> <AdminChartMark label="Second mark" tooltip="Second exact value" onSelect={()=>{}}><rect width="44" height="44"/></AdminChartMark>}</AdminChart></>);
 const first=screen.getByRole('button',{name:'First mark'}),second=screen.getByRole('button',{name:'Second mark'});
 fireEvent.pointerEnter(first,{pointerType:'mouse'});expect(screen.getByRole('tooltip').textContent).toBe('First exact value');
 act(()=>second.focus());expect(screen.getAllByRole('tooltip')).toHaveLength(1);expect(screen.getByRole('tooltip').textContent).toBe('Second exact value');
 fireEvent.pointerEnter(first,{pointerType:'mouse'});fireEvent.pointerLeave(first,{pointerType:'mouse'});expect(screen.getByRole('tooltip').textContent).toBe('Second exact value');
});

it('clamps measured tooltip dimensions to every viewport edge',()=>{
 for(const anchor of [{x:0,top:0,bottom:0},{x:320,top:630,bottom:640},{x:150,top:300,bottom:310}]){
  const {x,y}=adminChartTooltipPosition(anchor,{width:200,height:90},{width:320,height:640});
  expect(x).toBeGreaterThanOrEqual(8);expect(x+200).toBeLessThanOrEqual(312);expect(y).toBeGreaterThanOrEqual(8);expect(y+90).toBeLessThanOrEqual(632);
 }
});
it('supports a focused position scale while retaining zero-inclusive amount scales',()=>{
 const focused=adminChartScale([149870,163920,153617],3,{includeZero:false});expect(focused.min).toBeGreaterThan(0);expect(focused.max).toBeGreaterThan(163920);
 expect(adminChartScale([149870,163920]).min).toBe(0);
});

it('separates pointer focus from keyboard focus without losing persistent selection',()=>{
 render(<AdminChart label="Focus">{()=> <AdminChartMark label="Balance" selected tooltip="Balance detail" onSelect={()=>{}}><rect className="chart-focus" width="44" height="44"/></AdminChartMark>}</AdminChart>);
 const mark=screen.getByRole('button',{name:'Balance'});fireEvent.pointerDown(mark);fireEvent.focus(mark);
 expect(mark.dataset.keyboardFocus).toBe('false');expect(mark.getAttribute('aria-pressed')).toBe('true');
 fireEvent.keyDown(mark,{key:'Enter'});expect(mark.dataset.keyboardFocus).toBe('true');expect(screen.getByRole('tooltip')).toBeTruthy();
});

it('allows mouse inspection beside a pointer-selected object while keeping selection',()=>{
 render(<AdminChart label="Inspection">{()=>['A','B'].map(label=><AdminChartMark key={label} label={label} selected={label==='A'} tooltip={`${label} detail`} onSelect={()=>{}}><rect width="44" height="44"/></AdminChartMark>)}</AdminChart>);
 const first=screen.getByRole('button',{name:'A'}),second=screen.getByRole('button',{name:'B'});
 fireEvent.pointerDown(first);act(()=>first.focus());fireEvent.pointerEnter(second,{pointerType:'mouse'});
 expect(screen.getByRole('tooltip').textContent).toBe('B detail');expect(first.getAttribute('aria-pressed')).toBe('true');
});

it('retains exact observations and disconnects missing/nonfinite series coordinates',()=>{
 expect(adminChartLinePath([[0,10],[20,5],null,[60,9],[80,NaN],[100,3]])).toBe('M0,10 L20,5  M60,9  M100,3');
});
