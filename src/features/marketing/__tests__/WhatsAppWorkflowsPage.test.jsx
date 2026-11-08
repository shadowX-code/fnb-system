import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import WhatsAppWorkflowsPage from '../WhatsAppWorkflowsPage.jsx';
import {marketingService} from '../marketingService.js';
const auth=vi.hoisted(()=>({user:{id:'tester'},hasPermission:vi.fn()}));
vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>auth}));
vi.mock('../marketingService.js',()=>({marketingService:{context:vi.fn(),whatsappWorkflows:vi.fn(),whatsappWorkflowCommand:vi.fn()}}));

afterEach(cleanup);const record={id:'flow',title:'Opening invitation',revision:1,state:'draft',batch_size:30,follow_up_hours:24};
beforeEach(()=>{
 vi.resetAllMocks();auth.hasPermission.mockReturnValue(true);
 marketingService.context.mockResolvedValue({organizations:[{id:'org'}],brands:[{id:'brand',organization_id:'org',name:'Fixture Brand'}]});
 marketingService.whatsappWorkflows.mockResolvedValue({rows:[],history:[],live_execution:false});
});
it('saves the named draft and simulates against the returned revision without any real send control',async()=>{
 const trace=[{step:'Wait 24 hours',result:'Would queue one approved reminder'}];
 marketingService.whatsappWorkflowCommand.mockImplementation(async input=>input.action==='save'?{...record}:{...record,trace});
 marketingService.whatsappWorkflows.mockImplementation(async(_org,_brand,id)=>({rows:id?[record]:[],history:[]}));
 render(<WhatsAppWorkflowsPage/>);
 const title=await screen.findByRole('textbox',{name:/Workflow name/});
 fireEvent.change(title,{target:{value:record.title}});
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
 await screen.findByText('Draft saved.');
 await waitFor(()=>expect(screen.getByRole('button',{name:'Run simulation'}).disabled).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:'Run simulation'}));
 await screen.findByText('Wait 24 hours');
 expect(marketingService.whatsappWorkflowCommand).toHaveBeenCalledWith(expect.objectContaining({workflow:'flow',revision:1,action:'simulate',scenario:'no_reply'}));
 expect(screen.queryByRole('button',{name:'Send',exact:true})).toBeNull();
});
it('does not expose editing or simulation to a viewer',async()=>{
 auth.hasPermission.mockReturnValue(false);
 render(<WhatsAppWorkflowsPage/>);
 await screen.findByRole('textbox',{name:/Workflow name/});
 expect(screen.queryByRole('button',{name:'Save draft'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Run simulation'})).toBeNull();
 expect(marketingService.whatsappWorkflowCommand).not.toHaveBeenCalled();
});
