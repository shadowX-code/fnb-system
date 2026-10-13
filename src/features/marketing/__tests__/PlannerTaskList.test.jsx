import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import PlannerTaskList from '../PlannerTaskList.jsx';
vi.mock('../marketingService.js',()=>({marketingService:{assetUrl:vi.fn()}}));
const task={id:'task',title:'Creative task',brand_id:'brand',brand_name:'Brand',status:'planned',priority:'normal',due_date:'2030-10-01',checklist:[],assets:[],asset_ids:[]};
const props={rows:[task],prefs:{groupBy:'',listColumns:[]},can:()=>true,onPreferences:vi.fn(),onStatus:vi.fn(),onOpen:vi.fn(),onMedia:vi.fn(),onReorder:vi.fn()};
afterEach(()=>{cleanup();vi.clearAllMocks()});
it('keeps real nested selection outside the transformed editor and persists pointer selection',async()=>{
 const onChange=vi.fn(async()=>true);render(<PlannerTaskList {...props} onChange={onChange}/>);
 fireEvent.click(screen.getByRole('button',{name:'Priority for Creative task'}));const option=await screen.findByRole('option',{name:'High'});
 expect(option.closest('[data-floating-ancestors]').parentElement).toBe(document.body);
 fireEvent.pointerDown(option);fireEvent.click(option);
 await vi.waitFor(()=>expect(onChange).toHaveBeenCalledWith(task,'priority','high'));
});
it('keeps the date editor open after selecting a calendar date and saves explicitly',async()=>{
 const onChange=vi.fn(async()=>true);render(<PlannerTaskList {...props} onChange={onChange}/>);
 fireEvent.click(screen.getByRole('button',{name:'Production Due Date for Creative task'}));const input=await screen.findByRole('textbox',{name:/Production Due Date/});fireEvent.focus(input);
 const day=await screen.findByRole('button',{name:'15 Oct 2030'});expect(day.closest('[data-floating-ancestors]').parentElement).toBe(document.body);
 fireEvent.pointerDown(day);fireEvent.click(day);expect(screen.getByRole('button',{name:'Save date'})).toBeTruthy();expect(onChange).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Save date'}));await vi.waitFor(()=>expect(onChange).toHaveBeenCalledWith(task,'due_date','2030-10-15'));
});
