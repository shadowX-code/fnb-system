import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("../../lib/supabase.ts",()=>({supabase:{rpc:mocks.rpc}}));
import { factoryService } from "../factoryService.js";
beforeEach(()=>vi.clearAllMocks());
it("uses one batched canonical tag snapshot",async()=>{
  mocks.rpc.mockResolvedValue({data:{tags:[],assignments:[]},error:null});
  expect(await factoryService.getFinishedGoodTags()).toEqual({tags:[],assignments:[]});
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("factory_get_finished_good_tags");
});
it("uses trusted stable-ID mutations, preserving useful failures",async()=>{
  mocks.rpc.mockResolvedValue({data:"tag-id",error:null});
  await factoryService.saveFinishedGoodTag({id:"tag-id",name:"Renamed",status:"archived"});
  expect(mocks.rpc).toHaveBeenLastCalledWith("factory_save_finished_good_tag",{p_id:"tag-id",p_name:"Renamed",p_status:"archived"});
  await factoryService.setProductFamilyTags("family",["tag-id"]);
  expect(mocks.rpc).toHaveBeenLastCalledWith("factory_set_product_family_tags",{p_family_id:"family",p_tag_ids:["tag-id"]});
  mocks.rpc.mockResolvedValue({error:{message:"Archived tags cannot be newly assigned."}});
  await expect(factoryService.setProductFamilyTags("family",["tag-id"])).rejects.toThrow();
});
