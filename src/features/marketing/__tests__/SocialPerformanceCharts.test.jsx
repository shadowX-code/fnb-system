import {describe,it,expect,afterEach} from 'vitest';
import {render,screen,cleanup,fireEvent} from '@testing-library/react';
import {SocialTrendChart,SocialComparisonChart} from '../SocialPerformanceCharts.jsx';
const point=(date,value,cohort='same')=>({date,channels:{facebook:{value,available:value===null?0:1,total:2,cohort,starting:date},instagram:{value:null,available:0,total:0}}});
afterEach(cleanup);
describe('Social chart evidence rendering',()=>{
 it('does not draw a misleading single-point trend',()=>{
  render(<SocialTrendChart metric="views" basis="cumulative" grain="day" data={[point('2026-10-13',12)]}/>);
  expect(screen.getByText('Insufficient history')).toBeTruthy();expect(screen.queryByRole('group',{name:'views cumulative trend'})).toBeNull();
 });
 it('keeps zero inspectable, gaps disconnected and partial coverage in tooltips',()=>{
  const {container}=render(<SocialTrendChart metric="interactions" basis="growth" grain="day" data={[point('2026-10-11',0),point('2026-10-12',null),point('2026-10-13',2)]}/>);
  expect(container.querySelector('.admin-chart-series').getAttribute('d')).not.toContain('L');
  fireEvent.click(screen.getByRole('button',{name:/11 Oct: Facebook 0, 1\/2 posts/}));
  expect(screen.getByRole('tooltip').textContent).toContain('0 · 1/2 posts');
 });
 it('disconnects changed cumulative cohorts rather than implying growth of the same posts',()=>{
  const {container}=render(<SocialTrendChart metric="views" basis="cumulative" grain="day" data={[point('2026-10-11',12,'old'),point('2026-10-12',20,'new')]}/>);
  expect(container.querySelector('.admin-chart-series').getAttribute('d')).not.toContain('L');
 });
 it('renders monthly publication labels without inventing a day timestamp',()=>{
  render(<SocialTrendChart metric="views" basis="publication" grain="month" data={[point('2026-09',12),point('2026-10',20)]}/>);
  expect(screen.getByText('Sept 2026')).toBeTruthy();expect(screen.getByText('Oct 2026')).toBeTruthy();
 });
 it('comparison uses the same supplied values, including zero and unavailable',()=>{
  render(<SocialComparisonChart metric="Views" rows={[{channel:'facebook',value:0,coverage:'1 of 2 posts with data'},{channel:'instagram',value:null,coverage:'0 of 1 posts with data'}]}/>);
  expect(screen.getByRole('button',{name:'Facebook Views: 0'})).toBeTruthy();expect(screen.getByText('Unavailable')).toBeTruthy();
 });
});
