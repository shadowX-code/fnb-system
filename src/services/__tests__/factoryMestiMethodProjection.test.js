import { beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}));
vi.mock("../../lib/supabase.ts",()=>({supabase:mocks}));
import { factoryService } from "../factoryService.js";
beforeEach(()=>vi.clearAllMocks());
it("preserves the exact occurrence method snapshot without consulting a newer requirement or catalog",async()=>{
 const reference={code:"cleaning",name:"Cleaning",materials:["Water"],steps:["Pinned historical reference"]};
 mocks.rpc.mockResolvedValue({data:[{id:"issued",cleaning_method:"cleaning",cleaning_method_reference:reference},{id:"legacy"}],error:null});
 const rows=await factoryService.listMestiCleaningDay("2026-10-29");
 expect(rows[0].cleaning_method_reference).toEqual(reference);
 expect(rows[1].cleaning_method_reference).toBeNull();
 expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("factory_mesti_cleaning_day",{p_due_date:"2026-10-29"});
 expect(mocks.from).not.toHaveBeenCalled();
});
