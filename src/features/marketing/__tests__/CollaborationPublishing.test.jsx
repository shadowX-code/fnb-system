import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {CollaborationPublishingSummary} from '../CollaborationPublishing.jsx';
import DataTable from '../../../components/tables/DataTable.jsx';
afterEach(cleanup);
it('uses actual Post links and dates, compact overflow, and independent row navigation',()=>{
 const collaboration={id:'c',deliverables:[{id:'planned',platform:'tiktok',status:'pending'}]},posts=Array.from({length:4},(_,i)=>({id:'p'+i,collaboration_id:'c',platform:i?'xhs':'instagram',canonical_url:'https://www.instagram.com/p/real'+i+'/',published_date:'2026-10-13'})),onRowClick=vi.fn();
 render(<DataTable rows={[collaboration]} getRowKey={r=>r.id} columns={[{key:'publishing',header:'Publishing',render:c=><CollaborationPublishingSummary collaboration={c} posts={posts}/>}]} onRowClick={onRowClick}/>);
 expect(screen.getByText('4/5 Published')).toBeTruthy();expect(screen.getByText('+2')).toBeTruthy();expect(screen.getAllByText('13 Oct 2026')).toHaveLength(2);
 const link=screen.getByRole('link',{name:'Open Instagram post · 13 Oct 2026'});expect(link.getAttribute('href')).toBe(posts[0].canonical_url);fireEvent.click(link);expect(onRowClick).not.toHaveBeenCalled();fireEvent.click(screen.getByText('4/5 Published'));expect(onRowClick).toHaveBeenCalledTimes(1);
});
