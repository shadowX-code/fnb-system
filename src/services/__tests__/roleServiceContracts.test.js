import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),audit:vi.fn()}));
vi.mock("../../lib/supabase",()=>({supabase:{rpc:mocks.rpc}}));
vi.mock("../auditLogService.js",()=>({auditLogService:{createAuditLog:mocks.audit}}));
import { roleService } from "../roleService.js";
const role={id:"00000000-0000-4000-8000-000000000001",name:"Operations Lead",description:"Current",is_active:true,outletAccess:"selected",permissions:["dashboard.view"],selectedOutletIds:["00000000-0000-4000-8000-000000000101"]};
const result={role:{id:role.id,name:"operations_lead",description:"Current",is_active:true,is_system_role:false,outlet_access_type:"selected"},permissions:["dashboard.view"],outlet_ids:role.selectedOutletIds};
beforeEach(()=>{mocks.rpc.mockReset().mockResolvedValue({data:result,error:null});mocks.audit.mockReset().mockResolvedValue();});
describe("Role trusted configuration service contracts",()=>{
 it("maps one complete update snapshot to the trusted RPC without browser relation DML",async()=>{await roleService.saveRole({...role,requestId:"00000000-0000-4000-8000-000000000010"});expect(mocks.rpc).toHaveBeenCalledWith("save_role_configuration",{p_request_id:"00000000-0000-4000-8000-000000000010",p_role:{id:role.id,name:"operations_lead",description:"Current",is_active:true,outlet_access_type:"selected"},p_permission_codes:["dashboard.view"],p_outlet_ids:role.selectedOutletIds});expect(mocks.audit).toHaveBeenCalledTimes(1);});
 it("maps create to the same authority and preserves a supplied retry request ID",async()=>{const create={...role,id:undefined,requestId:"00000000-0000-4000-8000-000000000011"};await roleService.saveRole(create);await roleService.saveRole(create);expect(mocks.rpc.mock.calls.map(([,p])=>p.p_request_id)).toEqual([create.requestId,create.requestId]);});
 it("surfaces trusted rejection with no audit success",async()=>{mocks.rpc.mockResolvedValueOnce({data:null,error:new Error("rejected")});await expect(roleService.saveRole(role)).rejects.toThrow("rejected");expect(mocks.audit).not.toHaveBeenCalled();});
});
