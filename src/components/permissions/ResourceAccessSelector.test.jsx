import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import ResourceAccessSelector from './ResourceAccessSelector.jsx';
afterEach(cleanup);
const owner={name:'overview',module_id:'overview',label:'Overview',workspace:'Factory',section:'Factory',granted:true,implemented:true,can_assign:true};
const source={...owner,name:'production',module_id:'production',label:'Production Records',granted:false};
const optional={...source,name:'locations',label:'Locations'};
const resource={workspace:'Factory',scope:'Production',resource:'pipeline',label:'Pipeline',owner:'Overview',module_id:'overview',grant_name:'overview',required:[owner,source],optional:[optional],unsupported:['Draft','Execute','Approve'],affected_resources:['Pipeline','Monthly performance']};
it('resolves required versus optional grants and reviews only explicitly requested changes',()=>{
 const review=vi.fn();render(<ResourceAccessSelector resources={[resource]} capabilities={[owner,source,optional]} canManage onChangeMany={review}/>);
 expect(screen.getByText(/Needs dependencies/)).toBeTruthy();expect(screen.getByText(/Optional related data: Locations/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Review required grants'}));expect(review.mock.calls[0][0].map(r=>r.name)).toEqual(['production']);expect(review.mock.calls[0][2]).toContain('Optional permissions are not included');
 fireEvent.click(screen.getByRole('button',{name:'Review removal'}));expect(review.mock.calls[1][1]).toBe(false);expect(review.mock.calls[1][2]).toContain('Pipeline');
});
it('uses the same module projection and requires explicit registration selection approval',()=>{
 const select=vi.fn();render(<ResourceAccessSelector resources={[resource]} capabilities={[owner,source,optional]} selection={[]} onSelectMany={select}/>);
 fireEvent.click(screen.getByRole('button',{name:'Review required grants'}));expect(select).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Add to selection'}));expect(select).toHaveBeenCalledWith(['overview','production'],true);
 fireEvent.click(screen.getByRole('tab',{name:'By Module'}));expect(screen.getByRole('checkbox',{name:'View Records: Overview'})).toBeTruthy();
});
