import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,within} from '@testing-library/react';
import AdminCalendarNavigation from '../AdminCalendarNavigation.jsx';
afterEach(cleanup);
it('groups month, previous, date-picker Today and next without a permanent date input',()=>{
 const change=vi.fn(),previous=vi.fn(),next=vi.fn();render(<AdminCalendarNavigation value="2026-10-16" onChange={change} onPrevious={previous} onNext={next}/>);
 const group=screen.getByRole('group',{name:'Calendar navigation'});
 expect(within(group).getAllByRole('button').map(b=>b.getAttribute('aria-label'))).toEqual(['Month / Year','Previous period','Today','Next period']);
 expect(within(group).queryByRole('textbox')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Previous period'}));expect(previous).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'Next period'}));expect(next).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'Today',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'20 Oct 2026'}));expect(change).toHaveBeenLastCalledWith('2026-10-20');
 fireEvent.click(screen.getByRole('button',{name:'Month / Year'}));fireEvent.click(screen.getByRole('gridcell',{name:'Nov',exact:true}));expect(change).toHaveBeenLastCalledWith('2026-11-01');
});
it('retains the picker Today action for returning to the current date',()=>{
 const change=vi.fn();render(<AdminCalendarNavigation value="2020-01-01" onChange={change}/>);
 fireEvent.click(screen.getByRole('button',{name:'Today',exact:true}));fireEvent.click(screen.getAllByRole('button',{name:'Today',exact:true}).at(-1));
 const now=new Date();expect(change).toHaveBeenCalledWith(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`);
});
