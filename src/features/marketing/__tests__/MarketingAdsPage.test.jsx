import { describe, it, expect, vi, beforeEach,afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import MarketingAdsPage from "../MarketingAdsPage.jsx";
const { ads, service, auth } = vi.hoisted(() => ({
  ads: {
    read: vi.fn(),
    pending: vi.fn(),
    discovery: vi.fn(),
    reviewContext: vi.fn(),
    attributeBatch: vi.fn(),
    copilotPrepare: vi.fn(),
    preview: vi.fn(),
    attribute: vi.fn(),
    authorize: vi.fn(),
    bind: vi.fn(),
    sync: vi.fn(),
    ensurePeriod: vi.fn(),
    disconnect: vi.fn(),
  },
  service: { context: vi.fn() },
  auth: { hasPermission: vi.fn(() => true) },
}));
vi.mock("../../../auth/AuthContext.jsx", () => ({ useAuth: () => auth }));
vi.mock("../adsService.js", () => ({ adsService: ads }));
vi.mock("../marketingService.js", () => ({ marketingService: service }));
beforeEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  auth.hasPermission.mockReturnValue(true);
  service.context.mockResolvedValue({
    organizations: [{ id: "org", name: "Organization" }],
    brands: [{ id: "brand", organization_id: "org", name: "Brand" }],
  });
  ads.read.mockResolvedValue({ accounts: [], reports: [], jobs: [] });
  ads.pending.mockResolvedValue([]);
  ads.discovery.mockResolvedValue([]);
  ads.reviewContext.mockResolvedValue([]);
});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("Ads read-only workspace", () => {
  it("has meaningful unconnected state and never invents advertising metrics", async () => {
    render(<MarketingAdsPage />);
    await screen.findByText("Connect your first Ad Account");
    expect(screen.queryByText("MYR 0")).toBeNull();
    expect(ads.authorize).not.toHaveBeenCalled();
  });
  it("starts organization-owned discovery without brand ownership", async () => {
    ads.authorize.mockRejectedValue(
      new Error("Authorization is unavailable for this test."),
    );
    render(<MarketingAdsPage />);
    await screen.findByText("Connect your first Ad Account");
    fireEvent.click(screen.getByRole("tab", {name:"Ad Accounts"}));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Connect Ad Account" })[0],
    );
    await waitFor(() =>
      expect(ads.authorize).toHaveBeenCalledWith("org", null),
    );
    expect(ads.bind).not.toHaveBeenCalled();
  });
  it("keeps mixed currencies and missing results separate with no execution controls", async () => {
    ads.read.mockResolvedValue({
      accounts: [
        {
          id: "a",
          name: "Account A",
          account_id: "111",
          brand_id: "brand",
          health: { currency: "MYR", timezone: "Asia/Kuala_Lumpur" },
        },
        {
          id: "b",
          name: "Account B",
          account_id: "222",
          health: { currency: "USD", timezone: "America/New_York" },
        },
      ],
      reports: [
        {
          connection_id: "a",
          payload: {
            insights: {
              account: [
                { metrics: { spend: { value: 0, state: "reported" } } },
              ],
            },
          },
        },
        {
          connection_id: "b",
          payload: {
            insights: {
              account: [
                { metrics: { spend: { value: 10, state: "reported" } } },
              ],
            },
          },
        },
      ],
      jobs: [],
    });
    render(<MarketingAdsPage />);
    await screen.findByText("MYR 0");
    expect(screen.getByText("USD 10")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: /Activate|Increase budget|Publish/,
      }),
    ).toBeNull();
    expect(
      screen.getAllByText("Results unavailable for this period."),
    ).toHaveLength(2);
  });
  it("does not expose connecting without independent permission", async () => {
    auth.hasPermission.mockImplementation((p) => p !== "marketing_ads.connect");
    render(<MarketingAdsPage />);
    await screen.findByText("Connect your first Ad Account");
    expect(
      screen.queryByRole("button", { name: "Connect Ad Account" }),
    ).toBeNull();
  });
  it("does not query invalid date periods", async () => {
    render(<MarketingAdsPage />);
    await screen.findByText("Connect your first Ad Account");
    const before = ads.read.mock.calls.length;
    fireEvent.click(screen.getByRole("button", {name:"Date Range",exact:true}));
    fireEvent.click(screen.getByRole("button", {name:"Clear",exact:true}));
    await screen.findByText("Select a valid period of up to 37 months.");
    expect(ads.read.mock.calls.length).toBe(before);
  });
});

describe("Ads self-service reporting",()=>{
  const connected={id:"account",name:"Shared Account",account_id:"111",status:"test_authorized",expires_at:"2027-01-01",health:{read_verified:true,currency:"MYR",timezone:"Asia/Kuala_Lumpur"}};
  it('pins disconnected account confirmation to the preserved slot generation',async()=>{
    ads.read.mockResolvedValue({organization_access:true,accounts:[{...connected,status:'not_connected',account_id:null,account_slot:'111',generation:3}],reports:[],jobs:[]});
    ads.pending.mockResolvedValue([{id:'session',accounts:[{id:'111',name:'Discovered account',available:true}]}]);ads.bind.mockResolvedValue({connection:{id:'account'}});
    render(<MarketingAdsPage/>);await screen.findByText('Shared Account');
    fireEvent.click(screen.getByRole("tab",{name:"Ad Accounts"}));await screen.findByText('Discovered account');
    fireEvent.click(screen.getByRole('button',{name:'Connect shared account'}));fireEvent.click(screen.getByRole('button',{name:'Confirm connection'}));
    await waitFor(()=>expect(ads.bind).toHaveBeenCalledWith('session','','111',3));
  });
  it('advances the rolling period across the provider-local day boundary',async()=>{
    vi.useFakeTimers({toFake:['Date','setInterval','clearInterval']});vi.setSystemTime(new Date('2026-10-13T15:50:00Z'));
    // Each RPC response is a fresh projection, including unchanged provider evidence.
    ads.read.mockImplementation(async()=>({organization_access:true,accounts:[connected],reports:[],jobs:[]}));
    render(<MarketingAdsPage/>);await screen.findByText('Shared Account');
    expect(ads.read).toHaveBeenCalledWith('org','','2026-09-14','2026-10-13');
    vi.setSystemTime(new Date('2026-10-13T16:01:00Z'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(30000)});
    expect(ads.read).toHaveBeenCalledWith('org','','2026-09-15','2026-10-14');expect(ads.sync).not.toHaveBeenCalled();
  });
  it("explains missing brand attribution without offering an unauthorized connection",async()=>{
    ads.read.mockResolvedValue({organization_access:false,accounts:[],reports:[],jobs:[]});
    render(<MarketingAdsPage/>);await screen.findByText('No confirmed brand advertising');
    expect(screen.getByText(/authorized administrator can connect/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Connect Ad Account'})).toBeNull();
  });
  it("reuses a connected account without another OAuth, binding or sync request",async()=>{
    ads.read.mockResolvedValue({organization_access:true,accounts:[connected],reports:[],jobs:[]});
    render(<MarketingAdsPage/>);await screen.findByText("Shared Account");
    fireEvent.click(screen.getByRole("tab",{name:"Ad Accounts"}));
    fireEvent.click(screen.getByRole("button",{name:"Connect Ad Account"}));
    await screen.findByRole("dialog",{name:"Choose an Ad Account connection"});
    fireEvent.click(screen.getByRole("button",{name:"Use connected account"}));
    expect(ads.authorize).not.toHaveBeenCalled();expect(ads.bind).not.toHaveBeenCalled();expect(ads.sync).not.toHaveBeenCalled();
    await screen.findByText(/Using the existing shared/);
  });
  it("shows initial progress consistently and polling consumes FeedX state only",async()=>{
    const pending={...connected,sync:{worker_available:true,active_jobs:2,initial_total:2,initial_completed:0}};
    ads.read.mockResolvedValue({organization_access:true,accounts:[pending],reports:[],jobs:[]});
    vi.useFakeTimers({toFake:["setInterval","clearInterval"]});
    render(<MarketingAdsPage/>);await screen.findByText("Syncing");
    expect(screen.getByText(/0\/2 initial periods complete/)).toBeTruthy();
    const before=ads.read.mock.calls.length;
    await act(async()=>{await vi.advanceTimersByTimeAsync(30000)});
    expect(ads.read.mock.calls.length).toBe(before+2);expect(ads.sync).not.toHaveBeenCalled();expect(ads.bind).not.toHaveBeenCalled();
  });
  it("labels a successful empty provider period without fabricating spend",async()=>{
    ads.read.mockResolvedValue({organization_access:true,accounts:[connected],reports:[{connection_id:"account",payload:{scope:"organization",account:{currency:"MYR"},configs:{campaigns:[]},insights:{account:[],daily:[]},warnings:{}}}],jobs:[]});
    render(<MarketingAdsPage/>);await screen.findByText("Reporting Ready");
    expect(screen.getByText(/Meta returned no reporting rows/)).toBeTruthy();expect(screen.queryByText("MYR 0")).toBeNull();
  });
  it("keeps manual recovery controls unavailable to brand-only readers",async()=>{
    ads.read.mockResolvedValue({organization_access:false,accounts:[connected],reports:[],jobs:[]});
    render(<MarketingAdsPage/>);await screen.findByText("Shared Account");
    fireEvent.click(screen.getByRole("tab",{name:"Ad Accounts"}));
    expect(screen.queryByRole("button",{name:"Manage Connection"})).toBeNull();
    expect(screen.queryByRole("menuitem",{name:/Retry Sync/})).toBeNull();
    expect(screen.queryByRole("button",{name:"Connect Ad Account"})).toBeNull();
  });
});

it('keeps discovery in Ad Accounts and hides redundant binding of already-connected accounts',async()=>{
 ads.read.mockResolvedValue({organization_access:true,accounts:[{id:'existing',name:'Connected Account',account_id:'111',health:{currency:'MYR'}}],reports:[],jobs:[]});
 ads.pending.mockResolvedValue([{id:'session',accounts:[{id:'111',name:'Already bound',available:true},{id:'222',name:'Available Account',available:true}]}]);
 render(<MarketingAdsPage/>);await screen.findByText('Connected Account');
 expect(screen.queryByText('Available Account')).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'Campaigns'}));
 expect(screen.queryByRole('button',{name:'Connect shared account'})).toBeNull();expect(screen.queryByRole('button',{name:'Connect Ad Account'})).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'Ad Accounts'}));
 expect(await screen.findByText('Available Account')).toBeTruthy();expect(screen.queryByText('Already bound')).toBeNull();
 expect(screen.getAllByRole('button',{name:'Connect shared account'})).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Manage Connection'}));
 expect(screen.getByRole('menuitem',{name:'Reconnect Meta'})).toBeTruthy();
 expect(ads.bind).not.toHaveBeenCalled();expect(ads.sync).not.toHaveBeenCalled();expect(ads.authorize).not.toHaveBeenCalled();
});

it('keeps selected reporting dates in review when only a configuration catalog exists',async()=>{
 const payload={not_synced:true,scope:'organization',account:{id:'111',name:'Shared Account',currency:'MYR',timezone:'Asia/Singapore'},configs:{campaigns:[{id:'1',name:'Catalog campaign'}],adsets:[],ads:[]},insights:{}};
 ads.read.mockResolvedValue({organization_access:true,accounts:[{id:'account',name:'Shared Account',account_id:'111',health:{currency:'MYR',timezone:'Asia/Singapore',read_verified:true}}],reports:[],catalogs:[{connection_id:'account',payload}],jobs:[]});
 render(<MarketingAdsPage/>);await screen.findByText('Shared Account');fireEvent.click(screen.getByRole('tab',{name:'Campaigns'}));fireEvent.click(await screen.findByRole('button',{name:'Review Brand attribution'}));
 const call=ads.read.mock.calls[0];expect(screen.getByRole('dialog').textContent).toContain(`Selected reporting period ${call[2]}–${call[3]}`);expect(ads.sync).not.toHaveBeenCalled();expect(ads.attributeBatch).not.toHaveBeenCalled();
});

it('opens Campaigns on the widest observed exact period and restores Overview to 30 days',async()=>{
 const ranges=[{from:'2025-10-17',to:'2026-10-16',observed_at:'2026-10-16T10:00:00Z'},{from:'2023-09-16',to:'2026-10-16',observed_at:'2026-10-16T14:40:02Z'}];
 ads.read.mockImplementation(async(_o,_b,from,to)=>({organization_access:true,accounts:[{id:'supreme',name:'Supreme',account_id:'1547787575646373',generation:1,health:{timezone:'Asia/Singapore'}}],reports:[{connection_id:'supreme',date_from:from,date_to:to,payload:{account:{currency:'MYR'},configs:{campaigns:[]},insights:{campaign:[]}}}],coverage:[{connection_id:'supreme',ranges}],jobs:[]}));
 render(<MarketingAdsPage/>);await screen.findAllByText('Supreme');
 const readsBeforeLifetime=ads.read.mock.calls.length;
 fireEvent.click(screen.getByRole('tab',{name:'Campaigns'}));
 await screen.findByText(/Lifetime Performance · exact Meta-observed period 2023-09-16–2026-10-16/);
 await waitFor(()=>expect(ads.read).toHaveBeenCalledWith('org','','2023-09-16','2026-10-16'));
 expect(ads.read.mock.calls.slice(readsBeforeLifetime)).toEqual([['org','','2023-09-16','2026-10-16']]);
 expect(screen.queryByRole('button',{name:'Refresh data'})).toBeNull();expect(ads.sync).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('tab',{name:'Overview'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Period',exact:true}).textContent).toContain('Last 30 days'));
});

it('automatically requests an eligible missing selection once and polls its canonical job',async()=>{
 let queued=false;
 ads.read.mockImplementation(async()=>({organization_access:true,accounts:[{id:'a',name:'Shared Account',account_id:'111',generation:3,health:{automatic_history_enabled:true,timezone:'Asia/Singapore'}}],reports:[],jobs:queued?[{connection_id:'a',state:'queued'}]:[]}));
 ads.ensurePeriod.mockImplementation(async()=>{queued=true;return {state:'syncing'}});
 render(<MarketingAdsPage/>);await waitFor(()=>expect(ads.ensurePeriod).toHaveBeenCalledTimes(1));
 await screen.findByText('Shared Account');expect(ads.sync).not.toHaveBeenCalled();expect(ads.bind).not.toHaveBeenCalled();
});
it('never initiates automatic shared reporting for a Brand-only reader',async()=>{
 ads.read.mockResolvedValue({organization_access:false,accounts:[{id:'a',name:'Brand account',account_id:'111',health:{automatic_history_enabled:true}}],reports:[],jobs:[]});
 render(<MarketingAdsPage/>);await screen.findByText('Brand account');expect(ads.ensurePeriod).not.toHaveBeenCalled();
});
