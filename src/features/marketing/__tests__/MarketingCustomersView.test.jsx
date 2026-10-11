import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import MarketingCustomersView from '../MarketingCustomersView.jsx';
const {service}=vi.hoisted(()=>({service:{customers:vi.fn()}}));
vi.mock('../outreachService.js',()=>({outreachService:service}));
vi.mock('../../../components/forms/SelectField.jsx',()=>({default:({label,value,onChange,options})=><label>{label}<select value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}));
const customer={id:'customer',display_name:'Actual Customer',phone_e164:'+60123456789',tags:[],brand_name:'Brand',active:true,eligible:false,suppressed:true,consent:{decision:'granted'},last_activity:null,language:'EN'};
beforeEach(()=>{cleanup();vi.clearAllMocks();service.customers.mockResolvedValue({customers:[customer],total:25})});
describe('brand customer list',()=>{
 it('uses server filters and pagination rather than filtering one local page',async()=>{render(<MarketingCustomersView org="org" brand="brand" data={{audiences:[],outlets:[]}} can={()=>false} show={()=>{}}/>);await screen.findAllByText('Actual Customer');fireEvent.change(screen.getByLabelText('WhatsApp consent'),{target:{value:'suppressed'}});await waitFor(()=>expect(service.customers.mock.calls.at(-1)[2].consent).toBe('suppressed'));fireEvent.click(screen.getAllByRole('button',{name:'Next'})[0]);await waitFor(()=>expect(service.customers.mock.calls.at(-1)[3]).toBe(2));expect(screen.queryByRole('button',{name:/Add customer/})).toBeNull()});
 it('shows suppression separately from old consent and never invents activity',async()=>{render(<MarketingCustomersView org="org" brand="brand" data={{audiences:[],outlets:[]}} can={()=>false} show={()=>{}}/>);await screen.findAllByText('Actual Customer');expect(screen.getAllByText('Suppressed').length).toBeGreaterThan(0);expect(screen.getByText('No campaign activity')).toBeTruthy();expect(screen.queryByText('Purchase')).toBeNull()});
});
