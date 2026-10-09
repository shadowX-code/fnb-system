import { describe,it,expect,vi,beforeEach } from 'vitest';
import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import MarketingWorkspacePage from '../MarketingWorkspacePage.jsx';
const {service,auth}=vi.hoisted(()=>({service:{context:vi.fn(),read:vi.fn(),setup:vi.fn(),content:vi.fn(),detail:vi.fn(),structure:vi.fn(),listing:vi.fn()},auth:{user:{id:'user'},hasPermission:vi.fn(()=>true)}}));
vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>auth}));
vi.mock('../marketingService.js',()=>({marketingService:service}));
const context={organizations:[{id:'org',name:'Organization'}],brands:[{id:'brand',organization_id:'org',name:'Brand',timezone:'Asia/Kuala_Lumpur',outlet_ids:[]}],actor_employee_id:'actor'};
const read={rows:[],total:0,summary:{review:0,approved:0,scheduled:0,published:0},assets:[],jobs:[],knowledge:[],connections:[],role_scopes:[]};
beforeEach(()=>{cleanup();vi.clearAllMocks();auth.hasPermission.mockImplementation(()=>true);service.context.mockResolvedValue(context);service.read.mockResolvedValue(read);service.listing.mockResolvedValue({rows:[],total_count:0});service.setup.mockResolvedValue({outlets:[],employees:[],roles:[],members:[]});service.structure.mockResolvedValue({});service.content.mockResolvedValue({});});
describe('native Marketing foundation',()=>{
  it('reports unavailable evidence without invented social metrics',async()=>{
    render(<MarketingWorkspacePage/>);
    await screen.findByRole('heading',{name:'Evidence availability'});
    expect(screen.getByText(/Conversions and provider costs remain unavailable/)).toBeTruthy();
    expect(screen.queryByText(/Connected successfully|Published successfully/)).toBeNull();
  });
  it('shows explicit organization initialization only with platform permission',async()=>{
    service.context.mockResolvedValue({organizations:[],brands:[]});
    auth.hasPermission.mockImplementation(code=>code!=='platform_organizations.manage');
    render(<MarketingWorkspacePage/>);
    await screen.findByText('Ask an organization administrator to grant membership.');
    expect(screen.queryByRole('button',{name:'Create organization'})).toBeNull();
  });
  it('submits a brand-specific draft with a retry identity',async()=>{
    render(<MarketingWorkspacePage section="content"/>);
    await screen.findByText('No content yet');
    fireEvent.click(screen.getByRole('button',{name:'Brand'}));
    fireEvent.click(screen.getByRole('option',{name:'Brand'}));
    fireEvent.click(await screen.findByRole('button',{name:'New draft'}));
    fireEvent.change(screen.getByLabelText(/Creative concept title/),{target:{value:'Lunch creative'}});
    fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
    await waitFor(()=>expect(service.content).toHaveBeenCalled());
    expect(service.content.mock.calls[0][0]).toMatchObject({organizationId:'org',brandId:'brand',command:'save',payload:{title:'Lunch creative'}});
    expect(service.content.mock.calls[0][0].requestId).toMatch(/^[\da-f-]{36}$/);
  });
  it('discards an obsolete scope response instead of displaying it in a new brand',async()=>{
    let resolve;
    service.read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    render(<MarketingWorkspacePage section="content"/>);
    await screen.findByRole('button',{name:'Brand'});
    fireEvent.click(screen.getByRole('button',{name:'Brand'}));fireEvent.click(screen.getByRole('option',{name:'Brand'}));
    await screen.findByText('No content yet');
    resolve({...read,rows:[{id:'old',payload:{title:'Obsolete scope record',variants:[]},status:'draft'}]});
    await waitFor(()=>expect(screen.queryByText('Obsolete scope record')).toBeNull());
  });
});
