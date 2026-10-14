import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import MarketingCustomersView from '../MarketingCustomersView.jsx';
const {service}=vi.hoisted(()=>({service:{customers:vi.fn()}}));
vi.mock('../outreachService.js',()=>({outreachService:service}));
vi.mock('../../../components/forms/SelectField.jsx',()=>({default:({label,value,onChange,options})=><label>{label}<select value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}));
const customer={id:'customer',display_name:'Actual Customer',phone_e164:'+60123456789',tags:[],brand_name:'Brand',active:true,eligible:false,suppressed:true,consent:{decision:'granted'},last_activity:null,language:'EN'};
beforeEach(()=>{cleanup();vi.clearAllMocks();localStorage.clear();service.customers.mockResolvedValue({customers:[customer],total:25,summary:{total:25,subscribed:10,not_subscribed:14,do_not_contact:1}})});
describe('brand customer list',()=>{
 it('uses server filters and pagination rather than filtering one local page',async()=>{render(<MarketingCustomersView org="org" brand="brand" data={{audiences:[],outlets:[]}} can={()=>false} show={()=>{}}/>);await screen.findAllByText('Actual Customer');fireEvent.change(screen.getByLabelText('WhatsApp consent'),{target:{value:'suppressed'}});await waitFor(()=>expect(service.customers.mock.calls.at(-1)[2].consent).toBe('suppressed'));fireEvent.click(screen.getAllByRole('button',{name:'Next'})[0]);await waitFor(()=>expect(service.customers.mock.calls.at(-1)[3]).toBe(2));expect(screen.queryByRole('button',{name:/Add customer/})).toBeNull()});
 it('shows suppression separately from old consent and never invents activity',async()=>{render(<MarketingCustomersView org="org" brand="brand" data={{audiences:[],outlets:[]}} can={()=>false} show={()=>{}}/>);await screen.findAllByText('Actual Customer');expect(screen.getAllByText('Do Not Contact').length).toBeGreaterThan(0);expect(screen.queryByText('Purchase')).toBeNull();expect(screen.queryByText('Purchase')).toBeNull()});
});
it('combines exact selected tags with consent using server filters',async()=>{render(<MarketingCustomersView org="org" brand="brand" data={{tags:['VIP'],outlets:[]}} can={()=>false} show={()=>{}}/>);await screen.findAllByText('Actual Customer');expect(screen.queryByLabelText('Segment')).toBeNull();fireEvent.change(screen.getByLabelText('Tags'),{target:{value:'VIP'}});fireEvent.change(screen.getByLabelText('WhatsApp consent'),{target:{value:'eligible'}});await waitFor(()=>expect(service.customers.mock.calls.at(-1)[2]).toMatchObject({tags:['VIP'],consent:'eligible'}));});

it('keeps whole-brand summaries on filtered pages and omits redundant brand column',async()=>{
 render(<MarketingCustomersView org="org" brand="brand" data={{tags:[],outlets:[]}} can={()=>false} show={()=>{}}/>);
 await screen.findAllByText('Actual Customer');
 const summary=screen.getByRole('region',{name:'Customer summary'});
 expect(summary.textContent).toContain('25');expect(summary.textContent).toContain('14');
 expect(screen.queryByRole('columnheader',{name:'Brand relationship'})).toBeNull();
 fireEvent.change(screen.getByLabelText('WhatsApp consent'),{target:{value:'required'}});
 await waitFor(()=>expect(service.customers.mock.calls.at(-1)[2].consent).toBe('required'));
 expect(summary.textContent).toContain('25');
});

it('opens row detail and keeps Edit and Consent independent',async()=>{const show=vi.fn();const {container}=render(<MarketingCustomersView org="org" brand="brand" data={{tags:[],outlets:[]}} can={()=>true} show={show}/>);await screen.findByText('Actual Customer');fireEvent.click(screen.getByRole('button',{name:'Edit Actual Customer'}));expect(show.mock.calls[0][0]).toBe('customer');expect(screen.queryByRole('dialog')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'WhatsApp consent for Actual Customer'}));expect(show.mock.calls[1][0]).toBe('consent');fireEvent.keyDown(container.querySelector('tbody tr'),{key:'Enter'});expect(await screen.findByRole('dialog')).toBeTruthy();});
it('offers all imported and operational fields and uses a phone fallback for absent names',async()=>{service.customers.mockResolvedValue({customers:[{...customer,display_name:null,pos_snapshot:{source:'POS',snapshot_date:'2026-10-13',metrics:{total_visit:0}}}],total:1});render(<MarketingCustomersView org="org" brand="brand" data={{tags:[],outlets:[]}} can={()=>false} show={()=>{}}/>);await screen.findAllByText('+60123456789');fireEvent.click(screen.getByRole('button',{name:'Columns'}));expect(screen.getByRole('group',{name:'Customer columns'}).querySelectorAll('input')).toHaveLength(16);expect(screen.getByRole('columnheader',{name:'Total Visit'})).toBeTruthy();expect(screen.getByText('0')).toBeTruthy();expect(screen.getByText('Imported POS · POS')).toBeTruthy();});
