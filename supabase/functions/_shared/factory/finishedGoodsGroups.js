// The Admin grouped catalogue includes configured families without SKUs and
// treats each unassigned SKU as one standalone product.
export function groupFinishedGoods(families,rows,categories=[]){
 const categoryById=new Map(categories.map(category=>[category.id,category]));
 const bins=new Map();
 for(const sku of rows){
  const group=bins.get(sku.product_family_id)||[];
  group.push(sku);
  bins.set(sku.product_family_id,group);
 }
 const groups=families.map(family=>{
  const skus=bins.get(family.id)||[];
  return {...family,groupKey:family.id,product_group_name:family.name_en,
   category:family.category||categoryById.get(family.category_id)?.name||'No category',
   skus,active_sku_count:skus.filter(sku=>sku.status==='active').length,isStandalone:false};
 });
 for(const sku of rows.filter(row=>!row.product_family_id))groups.push({
  id:'__sku_'+sku.id,groupKey:'__sku_'+sku.id,product_group_name:sku.product_name_en||sku.product_name||sku.product_code||'Unassigned Finished Good',
  name_cn:sku.product_name_cn||'',name_bm:sku.product_name_bm||'',category:sku.category||'No category',
  category_id:sku.category_id||'',status:sku.status||'active',skus:[sku],active_sku_count:sku.status==='active'?1:0,isStandalone:true,
 });
 return groups;
}
