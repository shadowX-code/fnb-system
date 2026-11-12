import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import WhatsAppTemplatesPage from '../WhatsAppTemplatesPage.jsx';
import {marketingService} from '../marketingService.js';

vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>({user:{id:'operator'}})}));
vi.mock('../marketingService.js',()=>({marketingService:{
 context:vi.fn(),whatsappConnections:vi.fn(),whatsappTemplateCatalog:vi.fn(),submitWhatsAppTemplate:vi.fn(),
}}));

const brand={id:'brand',organization_id:'org',name:'Test Restaurant'};
const approved={id:'123',name:'reservation_update',language:'en',category:'UTILITY',status:'APPROVED',
 components:[{type:'BODY',text:'Your reservation has changed.',buttons:[]}],canEdit:false};
const pending={...approved,id:'456',name:'weekend_offer',category:'MARKETING',status:'PENDING'};
const change=(label,value)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
const click=name=>fireEvent.click(screen.getByRole('button',{name,exact:true}));

beforeEach(()=>{
 vi.resetAllMocks();
 localStorage.clear();
 marketingService.context.mockResolvedValue({brands:[brand]});
 marketingService.whatsappConnections.mockResolvedValue({connections:[{id:'connection',brand_id:'brand',credential_generation:6,onboarding_mode:'cloud_api'}]});
 marketingService.whatsappTemplateCatalog.mockResolvedValue({templates:[approved,pending],checkedAt:'2026-11-12T04:00:00Z'});
});
afterEach(cleanup);

it('filters the live library and restores a local draft with a synchronized preview',async()=>{
 render(<WhatsAppTemplatesPage/>);
 await screen.findByText('weekend_offer');
 click('In review 1');
 expect(screen.queryByText('reservation_update')).toBeNull();
 expect(screen.getByText('weekend_offer')).toBeTruthy();
 click('New template');
 expect(screen.queryByRole('heading',{name:'Template Library'})).toBeNull();
 change(/Friendly name/,'Café booking');
 expect(screen.getByLabelText('Meta template name').value).toBe('cafe_booking');
 change('Message body','Your table for {{1}} is ready.');
 change('Body sample for {{1}}','three guests');
 expect(within(screen.getByRole('complementary',{name:'Live WhatsApp preview'})).getByText('Your table for three guests is ready.')).toBeTruthy();
 click('Save Draft');
 expect(await screen.findByText('Draft saved in this browser.')).toBeTruthy();
 cleanup();
 render(<WhatsAppTemplatesPage/>);
 fireEvent.click(await screen.findByRole('button',{name:'Open draft'}));
 expect(screen.getByLabelText('Message body').value).toBe('Your table for {{1}} is ready.');
 expect(screen.getByLabelText('Body sample for {{1}}').value).toBe('three guests');
 expect(marketingService.submitWhatsAppTemplate).not.toHaveBeenCalled();
});

it('validates the editor and waits for explicit confirmation before handing the template to Meta',async()=>{
 marketingService.submitWhatsAppTemplate.mockResolvedValue({id:'789'});
 render(<WhatsAppTemplatesPage/>);
 await screen.findByText('reservation_update');
 click('New template');
 click('Submit for Review');
 expect(screen.getByRole('alert').textContent).toContain('Enter a friendly name');
 change(/Friendly name/,'Booking confirmation');
 change('Text header (optional)','Booking details');
 change('Message body','Your booking is confirmed.');
 change('Footer (optional)','Test Restaurant');
 click('Add button');
 change('Button 1 label','Thanks');
 click('Submit for Review');
 expect(screen.getByRole('dialog',{name:'Submit to Meta for review?'})).toBeTruthy();
 expect(marketingService.submitWhatsAppTemplate).not.toHaveBeenCalled();
 click('Confirm submission');
 await waitFor(()=>expect(marketingService.submitWhatsAppTemplate).toHaveBeenCalledExactlyOnceWith({
  organizationId:'org',brandId:'brand',connectionId:'connection',generation:6,
  template:{name:'booking_confirmation',language:'en',category:'UTILITY',text:'Your booking is confirmed.',samples:[],
   header:'Booking details',headerSample:'',footer:'Test Restaurant',buttons:[{type:'QUICK_REPLY',text:'Thanks'}]},
 }));
 expect(await screen.findByText(/Meta accepted the submission/)).toBeTruthy();
 expect(screen.queryByText('Booking confirmation')).toBeNull();
});

it('places the shared filters beside the table and previews catalog components with their saved examples',async()=>{
 const reservation={
  ...approved,
  components:[
   {type:'HEADER',format:'TEXT',text:'Booking for {{1}}',buttons:[]},
   {type:'BODY',text:'We have a table for {{1}}.',buttons:[]},
   {type:'FOOTER',text:'Test Restaurant',buttons:[]},
   {type:'BUTTONS',buttons:[{type:'QUICK_REPLY',text:'Thanks',needsValue:true}]},
  ],
  editor:{headerSample:'Friday',samples:['three guests']},
 };
 marketingService.whatsappTemplateCatalog.mockResolvedValue({templates:[reservation,pending]});
 render(<WhatsAppTemplatesPage/>);
 const toolbar=await screen.findByRole('region',{name:'Template filters'});
 const table=screen.getByRole('table');
 expect(toolbar.parentElement).toBe(table.closest('.wa-template-list').parentElement);
 for(const label of ['Category','Status','Language']){
  expect(within(toolbar).getByRole('button',{name:label,exact:true}).textContent.trim()).toBe('All');
 }
 click('Preview Reservation update');
 const dialog=screen.getByRole('dialog',{name:'Reservation update'});
 expect(within(dialog).getByText('Approved')).toBeTruthy();
 expect(within(dialog).getByText('Booking for Friday')).toBeTruthy();
 expect(within(dialog).getByText('We have a table for three guests.')).toBeTruthy();
 expect(within(dialog).getAllByText('Test Restaurant')).toHaveLength(2);
 expect(within(dialog).getByText('Thanks').closest('li')).toBeTruthy();
 expect(within(dialog).queryByRole('textbox')).toBeNull();
 expect(marketingService.submitWhatsAppTemplate).not.toHaveBeenCalled();
});
