import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import BusinessCapabilitySelector from './BusinessCapabilitySelector.jsx';
import {externalAgentService} from '../../services/externalAgentService.js';
vi.mock('../../services/externalAgentService.js',()=>({externalAgentService:{review:vi.fn(),confirmAccess:vi.fn(),outletScope:vi.fn(),reviewScoped:vi.fn(),confirmScoped:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const cap={name:'clean',label:'Cleaning',capability:'view',workspace:'Factory',domain:'MeSTI',granted:true,implemented:true,can_assign:true,scope:[{label:'Requirements',resource:'requirements'}]};
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

it('groups distinct action grants under their canonical View owner without granting View implicitly',()=>{
 const view={...cap,module_id:'factory_mesti_cleaning',domain:'MeSTI'};
 const complete={...view,name:'area_cleaning.complete',label:'Area Cleaning',domain:'Factory',capability:'complete',read_only:false,granted:false,requires_human_approval:true};
 render(<BusinessCapabilitySelector capabilities={[view,complete]} identityId="qa" canManage/>);
 expect(screen.getAllByText('Factory / MeSTI').length).toBe(1);
 expect(screen.queryByText('Factory / Factory')).toBeNull();
 fireEvent.click(screen.getByRole('checkbox',{name:'Complete: Area Cleaning'}));
 expect(screen.getByRole('checkbox',{name:'View Records: Cleaning'}).checked).toBe(true);
 expect(screen.getByText(/Human confirmation/)).toBeTruthy();
 expect(externalAgentService.confirmAccess).not.toHaveBeenCalled();
});

it('separates effective grant, pending change and execution requirement',()=>{
 const action={...cap,name:'complete',capability:'complete',read_only:false,granted:false,requires_human_approval:true};
 render(<BusinessCapabilitySelector capabilities={[action]} canManage/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'Complete: Cleaning'}));
 expect(screen.getByText('Effective grant: Restricted')).toBeTruthy();
 expect(screen.getByText('Pending: Grant access')).toBeTruthy();
 expect(screen.getByText('Human confirmation required')).toBeTruthy();
});

it('shows server-owned conditional policy instead of conflating it with a human grant',()=>{
 const action={...cap,name:'approve',capability:'approve',read_only:false,execution_policy:'conditional',execution_reason:'Attested zero variance count required',requires_human_approval:true};
 render(<BusinessCapabilitySelector capabilities={[action]} canManage/>);
 expect(screen.getByText('Conditional')).toBeTruthy();
 expect(screen.getByText('Attested zero variance count required')).toBeTruthy();
});

it('stages Restaurant outlet scope independently and confirms it through the server review',async()=>{
 const restaurant={...cap,name:'restaurant.assets',label:'Assets',workspace:'Restaurant'};
 externalAgentService.outletScope.mockResolvedValue({scope:{type:'selected',outlet_ids:['A']},outlets:[{value:'A',label:'QA A'},{value:'B',label:'QA B'}],can_assign_all:false});
 externalAgentService.reviewScoped.mockResolvedValue({review_hash:'scoped',changes:[],remaining_access:[restaurant],effective_diff:{before:[],after:[],material_changes:[],blockers:[],remaining_shared_access:[]},dependencies:[]});
 externalAgentService.confirmScoped.mockResolvedValue({updated:true});
 render(<BusinessCapabilitySelector capabilities={[restaurant]} identityId="qa" canManage/>);
 await screen.findByRole('checkbox',{name:'QA B'});fireEvent.click(screen.getByRole('checkbox',{name:'QA B'}));
 expect(externalAgentService.confirmScoped).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Review Changes'}));await screen.findByRole('heading',{name:'Review Changes'});
 expect(externalAgentService.reviewScoped).toHaveBeenCalledWith('qa',['restaurant.assets'],{type:'selected',outlet_ids:['A','B']});
 fireEvent.click(screen.getByRole('button',{name:'Confirm changes'}));await waitFor(()=>expect(externalAgentService.confirmScoped).toHaveBeenCalledWith('qa',['restaurant.assets'],{type:'selected',outlet_ids:['A','B']},'scoped'));
});
it('cannot stage Restaurant access from an unavailable scope projection',async()=>{
 externalAgentService.outletScope.mockRejectedValue(new Error('unavailable'));
 render(<BusinessCapabilitySelector capabilities={[{...cap,workspace:'Restaurant'}]} identityId="qa" canManage/>);
 await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Review Changes'}).disabled).toBe(true);
});

it('separates inspection and asset action rows while preserving the shared View dependency',()=>{
 const view={...cap,name:'restaurant.view.asset_tracking',workspace:'Restaurant',module_id:'asset_tracking',label:'Asset Tracking'};
 externalAgentService.outletScope.mockResolvedValue({scope:{type:'selected',outlet_ids:['A']},outlets:[{value:'A',label:'QA A'}]});
 const asset={...view,name:'restaurant_asset.create',label:'Asset',workflow_id:'asset_tracking',capability:'create',read_only:false};
 const inspection={...asset,name:'restaurant_inspection.create',label:'Asset Inspection',workflow_id:'asset_tracking_inspections'};
 render(<BusinessCapabilitySelector capabilities={[view,asset,inspection]} canManage/>);
 expect(screen.getByText('Asset Inspection')).toBeTruthy();expect(screen.getByRole('checkbox',{name:'Create: Asset'})).toBeTruthy();expect(screen.getByRole('checkbox',{name:'Create: Asset Inspection'})).toBeTruthy();
});
