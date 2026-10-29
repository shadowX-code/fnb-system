import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ExternalAgentsPage from "./ExternalAgentsPage.jsx";
import { externalAgentService } from "../../services/externalAgentService.js";
vi.mock("../../services/externalAgentService.js", () => ({ externalAgentService: { list: vi.fn(), details: vi.fn(), revoke: vi.fn(), rotate: vi.fn(), test: vi.fn(), setEnabled: vi.fn(), setCapability: vi.fn(), register: vi.fn() } }));
const credential = { id: "existing-credential", status: "active", created_at: "2026-10-29T01:00:00Z", expires_at: "2026-11-28T01:00:00Z" };
const capabilities = ["Review daily compliance", "Review compliance exceptions", "Review pending verifications", "View compliance evidence", "View requirement schedule"].map((label, i) => ({ name: `read_tool_${i}`, label, description: "Read evidence safely", capability: "read", workspace: "Factory", domain: "mesti", domain_label: "MeSTI", implemented: true, granted: true, can_assign: true, permission: `internal_${i}.view` }));
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
});
afterEach(cleanup);
async function open() { fireEvent.click(await screen.findByRole("button", { name: "Manage QA Executive" })); await screen.findByRole("heading", { name: "Agent overview" }); }
function tab(name) { fireEvent.click(screen.getByRole("tab", {name,exact:true})); }
it("uses the six business columns, three tabs and hides technical identifiers until Advanced Details", async () => {
 render(<ExternalAgentsPage auth={auth()} />);
 await screen.findByRole("button",{name:"Manage QA Executive"});
 expect(screen.getAllByRole("columnheader").map((element)=>element.textContent)).toEqual(["Agent","Workspace","Access","Connection","Last Active","Actions"]);
 await open();expect(screen.queryByText("factory_mesti_inspection.view")).toBeNull();
 tab("Access & Permissions");expect(screen.getByText("Review daily compliance")).toBeTruthy();expect(screen.queryByText("read_tool_0")).toBeNull();
 expect(screen.getByText(/Draft, Execute, Approve actions are unavailable/)).toBeTruthy();
 expect(screen.getByText(/Production, Warehouse, Assets/)).toBeTruthy();
 tab("Activity");expect(screen.getByText("FeedX connection check")).toBeTruthy();expect(screen.queryByText("initialize")).toBeNull();
 tab("Overview");fireEvent.click(screen.getByRole("button",{name:"Advanced Details"}));expect(screen.getByText("factory_mesti_inspection.view")).toBeTruthy();expect(screen.getByText(/read_tool_0/)).toBeTruthy();
});
it("confirms key replacement and clears one-time secrets on close", async () => {
 render(<ExternalAgentsPage auth={auth()} />);await open();
 fireEvent.click(screen.getByRole("button",{name:"Replace access key"}));expect(externalAgentService.rotate).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Cancel",exact:true}));expect(externalAgentService.rotate).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Replace access key"}));fireEvent.click(within(screen.getByRole("dialog",{name:"Replace access key?"})).getByRole("button",{name:"Replace access key"}));
 await screen.findByRole("heading",{name:"Save the access key"});expect(screen.getByLabelText("New access key").type).toBe("password");
 expect(externalAgentService.rotate).toHaveBeenCalledWith("qa","existing-credential",expect.any(String));
 fireEvent.click(screen.getByRole("button",{name:"I have saved the key"}));expect(screen.queryByDisplayValue("TEST_ONE_TIME_SECRET")).toBeNull();
});
it("keeps revocation explicit and bound to the exact key",async()=>{
 render(<ExternalAgentsPage auth={auth()} />);await open();fireEvent.click(screen.getByRole("button",{name:"Advanced Details"}));
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
 fireEvent.click(screen.getByRole("button",{name:"Remove Read access to Review daily compliance"}));expect(externalAgentService.setCapability).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Remove access",exact:true}));await waitFor(()=>expect(externalAgentService.setCapability).toHaveBeenCalledWith("qa","read_tool_0",false,true));
});
it("registers a selected implemented capability and shows the new key once",async()=>{
 render(<ExternalAgentsPage auth={auth()} />);fireEvent.click(await screen.findByRole("button",{name:"Connect agent"}));
 expect(screen.getByRole("button",{name:"Connect and issue key"}).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText("Agent name"),{target:{value:"New QA Agent"}});fireEvent.change(screen.getByLabelText("Provider",{selector:"input"}),{target:{value:"Provider"}});
 fireEvent.click(screen.getByRole("checkbox",{name:"Allow Review daily compliance"}));fireEvent.submit(document.getElementById("connect-agent"));
 await screen.findByRole("heading",{name:"Save the access key"});expect(externalAgentService.register).toHaveBeenCalledWith(expect.any(String),"New QA Agent","Provider","factory_mesti",["read_tool_0"]);expect(screen.getByLabelText("New access key").type).toBe("password");
});
