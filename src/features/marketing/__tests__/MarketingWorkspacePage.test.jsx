import { describe,it,expect,vi,beforeEach } from 'vitest';
import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import MarketingWorkspacePage from '../MarketingWorkspacePage.jsx';
const {service,auth}=vi.hoisted(()=>({service:{metaConfiguration:vi.fn(),context:vi.fn(),read:vi.fn(),setup:vi.fn(),content:vi.fn(),detail:vi.fn(),teamAccess:vi.fn(),listing:vi.fn(),contentManagement:vi.fn(),integrations:vi.fn(),execute:vi.fn(),socialPublications:vi.fn(),observedGrowth:vi.fn(),socialPerformance:vi.fn()},auth:{user:{id:'user'},hasPermission:vi.fn(()=>true)}}));
vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>auth}));
vi.mock('../marketingService.js',()=>({marketingService:service}));
vi.mock('../MetaIntegrationPanels.jsx',async importOriginal=>({...await importOriginal(),MetaConnections:()=>null}));
const context={organizations:[{id:'org',name:'Organization'}],brands:[{id:'brand',organization_id:'org',name:'Brand',timezone:'Asia/Kuala_Lumpur',outlet_ids:[]}],actor_employee_id:'actor'};
const read={rows:[],total:0,summary:{review:0,approved:0,scheduled:0,published:0},assets:[],jobs:[],knowledge:[],connections:[],role_scopes:[]};
beforeEach(()=>{cleanup();sessionStorage.clear();window.history.replaceState({},'','/');vi.clearAllMocks();service.metaConfiguration.mockResolvedValue({facebook_video_execution_enabled:false});auth.hasPermission.mockImplementation(()=>true);service.context.mockResolvedValue(context);service.contentManagement.mockResolvedValue({rows:[],total_count:0,day_counts:{}});service.read.mockResolvedValue(read);service.listing.mockResolvedValue({rows:[],total_count:0});service.setup.mockResolvedValue({outlets:[],employees:[],roles:[],members:[]});service.teamAccess.mockResolvedValue({});service.content.mockResolvedValue({});service.integrations.mockResolvedValue({connections:[]});});
describe('native Marketing foundation',()=>{
  it('reports unavailable evidence without invented social metrics',async()=>{
    service.socialPublications.mockResolvedValue({posts:[],connections:[]});service.observedGrowth.mockResolvedValue({rows:[],first_observation_date:null});service.socialPerformance.mockResolvedValue({rows:[],windows:[],first_observation_date:null});
    render(<MarketingWorkspacePage section="analytics"/>);
    await screen.findByText('Rate not supported');
    expect(screen.getByText('Engagement Rate')).toBeTruthy();expect(screen.getByText('Rate not supported')).toBeTruthy();
    expect(screen.queryByText(/Connected successfully|Published successfully/)).toBeNull();
  });
  it('shows Brand access recovery without Organization setup',async()=>{
    service.context.mockResolvedValue({organizations:[],brands:[]});
    auth.hasPermission.mockImplementation(code=>code!=='platform_organizations.manage');
    render(<MarketingWorkspacePage/>);
    await screen.findByText('Ask an administrator to grant Brand access and team permissions.');
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
 expect(screen.queryByRole('option',{name:'All',exact:true})).toBeNull();
 expect(new URLSearchParams(window.location.search).get('marketing_brand')).toBe('brand');
});

it('switches internal scope by permitted Brand without an Organization selector',async()=>{
 service.context.mockResolvedValue({organizations:[{id:'org'},{id:'other'}],brands:[...context.brands,{id:'second',organization_id:'other',name:'Second Brand',timezone:'Asia/Kuala_Lumpur',outlet_ids:[]}]});
 render(<MarketingWorkspacePage section="calendar"/>);await waitFor(()=>expect(service.contentManagement).toHaveBeenCalled());
 fireEvent.click(screen.getByRole('button',{name:'Brand',exact:true}));fireEvent.click(screen.getByRole('option',{name:'Second Brand'}));
 await waitFor(()=>expect(service.contentManagement.mock.calls.at(-1)[0]).toMatchObject({organizationId:'other',brandId:'second'}));expect(screen.queryByRole('button',{name:'Organization',exact:true})).toBeNull();
});

const scheduledRow={key:'concept',id:'content',brand_id:'brand',brand_name:'Brand',origin:'feedx',title:'Scoped publishing test',status:'scheduled',revision:1,scheduled_at:'2099-01-01T00:00:00Z',payload:{title:'Scoped publishing test',variants:[{channel:'facebook',format:'text',caption:'Approved caption',asset_ids:[]},{channel:'instagram',format:'image',caption:'Approved caption',asset_ids:['image']}]},channels:[{channel:'facebook',format:'text',caption:'Approved caption',status:'blocked'},{channel:'instagram',format:'image',caption:'Approved caption',status:'blocked'}]};
const savedContent={...scheduledRow,organization_id:'org',approved_revision:1};
const savedDetail=content=>({content,assets:[],events:[]});
function mockScheduledList(){service.contentManagement.mockResolvedValue({rows:[scheduledRow],total_count:1,day_counts:{}});}
async function openScheduled(){render(<MarketingWorkspacePage section="calendar"/>);fireEvent.click((await screen.findAllByRole('button',{name:'View Scoped publishing test',exact:true}))[0]);}

it('waits for canonical detail and resolves both authorized channels with its tenant scope, without execution',async()=>{
 mockScheduledList();let resolve;service.detail.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 service.integrations.mockResolvedValue({connections:['facebook','instagram'].map(channel=>({id:channel+'-connection',brand_id:'brand',channel,account_name:'Authorized '+channel,provider_account_id:channel==='facebook'?'111':'222',credential_generation:2,status:'test_authorized',expires_at:'2099-01-01T00:00:00Z',capabilities:{publishing:true,execution_enabled:true,formats:[channel==='facebook'?'text':'image']}}))});
 await openScheduled();await screen.findByText('Verifying the saved revision before publishing approval.');
 expect(service.integrations).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Authorize external publishing'})).toBeNull();
 resolve(savedDetail(savedContent));await screen.findByText(/Authorized facebook/);await screen.findByText(/Authorized instagram/);
 expect(service.integrations).toHaveBeenCalledExactlyOnceWith('org','brand','content');
 expect(screen.getByRole('checkbox',{name:/I approve sending/}).disabled).toBe(false);expect(screen.getByRole('button',{name:'Authorize external publishing'}).disabled).toBe(true);
 expect(service.execute).not.toHaveBeenCalled();expect(service.content).not.toHaveBeenCalled();
});

it.each([{id:'another-content'},{organization_id:'another-tenant'},{organization_id:null},{brand_id:'another-brand'},{revision:2},{status:'published'}])('rejects mismatched canonical publishing detail %j without an account lookup',async patch=>{
 mockScheduledList();service.detail.mockResolvedValue(savedDetail({...savedContent,...patch}));await openScheduled();
 await screen.findByText('The saved content changed or is unavailable in this Brand. Close and reopen it.');
 expect(service.integrations).not.toHaveBeenCalled();expect(service.execute).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Authorize external publishing'})).toBeNull();
});

it('keeps publishing approval closed when canonical detail fails',async()=>{
 mockScheduledList();service.detail.mockRejectedValue(new Error('Detail access denied'));await openScheduled();await screen.findByText('Detail access denied');
 expect(service.integrations).not.toHaveBeenCalled();expect(service.execute).not.toHaveBeenCalled();
});

it('discards canonical detail after the review is closed',async()=>{
 mockScheduledList();let resolve;service.detail.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await openScheduled();await screen.findByText('Verifying the saved revision before publishing approval.');
 fireEvent.click(screen.getByRole('button',{name:'Close',exact:true}));resolve(savedDetail(savedContent));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Content revision'})).toBeNull());expect(service.integrations).not.toHaveBeenCalled();
});

it('uses canonical date/time controls and saves the Malaysia wall clock as a UTC instant',async()=>{
 render(<MarketingWorkspacePage section="calendar"/>);fireEvent.click(await screen.findByRole('button',{name:'Create Post'}));
 expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
 fireEvent.change(screen.getByLabelText(/Creative concept title/),{target:{value:'Timed draft'}});
 const date=screen.getByLabelText('Planned publishing date');fireEvent.change(date,{target:{value:'24 Oct 2026'}});fireEvent.blur(date);
 fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));expect(service.content).not.toHaveBeenCalled();await screen.findByText('Choose a valid publishing date and time.');
 fireEvent.click(screen.getByRole('button',{name:'Planned publishing time'}));fireEvent.click(screen.getByRole('button',{name:'Done',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));await waitFor(()=>expect(service.content).toHaveBeenCalled());
 expect(service.content.mock.calls[0][0]).toMatchObject({command:'save',payload:{planned_at:'2026-10-24T01:00:00.000Z',planned_timezone:'Asia/Kuala_Lumpur'}});expect(service.execute).not.toHaveBeenCalled();
});
it('editing an approved revision preserves the expected revision and performs only canonical save',async()=>{
 service.contentManagement.mockResolvedValue({rows:[{...scheduledRow,status:'approved'}],total_count:1});service.detail.mockResolvedValue(savedDetail({...savedContent,status:'approved'}));
 render(<MarketingWorkspacePage section="calendar"/>);fireEvent.click((await screen.findAllByRole('button',{name:'View Scoped publishing test',exact:true}))[0]);
 fireEvent.click(screen.getByRole('button',{name:'Edit',exact:true}));fireEvent.change(screen.getByLabelText(/Creative concept title/),{target:{value:'Revised title'}});fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
 await waitFor(()=>expect(service.content).toHaveBeenCalled());expect(service.content.mock.calls[0][0]).toMatchObject({command:'save',content:{id:'content',revision:1,status:'approved'},payload:{title:'Revised title'}});expect(service.execute).not.toHaveBeenCalled();
});
