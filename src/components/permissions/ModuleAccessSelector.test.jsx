import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ModuleAccessSelector from "./ModuleAccessSelector.jsx";
afterEach(cleanup);
const rows = ["Cleaning of Area", "Calibration"].map((label,i)=>({name:`resource_${i}`,label,module_id:`module_${i}`,section:"MeSTI",coverage:"partial",workspace:"Factory",sidebar:true,description:"Scoped records only",capability:"view",implemented:true,can_assign:true,granted:i===0}));
it("uses one View Records control per resource and reports exact selection counts",()=>{
 const change=vi.fn(),many=vi.fn();render(<ModuleAccessSelector canManage capabilities={rows} onChange={change} onChangeMany={many} />);
 expect(screen.queryByRole("columnheader")).toBeNull();expect(screen.getByText("1 of 2 selected")).toBeTruthy();
 fireEvent.click(screen.getByRole("checkbox",{name:"View Records: Calibration"}));expect(change).toHaveBeenCalledWith(rows[1]);
 fireEvent.click(screen.getByRole("button",{name:"Select all"}));expect(many).toHaveBeenCalledWith([rows[1]],true);
 fireEvent.click(screen.getByRole("button",{name:"Clear"}));expect(many).toHaveBeenLastCalledWith([rows[0]],false);
});
it("shares selection behavior for registration without granting unassignable resources",()=>{
 const many=vi.fn();render(<ModuleAccessSelector selection={[]} capabilities={[...rows,{...rows[0],name:"denied",can_assign:false}]} onSelectMany={many} />);
 fireEvent.click(screen.getByRole("button",{name:"Select all"}));expect(many).toHaveBeenCalledWith(["resource_0","resource_1"],true);
 expect(screen.getByText(/Draft, Execute and Approve are unavailable/)).toBeTruthy();
});

it("shows Unavailable as disabled and excludes it from bulk module selection",()=>{
 const many=vi.fn();render(<ModuleAccessSelector selection={[]} capabilities={[...rows,{...rows[0],name:"reports",label:"Production Reports",module_id:"factory_production_reports",implemented:false,coverage:"unavailable",description:"Cost reports are not covered"}]} onSelectMany={many} />);
 expect(screen.getByRole("checkbox",{name:"View Records: Production Reports"}).disabled).toBe(true);expect(screen.getByText("Cost reports are not covered")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Select all"}));expect(many).toHaveBeenCalledWith(["resource_0","resource_1"],true);
 expect(screen.getByText("2 modules available · 1 unavailable")).toBeTruthy();
});
