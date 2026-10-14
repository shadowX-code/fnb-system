import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import CustomerDetailDrawer from '../CustomerDetailDrawer.jsx';
const {customers}=vi.hoisted(()=>({customers:vi.fn()}));
vi.mock('../outreachService.js',()=>({outreachService:{customers}}));
const row={id:'c',display_name:'Actual customer',phone_e164:'+60123456789',tags:['Regular'],brand_name:'Permitted brand',language:'EN',active:true,eligible:false,suppressed:true,detail:{segments:[{id:'s',name:'Regulars'}],consent_history:[{record_order:2,decision:'withdrawn',source:'One-test withdrawal',evidence:'Customer requested withdrawal',occurred_at:'2026-10-11T10:00:00Z'}],activity_available:true,activity:[{event_id:1,campaign:'Reviewed campaign',action:'confirm',created_at:'2026-10-11T09:00:00Z'}]}};
beforeEach(()=>{cleanup();vi.clearAllMocks();customers.mockResolvedValue({customers:[row],total:1})});
describe('Customer detail evidence',()=>{
 it('reads only the exact scoped identity and renders recorded consent and staff activity',async()=>{
  render(<CustomerDetailDrawer org="o" brand="b" customerId="c" can={()=>false} onClose={()=>{}}/>);
  await screen.findByText('Regular');expect(screen.queryByText('Regulars')).toBeNull();expect(customers).toHaveBeenCalledWith('o','b',{detail:'c'},1,20);
  fireEvent.click(screen.getByRole('tab',{name:'Consent history'}));await screen.findAllByText('Do Not Contact');expect(screen.getByText('Customer requested withdrawal')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab',{name:'Activity'}));await screen.findByText('Staff confirmed sent');expect(screen.queryByText('Delivered')).toBeNull();expect(screen.queryByRole('button',{name:'Edit'})).toBeNull();
 });
 it('never invents activity or reveals it when unavailable',async()=>{
  customers.mockResolvedValue({customers:[{...row,detail:{segments:[],consent_history:[],activity_available:false,activity:null}}]});
  render(<CustomerDetailDrawer org="o" brand="b" customerId="c" can={()=>false} onClose={()=>{}}/>);await screen.findByText('Regular');
  fireEvent.click(screen.getByRole('tab',{name:'Activity'}));expect(screen.getByText(/unavailable with your current access/)).toBeTruthy();expect(screen.queryByText('Reviewed campaign')).toBeNull();
 });
 it('clears previous customer evidence on a scope change and ignores late responses',async()=>{
  let resolve;customers.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));
  const view=render(<CustomerDetailDrawer org="o" brand="b" customerId="old" can={()=>false} onClose={()=>{}}/>);
  view.rerender(<CustomerDetailDrawer org="o" brand="new" customerId="new" can={()=>false} onClose={()=>{}}/>);
  await screen.findByText('Customer unavailable');resolve({customers:[{...row,id:'old'}]});await waitFor(()=>expect(screen.queryByText('Actual customer')).toBeNull());
 });
});

it('offers direct consent update separately from basic customer editing',async()=>{
 const show=vi.fn(),onClose=vi.fn();render(<CustomerDetailDrawer org="o" brand="b" customerId="c" can={permission=>permission==='marketing_audience.manage'} show={show} onClose={onClose}/>);
 await screen.findByText('Regular');fireEvent.click(screen.getByRole('button',{name:'Update WhatsApp consent'}));
 expect(show).toHaveBeenCalledWith('consent',{id:'c',state:'do_not_contact',source:'Customer request'});
 expect(onClose).toHaveBeenCalled();
});
