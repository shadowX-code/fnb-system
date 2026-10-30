import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ExternalAgentsPage from "./ExternalAgentsPage.jsx";
import { externalAgentService } from "../../services/externalAgentService.js";
vi.mock("../../services/externalAgentService.js", () => ({ externalAgentService: { list: vi.fn(), details: vi.fn(), revoke: vi.fn(), rotate: vi.fn(), test: vi.fn(), setEnabled: vi.fn(), setCapability: vi.fn(), setCapabilities: vi.fn(), register: vi.fn(), review: vi.fn(), confirmAccess: vi.fn(), registerReviewed: vi.fn() } }));
const credential = { id: "existing-credential", status: "active", created_at: "2026-10-29T01:00:00Z", expires_at: "2026-11-28T01:00:00Z" };
const capabilities = ["Review daily compliance", "Review compliance exceptions", "Review pending verifications", "View compliance evidence", "View requirement schedule"].map((label, i) => ({ name: `read_tool_${i}`, label, description: "Read evidence safely", module_id: `factory_module_${i}`, section: "MeSTI", coverage: "available", sidebar: true, capability: "view", workspace: "Factory", domain: "mesti", domain_label: "MeSTI", implemented: true, granted: true, can_assign: true, scope:[{label:"Safe records",resource:"safe"}],permission: `internal_${i}.view` }));
const agent = { id: "qa", name: "QA Executive", provider: "xAI", enabled: true, role_active: true, role_name: "QA inspection", permission: "factory_mesti_inspection.view", permission_granted: true, workspace: "Factory", can_manage: true, can_manage_capabilities: true, credential, connection_status: "not_observed", tools: capabilities, endpoint: "https://example.test/mcp" };
const detail = { connections: [agent], credentials: [credential], access_events: [{ id: 1, occurred_at: "2026-10-29T01:00:00Z", method: "initialize", source: "admin_probe", outcome: "success" }], management_events: [], history_note: "Earlier history is unavailable.", unavailable_domains: ["Production", "Warehouse", "Assets"] };
const catalog = [{ key: "factory_mesti", workspace: "Factory", capabilities }];
const auth = (codes = ["roles.view", "roles.edit", "roles.create"]) => ({ hasPermission: (code) => codes.includes(code) });
beforeEach(() => {
 vi.resetAllMocks();
 externalAgentService.list.mockResolvedValue({ connections: [agent], catalog, can_register: true, unavailable_domains: detail.unavailable_domains });
 externalAgentService.details.mockResolvedValue(detail);
 externalAgentService.revoke.mockResolvedValue({ revoked: true });
 externalAgentService.rotate.mockResolvedValue({ one_time_credential: "TEST_ONE_TIME_SECRET", expires_at: credential.expires_at });
 externalAgentService.register.mockResolvedValue({ one_time_credential: "TEST_REGISTRATION_SECRET", expires_at: credential.expires_at });
 externalAgentService.test.mockResolvedValue({ message: "FeedX is reachable." });
 externalAgentService.setEnabled.mockResolvedValue({enabled:false});
 externalAgentService.setCapability.mockResolvedValue({granted:false});
 externalAgentService.confirmAccess.mockResolvedValue({updated:true});
 externalAgentService.registerReviewed.mockResolvedValue({one_time_credential:"TEST_REGISTRATION_SECRET",expires_at:credential.expires_at});
 externalAgentService.review.mockImplementation(async(id,desired)=>({changes:capabilities.filter(c=>id? !desired.includes(c.name):desired.includes(c.name)).map(c=>({...c,granted:!id})),remaining_access:capabilities.filter(c=>desired.includes(c.name)),effective_diff:{before:[],after:[],material_changes:[],blockers:[],remaining_shared_access:[]},dependencies:[],review_hash:"review",note:"Dependencies remain explicit"}));
});
afterEach(cleanup);
async function open() { fireEvent.click(await screen.findByRole("button", { name: "Manage QA Executive" })); await screen.findByRole("heading", { name: "Agent Information" }); }
function tab(name) { fireEvent.click(screen.getByRole("tab", {name,exact:true})); }
it("uses the six business columns, three tabs and hides technical identifiers until Developer Diagnostics", async () => {
 render(<ExternalAgentsPage auth={auth()} />);
 await screen.findByRole("button",{name:"Manage QA Executive"});
 expect(screen.getAllByRole("columnheader").map((element)=>element.textContent)).toEqual(["Agent","Workspace","Effective Access","Connection","Last successful access","Actions"]);
 await open();expect(screen.queryByText("factory_mesti_inspection.view")).toBeNull();
 tab("Access & Permissions");expect(screen.getByText("Review daily compliance")).toBeTruthy();
 expect(screen.queryByRole("tab",{name:"By Module"})).toBeNull();

 tab("Activity");expect(screen.getByText("FeedX connection check")).toBeTruthy();expect(screen.queryByText("initialize")).toBeNull();
 tab("Overview");fireEvent.click(screen.getByRole("button",{name:"Developer Diagnostics"}));expect(screen.getByText("factory_mesti_inspection.view")).toBeTruthy();expect(screen.getAllByText(/read_tool_0/).length).toBeGreaterThan(0);
});
it("confirms key replacement and clears one-time secrets on close", async () => {
 render(<ExternalAgentsPage auth={auth()} />);await open();
 fireEvent.click(screen.getByRole("button",{name:"Replace access key"}));expect(externalAgentService.rotate).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Cancel",exact:true}));expect(externalAgentService.rotate).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Replace access key"}));fireEvent.click(within(screen.getByRole("dialog",{name:"Replace access key?"})).getByRole("button",{name:"Replace access key"}));
 await screen.findByRole("heading",{name:"Save the access key"});expect(screen.getByLabelText("New access key").type).toBe("password");
 expect(externalAgentService.rotate).toHaveBeenCalledWith("qa","existing-credential",expect.any(String),90);
 fireEvent.click(screen.getByRole("button",{name:"I have saved the key"}));expect(screen.queryByDisplayValue("TEST_ONE_TIME_SECRET")).toBeNull();
});
it("keeps revocation explicit and bound to the exact key",async()=>{
 render(<ExternalAgentsPage auth={auth()} />);await open();fireEvent.click(screen.getByText("Access key history",{exact:true}));
 fireEvent.click(screen.getByRole("button",{name:"Revoke key"}));expect(externalAgentService.revoke).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Revoke access key",exact:true}));await waitFor(()=>expect(externalAgentService.revoke).toHaveBeenCalledWith("qa","existing-credential"));
});
it("supports view-only Role Settings aliases and denies visibility without view authority",async()=>{
 const view=render(<ExternalAgentsPage auth={auth(["roles_permissions.view"])} />);await open();
 expect(screen.queryByRole("button",{name:"Connect agent"})).toBeNull();expect(screen.queryByRole("button",{name:"Disable agent"})).toBeNull();
 tab("Access & Permissions");expect(screen.queryByRole("button",{name:/Remove Read access/})).toBeNull();
 view.unmount();externalAgentService.list.mockClear();render(<ExternalAgentsPage auth={auth([])} />);expect(screen.getByRole("alert").textContent).toContain("Role Settings view");expect(externalAgentService.list).not.toHaveBeenCalled();
});
it("clears a supplied key before testing and never puts it in the result",async()=>{
 render(<ExternalAgentsPage auth={auth()} />);await open();fireEvent.change(screen.getByLabelText(/Access key/),{target:{value:"SUPPLIED_SECRET"}});
 fireEvent.click(screen.getByRole("button",{name:"Check access key"}));await waitFor(()=>expect(externalAgentService.test).toHaveBeenCalledWith("qa","SUPPLIED_SECRET"));expect(screen.queryByDisplayValue("SUPPLIED_SECRET")).toBeNull();expect(await screen.findByText("FeedX is reachable.")).toBeTruthy();
});
it("confirms Disable Agent without rotating or revoking credentials",async()=>{
 render(<ExternalAgentsPage auth={auth()} />);await open();fireEvent.click(screen.getByRole("button",{name:"Disable agent"}));expect(externalAgentService.setEnabled).not.toHaveBeenCalled();
 fireEvent.click(within(screen.getByRole("dialog",{name:"Disable agent?"})).getByRole("button",{name:"Disable agent"}));await waitFor(()=>expect(externalAgentService.setEnabled).toHaveBeenCalledWith("qa",false,true));expect(externalAgentService.rotate).not.toHaveBeenCalled();expect(externalAgentService.revoke).not.toHaveBeenCalled();
});
it("changes capability grants only through the server, with confirmation and stale-state expectation",async()=>{
 render(<ExternalAgentsPage auth={auth()} />);await open();tab("Access & Permissions");
 fireEvent.click(screen.getByRole("checkbox",{name:"View Records: Review daily compliance"}));expect(externalAgentService.setCapability).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Review Changes"}));await screen.findByRole("heading",{name:"Review Changes"});fireEvent.click(screen.getByRole("button",{name:"Confirm changes"}));await waitFor(()=>expect(externalAgentService.confirmAccess).toHaveBeenCalledWith("qa",["read_tool_1","read_tool_2","read_tool_3","read_tool_4"],"review"));
});
it("registers a selected implemented capability and shows the new key once",async()=>{
 render(<ExternalAgentsPage auth={auth()} />);fireEvent.click(await screen.findByRole("button",{name:"Connect agent"}));
 expect(screen.getByRole("button",{name:"Review Changes"}).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText("Agent name"),{target:{value:"New QA Agent"}});fireEvent.change(screen.getByLabelText("Provider",{selector:"input"}),{target:{value:"Provider"}});
 fireEvent.click(screen.getByRole("checkbox",{name:"View Records: Review daily compliance"}));fireEvent.click(screen.getByRole("button",{name:"Review Changes"}));await screen.findByRole("heading",{name:"Review Changes"});fireEvent.click(screen.getByRole("button",{name:"Confirm and connect"}));
 await screen.findByRole("heading",{name:"Save the access key"});expect(externalAgentService.registerReviewed).toHaveBeenCalledWith(expect.any(String),"New QA Agent","Provider","factory_mesti",["read_tool_0"],90,"review");expect(screen.getByLabelText("New access key").type).toBe("password");
});

it("clears an issued key when the signed-in administrator changes even with the same permissions",async()=>{
 const view=render(<ExternalAgentsPage auth={{...auth(),user:{id:"first-admin"}}} />);await open();
 fireEvent.click(screen.getByRole("button",{name:"Replace access key"}));fireEvent.click(within(screen.getByRole("dialog",{name:"Replace access key?"})).getByRole("button",{name:"Replace access key"}));
 await screen.findByRole("heading",{name:"Save the access key"});
 view.rerender(<ExternalAgentsPage auth={{...auth(),user:{id:"next-admin"}}} />);
 await waitFor(()=>expect(screen.queryByDisplayValue("TEST_ONE_TIME_SECRET")).toBeNull());
});

it("keeps legacy read activity understandable after review tools leave the permission catalog",async()=>{
 externalAgentService.details.mockResolvedValue({...detail,access_events:[{id:1,occurred_at:"2026-10-29T01:00:00Z",method:"tools/call",tool:"get_mesti_daily_status",source:"external",outcome:"success"}]});
 render(<ExternalAgentsPage auth={auth()} />);await open();tab("Activity");
 expect(screen.getByText("Daily MeSTI review")).toBeTruthy();expect(screen.queryByText("Unsupported request")).toBeNull();
});

it("keeps preserved scope separate from module selections and exposes technical resources only in Developer Diagnostics",async()=>{
 const retained={name:"factory_mesti_review_view",label:"Preserved MeSTI compliance review",technical_label:"Compliance review records",permission:"factory_agent_mesti_review.view",resource_key:"factory.mesti_review",mcp_tool:"query_factory_resources",capability:"view",granted:true,can_assign:true};
 const scopedAgent={...agent,preserved_access:[retained],tools:capabilities.map((c)=>({...c,granted:false,limited_access:true,technical_resources:[{resource:"evidence",row_scope:{module:"cleaning_of_area"}}]}))};
 externalAgentService.list.mockResolvedValue({connections:[scopedAgent],catalog,can_register:true});externalAgentService.details.mockResolvedValue({...detail,connections:[scopedAgent]});
 render(<ExternalAgentsPage auth={auth()} />);await open();
 expect(screen.getByText("1 capability · View only")).toBeTruthy();expect(screen.queryByText("No resources allowed")).toBeNull();
 tab("Access & Permissions");
 expect(screen.getByRole("checkbox",{name:"View Records: Preserved MeSTI compliance review"}).checked).toBe(true);expect(screen.queryByRole("button",{name:"Remove access"})).toBeNull();
 expect(screen.getByRole("checkbox",{name:"View Records: Review daily compliance"}).checked).toBe(false);
 tab("Overview");fireEvent.click(screen.getByRole("button",{name:"Developer Diagnostics"}));expect(screen.getAllByText(/evidence \(cleaning_of_area\)/).length).toBeGreaterThan(0);
});

it('filters same-time activity by outcome/admin provenance without merging events',async()=>{
 const time='2026-10-29T14:00:00Z';
 externalAgentService.details.mockResolvedValue({...detail,access_events:[{id:1,occurred_at:time,method:'ping',outcome:'success',source:'external'},{id:2,occurred_at:time,method:'tools/call',tool:'query_factory_resources',outcome:'denied',failure_reason:'capability_denied',source:'external',resource_actions:[{resource:'mesti_review',action:'list'}]}],management_events:[{id:3,occurred_at:time,label:'Access removed'}]});
 render(<ExternalAgentsPage auth={auth()} />);await open();tab('Activity');
 expect(screen.getByText('Connection checked')).toBeTruthy();expect(screen.getByText('Records requested')).toBeTruthy();expect(screen.getByText('Access removed')).toBeTruthy();
 const filters=within(screen.getByRole('tablist',{name:'Activity filter'}));
 fireEvent.click(filters.getByRole('tab',{name:'Denied'}));expect(screen.getByText('Records requested')).toBeTruthy();expect(screen.queryByText('Access removed')).toBeNull();expect(screen.getByText('This capability is not allowed.')).toBeTruthy();
 fireEvent.click(filters.getByRole('tab',{name:'Admin Changes'}));expect(screen.getByText('Access removed')).toBeTruthy();expect(screen.queryByText('Records requested')).toBeNull();
 fireEvent.click(filters.getByRole('tab',{name:'Successful'}));expect(screen.getByText('Connection checked')).toBeTruthy();expect(screen.queryByText('Access removed')).toBeNull();
});
it('keeps the complete server summary in Manage instead of the compact table',async()=>{
 externalAgentService.list.mockResolvedValue({connections:[{...agent,effective_access:{summary:'Server-authorized MeSTI scope'}}],catalog,can_register:true});
 externalAgentService.details.mockResolvedValue({...detail,connections:[{...agent,effective_access:{summary:'Server-authorized MeSTI scope'}}]});
 render(<ExternalAgentsPage auth={auth()} />);expect(await screen.findByText('5 capabilities · View only')).toBeTruthy();expect(screen.queryByText('Server-authorized MeSTI scope')).toBeNull();await open();tab('Access & Permissions');expect(screen.getByText('Server-authorized MeSTI scope')).toBeTruthy();
});

it('separates the persisted 180-day issuance from the 90-day replacement default without changing a key', async()=>{
 const existing={...credential,created_at:'2026-10-30T02:17:29.923174Z',expires_at:'2027-04-28T02:17:29.922224Z'};
 externalAgentService.details.mockResolvedValue({...detail,connections:[{...agent,credential:existing,credential_policy:{days:[30,90,180],default_days:90}}]});
 render(<ExternalAgentsPage auth={auth()} />);await open();
 const current=within(screen.getByRole('group',{name:'Current Access Key',exact:true}));
 expect(current.getByText('180 days')).toBeTruthy();
 expect(current.getByText(/28 Apr 2027/).textContent).toContain('10:17 AM');
 const replacement=within(screen.getByRole('group',{name:'Replace Access Key',exact:true}));
 expect(replacement.getByRole('button',{name:'Replacement key validity'}).textContent).toContain('90 days');
 fireEvent.click(replacement.getByRole('button',{name:'Replacement key validity'}));
 fireEvent.click(screen.getByRole('option',{name:'180 days'}));
 expect(current.getByText('180 days')).toBeTruthy();
 expect(externalAgentService.rotate).not.toHaveBeenCalled();expect(externalAgentService.revoke).not.toHaveBeenCalled();
});
it.each([
 [{connection_status:'mcp_observed',last_mcp_success:'2026-10-30T02:30:00Z'},'Connected'],
 [{connection_status:'not_observed'},'Not Connected'],
 [{connection_status:'mcp_observed',enabled:false},'Disabled'],
 [{connection_status:'mcp_observed',credential:{...credential,status:'expired'}},'Expired'],
 [{connection_status:'mcp_observed',credential:{...credential,status:'revoked'}},'Not Connected'],
])('presents recorded connection and credential states consistently: %j',async(patch,label)=>{
 const current={...agent,...patch};externalAgentService.list.mockResolvedValue({connections:[current],catalog});
 externalAgentService.details.mockResolvedValue({...detail,connections:[current]});
 render(<ExternalAgentsPage auth={auth()} />);
 const manage = await screen.findByRole('button',{name:'Manage QA Executive'});
 expect(within(within(manage.closest('tr')).getAllByRole('cell')[3]).getByText(label)).toBeTruthy();
 await open();expect(within(screen.getByRole('region',{name:'Connection',exact:true})).getByText(label)).toBeTruthy();
 expect(screen.getByText(/not a real-time online presence/)).toBeTruthy();
 if(label==='Connected')expect(screen.getAllByTitle(/Recorded successful MCP access/).length).toBe(2);
});
it('keeps legacy expiry readable when issuance metadata is absent',async()=>{
 externalAgentService.details.mockResolvedValue({...detail,connections:[{...agent,credential:{...credential,created_at:null}}]});
 render(<ExternalAgentsPage auth={auth()} />);await open();
 const current=within(screen.getByRole('group',{name:'Current Access Key'}));
 expect(current.getByText(/28 Nov 2026/)).toBeTruthy();expect(current.getAllByText('Not recorded')).toHaveLength(2);
});

it('counts server capabilities including retained access once per grant, never per shared resource',async()=>{
 const granted=[...capabilities.slice(0,2).map(c=>({...c,domain:'Production',scope:[{resource:'shared'},{resource:'another'}]})),{...capabilities[2],domain:'MeSTI',retained_only:true}];
 externalAgentService.list.mockResolvedValue({connections:[{...agent,business_capabilities:[...granted,{...granted[0],name:'duplicate_projection'}, {...capabilities[3],granted:false},{...capabilities[4],implemented:false}]}],catalog});
 render(<ExternalAgentsPage auth={auth()} />);
 expect(await screen.findByText('3 capabilities · View only')).toBeTruthy();expect(screen.getByText('Production',{exact:true})).toBeTruthy();expect(screen.getByText('MeSTI',{exact:true})).toBeTruthy();
 expect(screen.queryByText('Review daily compliance',{exact:true})).toBeNull();
});
it('shows three distinct server domain labels with accessible overflow without expanding the row',async()=>{
 const granted=capabilities.map((c,i)=>({...c,domain:['Production','MeSTI','Warehouse','System','Production'][i]}));
 externalAgentService.list.mockResolvedValue({connections:[{...agent,business_capabilities:granted}],catalog});render(<ExternalAgentsPage auth={auth()} />);
 expect(await screen.findByText('5 capabilities · View only')).toBeTruthy();expect(screen.queryByText('System',{exact:true})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Show 1 more business domains'}));expect(await screen.findByRole('dialog',{name:'More business domains'})).toBeTruthy();expect(screen.getByText('System',{exact:true})).toBeTruthy();
});
