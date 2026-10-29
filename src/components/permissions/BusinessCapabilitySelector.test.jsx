import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import BusinessCapabilitySelector from './BusinessCapabilitySelector.jsx';
import {externalAgentService} from '../../services/externalAgentService.js';
vi.mock('../../services/externalAgentService.js',()=>({externalAgentService:{review:vi.fn(),confirmAccess:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const cap={name:'clean',label:'Cleaning',workspace:'Factory',domain:'MeSTI',granted:true,implemented:true,can_assign:true,scope:[{label:'Requirements',resource:'requirements'}]};
it('stages changes and requires a server review and explicit confirmation',async()=>{
 externalAgentService.review.mockResolvedValue({changes:[{...cap,granted:false}],remaining_access:[{...cap,name:'review',label:'MeSTI Review'}],effective_diff:{before:[],after:[],material_changes:[],blockers:[],remaining_shared_access:[{removed:'Cleaning',via:'MeSTI Review',note:'Redacted findings remain.'}]},dependencies:[],review_hash:'hash',note:'No automatic grants'});
 externalAgentService.confirmAccess.mockResolvedValue({updated:true});
 render(<BusinessCapabilitySelector capabilities={[cap]} identityId="qa" canManage/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'View Records: Cleaning'}));expect(externalAgentService.confirmAccess).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Review Changes'}));await screen.findByRole('heading',{name:'Review Changes'});expect(externalAgentService.review).toHaveBeenCalledWith('qa',[]);expect(screen.getByText('Cleaning → MeSTI Review')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Confirm changes'}));await waitFor(()=>expect(externalAgentService.confirmAccess).toHaveBeenCalledWith('qa',[],'hash'));
});
it('uses the same review path for registration and prevents unavailable independent scopes',async()=>{
 const confirm=vi.fn();externalAgentService.review.mockResolvedValue({changes:[{...cap,granted:true}],remaining_access:[cap],effective_diff:{before:[],after:[],material_changes:[],blockers:[],remaining_shared_access:[]},dependencies:[],review_hash:'registration',note:''});
 render(<BusinessCapabilitySelector capabilities={[{...cap,granted:false}]} canManage registration onConfirmRegistration={confirm}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'View Records: Cleaning'}));expect(confirm).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Review Changes'}));await screen.findByRole('heading',{name:'Review Changes'});fireEvent.click(screen.getByRole('button',{name:'Confirm and connect'}));await waitFor(()=>expect(confirm).toHaveBeenCalledWith(['clean'],'registration'));
 expect(screen.queryByRole('tab',{name:'By Module'})).toBeNull();
});

it('starts registration empty even if supplied catalog rows contain saved grant flags',()=>{
 render(<BusinessCapabilitySelector capabilities={[cap]} canManage registration onConfirmRegistration={vi.fn()}/>);
 expect(screen.getByRole('checkbox',{name:'View Records: Cleaning'}).checked).toBe(false);
 expect(screen.getByRole('button',{name:'Review Changes'}).disabled).toBe(true);
});

it('keeps selection rows compact and scope details optional without rendering raw JSON',()=>{
 render(<BusinessCapabilitySelector capabilities={[cap,{...cap,name:'other',label:'Other',granted:false}]} canManage/>);
 expect(screen.queryByText('Not currently allowed')).toBeNull();
 expect(screen.queryByText('Currently allowed')).toBeNull();
 expect(document.querySelector('pre')).toBeNull();
 expect(screen.getAllByText('Access Details').length).toBe(2);
});

it('disables confirmation when the complete server-derived exposure review is unavailable',async()=>{
 externalAgentService.review.mockResolvedValue({changes:[{...cap,granted:false}],remaining_access:[],review_hash:'hash'});
 render(<BusinessCapabilitySelector capabilities={[cap]} identityId="qa" canManage/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'View Records: Cleaning'}));fireEvent.click(screen.getByRole('button',{name:'Review Changes'}));
 await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Confirm changes'}).disabled).toBe(true);
});
