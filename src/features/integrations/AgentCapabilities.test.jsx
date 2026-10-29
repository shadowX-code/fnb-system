import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AgentCapabilities from "./AgentCapabilities.jsx";
afterEach(cleanup);
it("makes unsupported actions unavailable and renders explicit action and approval metadata",()=>{
 render(<AgentCapabilities canManage capabilities={[{name:"unavailable",label:"Unavailable action",workspace:"Factory",domain:"qa",domain_label:"QA",description:"No implementation",capability:"execute",implemented:false,can_assign:true,requires_human_approval:true}]} />);
 expect(screen.getByText("Unavailable")).toBeTruthy();expect(screen.queryByRole("button",{name:/Grant/})).toBeNull();expect(screen.getByText("Human approval required for this action.")).toBeTruthy();
 expect(screen.getByText(/Read, Draft, Execute, Approve actions are unavailable/)).toBeTruthy();
});
