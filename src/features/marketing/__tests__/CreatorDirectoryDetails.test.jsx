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
it('sorts two authorized chips, exposes overflow and selects a Brand without opening its row',()=>{
 const brands=Array.from({length:5},(_,i)=>({id:'b'+i,name:'Brand '+i})),creator={id:'creator',collaboration_history:[...brands.map((b,i)=>({brand_id:b.id,collaboration_count:i+2})),{brand_id:'hidden',collaboration_count:99}]},onRowClick=vi.fn(),select=vi.fn();
 render(<DataTable rows={[creator]} getRowKey={r=>r.id} onRowClick={onRowClick} columns={[{key:'history',header:'History',render:c=><CreatorBrandHistory creator={c} brands={brands} compact onSelectBrand={select}/>} ]}/>);
 expect(screen.getAllByRole('button').map(b=>b.textContent)).toEqual(['Brand 46','Brand 35','+3']);expect(screen.queryByText('99')).toBeNull();expect(screen.queryByText('Brand 0')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Show 3 more Brands'}));expect(screen.getByRole('group',{name:'More Brand collaboration history'}).textContent).toBe('Brand 24Brand 13Brand 02');
 fireEvent.click(screen.getByRole('button',{name:'Brand 0: 2 collaborations'}));expect(select).toHaveBeenCalledWith('b0');expect(onRowClick).not.toHaveBeenCalled();expect(screen.queryByRole('group')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Show 3 more Brands'}));fireEvent.keyDown(screen.getByRole('button',{name:'Brand 0: 2 collaborations'}),{key:'Escape'});expect(screen.queryByRole('group')).toBeNull();
});
it('distinguishes no collaboration history from an unavailable projection',()=>{const {rerender}=render(<CreatorBrandHistory creator={{brand_ids:['brand'],collaboration_history:[]}} brands={[{id:'brand',name:'Assigned Brand'}]}/>);expect(screen.getByText('—')).toBeTruthy();expect(screen.queryByText('Assigned Brand')).toBeNull();rerender(<CreatorBrandHistory creator={{}} brands={[]}/>);expect(screen.getByText('Collaboration history unavailable')).toBeTruthy()});
