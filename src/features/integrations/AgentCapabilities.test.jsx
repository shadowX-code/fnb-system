import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AgentCapabilities from "./AgentCapabilities.jsx";
afterEach(cleanup);
const rows = ["Requirements", "Evidence"].map((label,i)=>({name:`resource_${i}`,label,resource_key:`factory.${i}`,resource_label:label,workspace:"Factory",domain:"mesti",domain_label:"MeSTI",capability:"view",implemented:true,can_assign:true,granted:i===0}));
it("uses one View Records control per resource and reports exact selection counts",()=>{
 const change=vi.fn(),many=vi.fn();render(<AgentCapabilities canManage capabilities={rows} onChange={change} onChangeMany={many} />);
 expect(screen.queryByRole("columnheader")).toBeNull();expect(screen.getByText("1 of 2 selected")).toBeTruthy();
 fireEvent.click(screen.getByRole("checkbox",{name:"View Records: Evidence"}));expect(change).toHaveBeenCalledWith(rows[1]);
 fireEvent.click(screen.getByRole("button",{name:"Select all"}));expect(many).toHaveBeenCalledWith([rows[1]],true);
 fireEvent.click(screen.getByRole("button",{name:"Clear"}));expect(many).toHaveBeenLastCalledWith([rows[0]],false);
});
it("shares selection behavior for registration without granting unassignable resources",()=>{
 const many=vi.fn();render(<AgentCapabilities selection={[]} capabilities={[...rows,{...rows[0],name:"denied",can_assign:false}]} onSelectMany={many} />);
 fireEvent.click(screen.getByRole("button",{name:"Select all"}));expect(many).toHaveBeenCalledWith(["resource_0","resource_1"],true);
 expect(screen.getByText(/Draft, Execute and Approve are unavailable/)).toBeTruthy();
});
