import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { finishedGoodsExportColumns,finishedGoodsExportSorts,finishedGoodSelectionKey } from "../utils/finishedGoodsExport.js";
describe("Finished Goods export authority",()=>{
  it("defaults every financial column off and hides inaccessible cost sources",()=>{
    const available=finishedGoodsExportColumns(()=>true,()=>"",()=>"");
    expect(available.filter(c=>["price","cost","margin"].includes(c.key)).every(c=>!c.defaultSelected)).toBe(true);
    expect(finishedGoodsExportColumns(()=>false,()=>"",()=>"").some(c=>["price","cost","margin"].includes(c.key))).toBe(false);
    expect(finishedGoodsExportColumns(key=>key==="factory_finished_goods.view",()=>"",()=>"").map(c=>c.key)).not.toContain("cost");
  });
  it("exports canonical bilingual family identity and family tags separately from SKU",()=>{
    const cols=finishedGoodsExportColumns(()=>true,()=>"60 g",()=>"Room Temperature");
    const row={product_family_id:"family",product_family_name:"Sauce",product_family_name_cn:"酱",product_code:"S16",tags:[{id:"t",name:"Food Service"}]};
    expect(cols.find(c=>c.key==="product").value(row)).toBe("Sauce\n酱");
    expect(cols.find(c=>c.key==="tags").value(row)).toBe("Food Service");
    expect(finishedGoodSelectionKey(row)).toBe("family");
    expect(finishedGoodsExportSorts.find(s=>s.value==="sku").compare({product_code:"S2"},{product_code:"S10"})).toBeLessThan(0);
  });
  it("new descriptive metadata never rewrites stock/SKU and forbids anonymous and direct writes",()=>{
    const sql=readFileSync("supabase/migrations/20261013091929_factory_finished_good_tags.sql","utf8");
    expect(sql).toContain("primary key (product_family_id,tag_id)");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("Archived tags cannot be newly assigned");
    expect(sql).toContain("for update");
    expect(sql).toContain("from public,anon");
    expect(sql).not.toMatch(/update public.factory_(finished_goods|productions|product_stock_movements)/);
  });
});
