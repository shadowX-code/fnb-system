import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import PlannerActivity from '../PlannerActivity.jsx';
afterEach(cleanup);
const history=Array.from({length:25},(_,i)=>({revision:25-i,action:i<12?'ordered':i===12?'request_revision':'save',date:i<20?'2026-10-21T16:05:00Z':'2026-10-21T15:55:00Z',actor:'Lin',feedback:'Keep full feedback\nSecond line',state:{status:'revision_needed',priority:'normal',assignee_id:null}}));
it('defaults to recent meaningful activity, groups dates, paginates and preserves full revision feedback',()=>{
 const {container}=render(<PlannerActivity history={history}/>);fireEvent.click(screen.getByText('Activity',{exact:true}));expect(container.querySelectorAll('article')).toHaveLength(10);expect(screen.getByText('Keep full feedback Second line')).toBeTruthy();expect(screen.getByText('12 order updates in All Activity')).toBeTruthy();expect(screen.getByRole('region',{name:'22 Oct 2026'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Load More'}));expect(container.querySelectorAll('article')).toHaveLength(13);expect(screen.queryByRole('button',{name:'Load More'})).toBeNull();expect(screen.getAllByText('Keep full feedback Second line')).toHaveLength(1);
});
it('All Activity retains all individual ordered records and exact actors/timestamps in collapsed groups',()=>{
 const {container}=render(<PlannerActivity history={history}/>);fireEvent.click(screen.getByText('Activity',{exact:true}));fireEvent.click(screen.getByRole('tab',{name:'All Activity'}));expect(container.querySelectorAll('.planner-order-activity')).toHaveLength(1);expect(container.querySelector('.planner-order-activity').open).toBe(false);fireEvent.click(screen.getByText('Show order history'));expect(container.querySelector('.planner-order-activity').open).toBe(true);expect(within(container.querySelector('.planner-order-activity')).getAllByText('Lin')).toHaveLength(10);fireEvent.click(screen.getByRole('button',{name:'Load More'}));fireEvent.click(screen.getByRole('button',{name:'Load More'}));expect([...container.querySelectorAll('[data-activity-id]')].filter(n=>!n.dataset.activityId.startsWith('order-')).map(n=>n.dataset.activityId)).toEqual(history.map(h=>String(h.revision)));expect(screen.queryByRole('button',{name:'Load More'})).toBeNull();
});
it('handles reorder-only and empty histories without losing access',()=>{
 const {rerender}=render(<PlannerActivity history={[history[0]]}/>);expect(screen.getByText('No meaningful activity yet.')).toBeTruthy();fireEvent.click(screen.getByRole('tab',{name:'All Activity'}));expect(screen.getByText('Show order history')).toBeTruthy();rerender(<PlannerActivity history={[]}/>);expect(screen.queryByText('Activity')).toBeNull();
});
