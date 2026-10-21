import {it,expect,vi,beforeEach} from 'vitest';
import {render,screen,waitFor,cleanup} from '@testing-library/react';
import WhatsAppConnections from '../WhatsAppConnections.jsx';
import {marketingService} from '../marketingService.js';
vi.mock('../marketingService.js',()=>({marketingService:{whatsappConnections:vi.fn()}}));
beforeEach(()=>{cleanup();vi.clearAllMocks();});
it('shows disabled foundation without connect, credential or send controls',async()=>{
 marketingService.whatsappConnections.mockResolvedValue({connections:[]});
 render(<WhatsAppConnections organizationId="org" brandId="brand"/>);
 expect(await screen.findByText('No WhatsApp Cloud connection registered.')).toBeTruthy();
 expect(screen.getByText('Disabled')).toBeTruthy();expect(screen.queryByRole('button',{name:/connect|send|activate/i})).toBeNull();expect(screen.queryByRole('textbox')).toBeNull();
});
it('discards a late response from the previous Brand',async()=>{
 let oldResolve;marketingService.whatsappConnections.mockImplementationOnce(()=>new Promise(r=>{oldResolve=r;})).mockResolvedValue({connections:[]});
 const view=render(<WhatsAppConnections organizationId="org" brandId="old"/>);
 view.rerender(<WhatsAppConnections organizationId="org" brandId="new"/>);
 await screen.findByText('No WhatsApp Cloud connection registered.');
 oldResolve({connections:[{id:'old',account_name:'Old private connection',brand_id:'old'}]});
 await waitFor(()=>expect(screen.queryByText('Old private connection')).toBeNull());
});
