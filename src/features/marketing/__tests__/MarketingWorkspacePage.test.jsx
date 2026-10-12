import { describe,it,expect,vi,beforeEach } from 'vitest';
import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import MarketingWorkspacePage from '../MarketingWorkspacePage.jsx';
const {service,auth}=vi.hoisted(()=>({service:{context:vi.fn(),read:vi.fn(),setup:vi.fn(),content:vi.fn(),detail:vi.fn(),structure:vi.fn(),listing:vi.fn(),contentManagement:vi.fn()},auth:{user:{id:'user'},hasPermission:vi.fn(()=>true)}}));
vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>auth}));
vi.mock('../marketingService.js',()=>({marketingService:service}));
const context={organizations:[{id:'org',name:'Organization'}],brands:[{id:'brand',organization_id:'org',name:'Brand',timezone:'Asia/Kuala_Lumpur',outlet_ids:[]}],actor_employee_id:'actor'};
const read={rows:[],total:0,summary:{review:0,approved:0,scheduled:0,published:0},assets:[],jobs:[],knowledge:[],connections:[],role_scopes:[]};
beforeEach(()=>{cleanup();sessionStorage.clear();window.history.replaceState({},'','/');vi.clearAllMocks();auth.hasPermission.mockImplementation(()=>true);service.context.mockResolvedValue(context);service.contentManagement.mockResolvedValue({rows:[],total_count:0,day_counts:{}});service.read.mockResolvedValue(read);service.listing.mockResolvedValue({rows:[],total_count:0});service.setup.mockResolvedValue({outlets:[],employees:[],roles:[],members:[]});service.structure.mockResolvedValue({});service.content.mockResolvedValue({});});
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
  it('creates an unscheduled concept inside Content Management with a retry identity',async()=>{
    render(<MarketingWorkspacePage section="content"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Create Post'}));
    fireEvent.change(screen.getByLabelText(/Creative concept title/),{target:{value:'Lunch creative'}});
    fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
    await waitFor(()=>expect(service.content).toHaveBeenCalled());
    expect(service.content.mock.calls[0][0]).toMatchObject({organizationId:'org',brandId:'brand',command:'save',payload:{title:'Lunch creative'}});
    expect(service.content.mock.calls[0][0].requestId).toMatch(/^[\da-f-]{36}$/);
    expect(service.read).not.toHaveBeenCalled();
  });
});

it('legacy Content Library renders the same specific-brand Content Management',async()=>{
 render(<MarketingWorkspacePage section="content"/>);
 await waitFor(()=>expect(service.contentManagement).toHaveBeenCalled());
 expect(service.contentManagement.mock.calls[0][0].brandId).toBe('brand');
 fireEvent.click(screen.getByRole('button',{name:'Brand',exact:true}));
 expect(screen.queryByRole('option',{name:'All authorized brands'})).toBeNull();
 expect(new URLSearchParams(window.location.search).get('marketing_brand')).toBe('brand');
});
