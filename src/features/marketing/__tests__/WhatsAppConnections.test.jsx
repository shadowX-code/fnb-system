import {it,expect,vi,beforeEach} from 'vitest';
import {render,screen,waitFor,cleanup,fireEvent,within} from '@testing-library/react';
import WhatsAppConnections from '../WhatsAppConnections.jsx';
import {marketingService} from '../marketingService.js';
import {loadWhatsAppSDK,launchWhatsAppSignup} from '../whatsappSignup.js';

vi.mock('../marketingService.js',()=>({marketingService:{whatsappConnections:vi.fn(),whatsappReadiness:vi.fn(),bindWhatsAppCloudTest:vi.fn(),beginWhatsApp:vi.fn(),completeWhatsApp:vi.fn(),verifyWhatsApp:vi.fn(),whatsappLocalCommand:vi.fn()}}));
vi.mock('../whatsappSignup.js',async importOriginal=>({...await importOriginal(),loadWhatsAppSDK:vi.fn(),launchWhatsAppSignup:vi.fn()}));
vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>({user:{id:'user'},hasPermission:()=>true})}));

const props={organizationId:'org',brandId:'brand',brands:[{id:'brand',name:'Restaurant'}]};
const read=()=>screen.findByRole('button',{name:'Connect WhatsApp',exact:true});
async function pickMode(mode){
 fireEvent.click(await read());
 fireEvent.click(screen.getByRole('radio',{name:new RegExp(mode)}));
}
beforeEach(()=>{
 cleanup();
 vi.resetAllMocks();
 marketingService.whatsappConnections.mockResolvedValue({connections:[]});
 marketingService.whatsappReadiness.mockResolvedValue({can_configure:true,eligible:false,reason:'pilot_activation_required'});
});

it.each(['Keep using WhatsApp Business App','Use a dedicated WhatsApp number'])('explains pending approval for %s without launching Meta',async mode=>{
 render(<WhatsAppConnections {...props}/>);
 await pickMode(mode);
 expect(screen.getByText('Meta approval pending')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Continue with Meta'}).disabled).toBe(true);
 expect(screen.queryByText(/Test WABA|signup rehearsal/)).toBeNull();
 expect(marketingService.beginWhatsApp).not.toHaveBeenCalled();
});

it('requires post-Meta confirmation of the exact selected number before completing',async()=>{
 marketingService.whatsappReadiness.mockResolvedValue({eligible:true,can_configure:true,mode:'new_number'});
 marketingService.beginWhatsApp.mockResolvedValue({id:'session',state:'state'});
 launchWhatsAppSignup.mockResolvedValue({code:'code',assets:{mode:'new_number'}});
 marketingService.completeWhatsApp.mockResolvedValue({});
 render(<WhatsAppConnections {...props}/>);
 await pickMode('Use a dedicated WhatsApp number');
 const launch=await screen.findByRole('button',{name:'Continue with Meta'});
 await waitFor(()=>expect(launch.disabled).toBe(false));
 fireEvent.click(launch);
 const confirm=await screen.findByRole('button',{name:'Confirm and verify'});
 expect(confirm.disabled).toBe(true);
 expect(marketingService.completeWhatsApp).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole('textbox',{name:'WhatsApp number'}),{target:{value:'+60 123-456789'}});
 fireEvent.click(screen.getByRole('checkbox',{name:/authorized to connect this number/}));
 fireEvent.click(confirm);
 await waitFor(()=>expect(marketingService.completeWhatsApp).toHaveBeenCalledWith(expect.objectContaining({brandId:'brand',sessionId:'session',confirmBrandOwnership:true,confirmPhoneNumber:'+60123456789'})));
});

it('discards a late response from the previous Brand',async()=>{
 let oldResolve;
 marketingService.whatsappConnections.mockImplementationOnce(()=>new Promise(r=>{oldResolve=r;})).mockResolvedValue({connections:[]});
 const view=render(<WhatsAppConnections {...props} brandId="old"/>);
 view.rerender(<WhatsAppConnections {...props}/>);
 await read();
 oldResolve({connections:[{id:'old',account_name:'Old private connection',brand_id:'old'}]});
 await waitFor(()=>expect(screen.queryByText('Old private connection')).toBeNull());
});

it('keeps a test binding in Staging tools while preserving its test controls',async()=>{
 marketingService.whatsappReadiness.mockResolvedValue({can_configure:true,cloud_test_configured:true,eligible:false});
 marketingService.whatsappConnections.mockResolvedValue({connections:[{id:'test',brand_id:'brand',account_name:'Meta Cloud API test number',onboarding_mode:'cloud_api',state:'action_required',reason:'reconnect_required',local_state:'active',credential_generation:5}]});
 const customer=render(<WhatsAppConnections {...props}/>);
 await read();
 expect(screen.queryByText('Meta Cloud API test number')).toBeNull();
 customer.unmount();
 render(<WhatsAppConnections {...props} testing/>);
 fireEvent.click(await screen.findByRole('button',{name:'Verify test number again'}));
 await waitFor(()=>expect(marketingService.bindWhatsAppCloudTest).toHaveBeenCalledWith({organizationId:'org',brandId:'brand',generation:5}));
 fireEvent.click(screen.getByRole('button',{name:'Rehearse WhatsApp signup'}));
 fireEvent.click(screen.getByRole('button',{name:'Run simulated callback'}));
 expect(screen.getByText(/Sample callback passed/)).toBeTruthy();
 expect(marketingService.beginWhatsApp).not.toHaveBeenCalled();
});

it.each([['pause','Pause receiving','Confirm pause'],['disconnect','Disconnect from FeedX','Confirm local disconnect']])('confirms %s locally without opening Meta',async(action,button,confirm)=>{
 marketingService.whatsappConnections.mockResolvedValue({connections:[{id:'connection',brand_id:'brand',account_name:'+60123456789',onboarding_mode:'coexistence',state:'action_required',local_state:'active',credential_generation:7}]});
 marketingService.whatsappLocalCommand.mockResolvedValue({});
 render(<WhatsAppConnections {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Manage Connection'}));
 fireEvent.click(within(screen.getByRole('dialog',{name:'Manage Connection'})).getByRole('button',{name:button}));
 expect(marketingService.whatsappLocalCommand).not.toHaveBeenCalled();
 expect(screen.getByText(/Your mobile app keeps working/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:confirm}));
 await waitFor(()=>expect(marketingService.whatsappLocalCommand).toHaveBeenCalledWith(expect.any(String),'connection',7,action));
 expect(marketingService.beginWhatsApp).not.toHaveBeenCalled();
});
