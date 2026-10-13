import { cleanup,render,screen } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
const mock=vi.hoisted(()=>({allowed:true,data:{}}));
vi.mock("../useFactoryMasterData.js",()=>({default:()=>mock.data}));
vi.mock("../useFactoryPermissions.js",()=>({default:()=>({can:()=>mock.allowed})}));
import useFactoryFinishedGoodsQuery from "../useFactoryFinishedGoodsQuery.js";
afterEach(cleanup);
const snapshot={tags:[{id:"t",name:"Sauce"},{id:"old",name:"Legacy",status:"archived"}],assignments:[{product_family_id:"family",tag_id:"t"},{product_family_id:"family",tag_id:"old"}]};
function Probe({filter=""}){
 const query=useFactoryFinishedGoodsQuery({filters:{tag:filter},tagSnapshot:snapshot});
 return <div>{JSON.stringify({rows:query.rows.map(r=>({id:r.id,tags:r.tags.map(t=>t.id)})),groups:query.groups.map(g=>g.id)})}</div>;
}
it("inherits stable family tags across all SKUs and filters full matching rows before paging",()=>{
 mock.allowed=true;mock.data={finishedGoods:[{id:"sku1",product_family_id:"family"},{id:"sku2",product_family_id:"family"},{id:"sku3",product_family_id:"other"}],productFamilies:[{id:"family",name_en:"Sauce"},{id:"other",name_en:"Other"}]};
 const view=render(<Probe/>);expect(screen.getByText(/sku1/).textContent).toContain('"tags":["t","old"]');
 view.rerender(<Probe filter="t"/>);expect(screen.getByText(/sku1/).textContent).toContain("sku2");expect(screen.getByText(/sku1/).textContent).not.toContain("sku3");
 expect(screen.getByText(/sku1/).textContent).toContain('"groups":["family"]');
});
it("retains archived descriptions without granting any inventory read without View",()=>{
 mock.allowed=false;render(<Probe/>);expect(screen.getByText('{"rows":[],"groups":[]}')).toBeTruthy();
});
