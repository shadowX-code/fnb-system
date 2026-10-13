import { act,cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
const calls=vi.hoisted(()=>({save:vi.fn(),assign:vi.fn()}));
vi.mock("../../../../../services/factoryService.js",()=>({factoryService:{saveFinishedGoodTag:calls.save,setProductFamilyTags:calls.assign}}));
import FactoryFinishedGoodTagsModal from "../FactoryFinishedGoodTagsModal.jsx";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("locks record editing during a pending create so canonical refresh cannot erase an overlapping edit",async()=>{
 let finish;calls.save.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const reload=vi.fn().mockResolvedValue({});
 render(<FactoryFinishedGoodTagsModal catalog={{tags:[{id:"t",name:"Existing",status:"active"}],assignments:[],reload}} canCreate canEdit onClose={()=>{}}/>);
 fireEvent.change(screen.getByRole("textbox",{name:"Tag name"}),{target:{value:"New"}});
 fireEvent.click(screen.getByRole("button",{name:"Create Tag"}));
 expect(screen.getByRole("button",{name:"Edit tag"}).disabled).toBe(true);
 await act(async()=>finish("id"));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Edit tag"}).disabled).toBe(false));
 expect(reload).toHaveBeenCalledOnce();
});
it("does not expose writes to a view-only role",()=>{
 render(<FactoryFinishedGoodTagsModal catalog={{tags:[{id:"t",name:"Existing",status:"active"}],assignments:[]}} family={{id:"f",name_en:"Product"}} canCreate={false} canEdit={false} onClose={()=>{}}/>);
 expect(screen.getByRole("button",{name:"Save Tags"}).disabled).toBe(true);
 expect(screen.getByRole("button",{name:"Tags"}).disabled).toBe(true);
 expect(calls.assign).not.toHaveBeenCalled();
});
