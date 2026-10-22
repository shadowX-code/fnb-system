import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import Timeline from '../Timeline.jsx';
afterEach(cleanup);
it('groups in the requested timezone and keeps exact input order when canonical ordering is supplied',()=>{
 const events=[{id:'2',title:'New',date:'2026-10-21T16:00:00Z',actor:'Lin',feedback:'Full\ntext'},{id:'1',title:'Old',date:'2026-10-21T15:59:00Z'}];const {container}=render(<Timeline events={events} newestFirst={false} groupByDate timeZone="Asia/Kuala_Lumpur" variant="activity"/>);expect(screen.getByRole('region',{name:'22 Oct 2026'})).toBeTruthy();expect(screen.getByRole('region',{name:'21 Oct 2026'})).toBeTruthy();expect([...container.querySelectorAll('article')].map(n=>n.dataset.activityId)).toEqual(['2','1']);expect(container.querySelector('blockquote').textContent).toBe('Full\ntext');expect(screen.getByText('Lin')).toBeTruthy();
});
it('preserves existing default date ordering and unknown-date fallback',()=>{
 const {container}=render(<Timeline events={[{id:'1',title:'Old',date:'2026-01-01'},{id:'2',title:'New',date:'2026-02-01'},{id:'3',title:'Unknown',date:'invalid'}]}/>);expect([...container.querySelectorAll('article')].map(n=>n.dataset.activityId)).toEqual(['2','1','3']);expect(screen.getByText('No date')).toBeTruthy();
});
