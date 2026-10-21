import {it,expect,vi,beforeEach} from 'vitest';
import {render,screen,waitFor,cleanup,fireEvent} from '@testing-library/react';
import WhatsAppConnections from '../WhatsAppConnections.jsx';
import {marketingService} from '../marketingService.js';
vi.mock('../marketingService.js',()=>({marketingService:{whatsappConnections:vi.fn(),whatsappReadiness:vi.fn(),beginWhatsApp:vi.fn()}}));
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
