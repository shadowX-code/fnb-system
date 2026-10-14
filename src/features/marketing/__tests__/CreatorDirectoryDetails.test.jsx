import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {CreatorAccountLinks,CreatorBrandHistory} from '../CreatorDirectoryDetails.jsx';
import DataTable from '../../../components/tables/DataTable.jsx';
afterEach(cleanup);
it('opens only validated saved profile URLs and leaves row interaction independent',()=>{
 const onRowClick=vi.fn(),accounts=[{id:'a',platform:'instagram',handle:'alias',profile_url:'https://instagram.com/alias/?utm=tracking'},{id:'b',platform:'tiktok',handle:'no_url'},{id:'c',platform:'xhs',handle:'unsafe',profile_url:'javascript:alert(1)'},{id:'d',platform:'facebook',handle:'mismatch',profile_url:'https://instagram.com/other/'}];
 render(<DataTable rows={[{id:'creator'}]} getRowKey={r=>r.id} onRowClick={onRowClick} columns={[{key:'accounts',header:'Accounts',render:()=> <CreatorAccountLinks accounts={accounts}/>} ]}/>);
 const link=screen.getByRole('link',{name:'Open Instagram profile @alias'});expect(link.getAttribute('href')).toBe('https://www.instagram.com/alias/');expect(link.getAttribute('target')).toBe('_blank');expect(screen.getAllByRole('link')).toHaveLength(1);fireEvent.click(link);expect(onRowClick).not.toHaveBeenCalled();fireEvent.click(screen.getByText('@no_url'));expect(onRowClick).toHaveBeenCalledTimes(1);
});
it('shows bounded Brand summaries and complete authorized detail without inferring assignments',()=>{
 const brands=Array.from({length:5},(_,i)=>({id:'b'+i,name:'Brand '+i})),creator={brand_ids:['assigned-only'],collaboration_history:[...brands.map((b,i)=>({brand_id:b.id,collaboration_count:i+2})),{brand_id:'hidden',collaboration_count:99}]};
 const {rerender}=render(<CreatorBrandHistory creator={creator} brands={brands} compact/>);expect(screen.getByText('Brand 0')).toBeTruthy();expect(screen.getByText('2')).toBeTruthy();expect(screen.getByText('+2')).toBeTruthy();expect(screen.queryByText('99')).toBeNull();expect(screen.queryByText('Brand 4')).toBeNull();
 rerender(<CreatorBrandHistory creator={creator} brands={brands}/>);expect(screen.getByText('Brand 4')).toBeTruthy();expect(screen.queryByText('+2')).toBeNull();
});
it('distinguishes no collaboration history from an unavailable projection',()=>{const {rerender}=render(<CreatorBrandHistory creator={{brand_ids:['brand'],collaboration_history:[]}} brands={[{id:'brand',name:'Assigned Brand'}]}/>);expect(screen.getByText('No collaboration history')).toBeTruthy();expect(screen.queryByText('Assigned Brand')).toBeNull();rerender(<CreatorBrandHistory creator={{}} brands={[]}/>);expect(screen.getByText('Collaboration history unavailable')).toBeTruthy()});
