import { money, percent } from "./factoryFormatters.js";
export const finishedGoodSelectionKey = row => row.product_family_id || row.id;
const name = row => row.product_family_name || row.product_name_en || row.product_name || "";
export const finishedGoodsExportSorts = [
  { value:"category",label:"Category",compare:(a,b)=>(a.category||"").localeCompare(b.category||"") || name(a).localeCompare(name(b)) || (a.product_code||"").localeCompare(b.product_code||"") },
  { value:"product",label:"Product",compare:(a,b)=>name(a).localeCompare(name(b)) || (a.product_code||"").localeCompare(b.product_code||"") },
  { value:"sku",label:"SKU",compare:(a,b)=>(a.product_code||"").localeCompare(b.product_code||"",undefined,{numeric:true}) },
];
export function finishedGoodsExportColumns(can, formatPackSize, formatStorage) {
  const columns = [
    {key:"category",label:"Category",minWidth:25,defaultSelected:true,value:r=>r.category || "—"},
    {key:"product",label:"Product",minWidth:52,repeat:true,defaultSelected:true,value:r=>[name(r),r.product_family_name_cn || r.product_name_cn].filter(Boolean).join("\n")},
    {key:"tags",label:"Tags",minWidth:28,defaultSelected:true,value:r=>r.tags?.map(t=>t.name).join(", ") || "—"},
    {key:"halal",label:"Halal",minWidth:15,defaultSelected:true,value:r=>r.is_halal ? "Halal" : "No"},
    {key:"sku",label:"SKU",minWidth:22,repeat:true,defaultSelected:true,value:r=>r.product_code || "—"},
    {key:"pack",label:"Pack Size",minWidth:22,defaultSelected:true,value:formatPackSize},
    {key:"storage",label:"Storage",minWidth:30,defaultSelected:true,value:formatStorage},
    {key:"shelf",label:"Shelf Life",minWidth:22,defaultSelected:true,value:r=>r.shelf_life_days ? r.shelf_life_days+" days" : "—"},
  ];
  // No new financial authority: require the same source modules used by current cost reads.
  if (can("factory_finished_goods.view")) columns.push({key:"price",label:"B2B Price",minWidth:22,value:r=>r.b2b_price == null ? "—" : money(r.b2b_price)});
  if (can("factory_product_recipes.view") && can("factory_raw_receiving.view")) columns.push(
    {key:"cost",label:"Cost",minWidth:22,value:r=>r.commercial_cost == null ? "—" : money(r.commercial_cost)},
    {key:"margin",label:"Gross Margin",minWidth:22,value:r=>r.gross_margin == null ? "—" : percent(r.gross_margin)},
  );
  return columns;
}
