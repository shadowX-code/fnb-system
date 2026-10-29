import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AgentCapabilities from "./AgentCapabilities.jsx";
afterEach(cleanup);
it("makes unsupported actions unavailable and renders explicit action and approval metadata",()=>{
 render(<AgentCapabilities canManage capabilities={[{name:"unavailable",label:"Unavailable action",workspace:"Factory",domain:"qa",domain_label:"QA",description:"No implementation",capability:"execute",implemented:false,can_assign:true,requires_human_approval:true}]} />);
 expect(screen.getByText("Unavailable")).toBeTruthy();expect(screen.queryByRole("button",{name:/Grant/})).toBeNull();expect(screen.getByText("Human approval required for this action.")).toBeTruthy();
 expect(screen.getByText(/Draft, Execute, Approve actions are unavailable/)).toBeTruthy();
});

it("groups resource actions separately from legacy grants and never assumes inherited resource access",()=>{
 const capabilities=["list","read","search","filter"].map((action)=>({name:`requirements_${action}`,label:`Requirements · ${action}`,resource_key:"factory.mesti.requirements",resource_label:"Requirements",resource_description:"Versioned requirements",workspace:"Factory",domain:"mesti",domain_label:"MeSTI",capability:action,implemented:true,granted:false,can_assign:true}));
 render(<AgentCapabilities canManage capabilities={capabilities} />);
 expect(screen.getAllByRole("columnheader").map((node)=>node.textContent)).toEqual(["Resource","List","Read","Search","Filter"]);
 expect(screen.getAllByText("Not allowed")).toHaveLength(4);expect(screen.getByRole("button",{name:"Grant Read access to Requirements"})).toBeTruthy();
 expect(screen.getByText(/Existing review-tool access does not grant resource access/)).toBeTruthy();
});
