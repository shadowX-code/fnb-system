import {it,expect,vi,beforeEach} from 'vitest';
import {render,screen,waitFor,cleanup,fireEvent} from '@testing-library/react';
import WhatsAppConnections from '../WhatsAppConnections.jsx';
import {marketingService} from '../marketingService.js';
vi.mock('../marketingService.js',()=>({marketingService:{whatsappConnections:vi.fn(),whatsappReadiness:vi.fn(),beginWhatsApp:vi.fn(),verifyWhatsApp:vi.fn(),whatsappLocalCommand:vi.fn()}}));
vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>({user:{id:'user'},hasPermission:()=>true})}));
beforeEach(()=>{cleanup();vi.clearAllMocks();marketingService.whatsappReadiness.mockResolvedValue({eligible:false,state:'verification_required',reason:'pilot_activation_required'});});
it('blocks live signup while eligibility is missing',async()=>{
 marketingService.whatsappConnections.mockResolvedValue({connections:[]});
 render(<WhatsAppConnections organizationId="org" brandId="brand"/>);
 expect(await screen.findByText('No WhatsApp Cloud connection registered.')).toBeTruthy();
 expect(screen.getByText('Verification Required')).toBeTruthy();expect(screen.getByRole('button',{name:'Connect WhatsApp'}).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Connect WhatsApp'}));expect(marketingService.beginWhatsApp).not.toHaveBeenCalled();expect(screen.queryByRole('textbox')).toBeNull();
});
it('discards a late response from the previous Brand',async()=>{
 let oldResolve;marketingService.whatsappConnections.mockImplementationOnce(()=>new Promise(r=>{oldResolve=r;})).mockResolvedValue({connections:[]});
 const view=render(<WhatsAppConnections organizationId="org" brandId="old"/>);
 view.rerender(<WhatsAppConnections organizationId="org" brandId="new"/>);
 await screen.findByText('No WhatsApp Cloud connection registered.');
 oldResolve({connections:[{id:'old',account_name:'Old private connection',brand_id:'old'}]});
 await waitFor(()=>expect(screen.queryByText('Old private connection')).toBeNull());
});

it('requires one selected Brand before offering onboarding',async()=>{marketingService.whatsappConnections.mockResolvedValue({connections:[]});render(<WhatsAppConnections organizationId="org" brandId=""/>);await screen.findByText('Select one Brand to verify or connect WhatsApp.');expect(screen.queryByRole('button',{name:'Connect WhatsApp'})).toBeNull();});

it.each([['pause','Pause receiving','Confirm pause'],['disconnect','Disconnect from FeedX','Confirm local disconnect']])('confirms %s locally without Meta calls, even when live signup is disabled',async(action,button,confirm)=>{
 marketingService.whatsappConnections.mockResolvedValue({connections:[{id:'connection',brand_id:'brand',account_name:'Fixture WhatsApp',state:'action_required',local_state:'active',credential_generation:7}]});
 marketingService.whatsappLocalCommand.mockResolvedValue({generation:8,provider_offboarded:false});
 render(<WhatsAppConnections organizationId="org" brandId="brand"/>);
 fireEvent.click(await screen.findByRole('button',{name:button}));
 expect(marketingService.whatsappLocalCommand).not.toHaveBeenCalled();expect(screen.getByText(/Your mobile app keeps working/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:confirm}));
 await waitFor(()=>expect(marketingService.whatsappLocalCommand).toHaveBeenCalledWith(expect.any(String),'connection',7,action));
 expect(marketingService.beginWhatsApp).not.toHaveBeenCalled();expect(marketingService.verifyWhatsApp).not.toHaveBeenCalled();
});
it('requires an explicit verified Resume action for a paused connection',async()=>{
 marketingService.whatsappReadiness.mockResolvedValue({eligible:true,state:'eligible'});
 marketingService.whatsappConnections.mockResolvedValue({connections:[{id:'connection',brand_id:'brand',account_name:'Paused fixture',state:'action_required',local_state:'paused',credential_generation:8}]});
 marketingService.verifyWhatsApp.mockResolvedValue({});render(<WhatsAppConnections organizationId="org" brandId="brand"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Resume receiving'}));
 await waitFor(()=>expect(marketingService.verifyWhatsApp).toHaveBeenCalledWith({organizationId:'org',brandId:'brand',connectionId:'connection',generation:8,resumeReceiving:true}));
});
