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

const includesText = (value, search) => !search || String(value || "").toLowerCase().includes(String(search).toLowerCase());

export function filterFinishedGoods(families, products, categories, filters, tagSnapshot) {
  const byFamily=new Map(),catalog=new Map((tagSnapshot?.tags||[]).map((tag,i)=>[tag.id,{tag,i}]));
  for(const {product_family_id,tag_id} of tagSnapshot?.assignments||[]){
    if(!catalog.has(tag_id))continue;
    if(!byFamily.has(product_family_id))byFamily.set(product_family_id,new Set());
    byFamily.get(product_family_id).add(tag_id);
  }
  const familyTags=new Map([...byFamily].map(([id,ids])=>[id,[...ids].map(key=>catalog.get(key)).sort((a,b)=>a.i-b.i).map(row=>row.tag)]));
  const tagsForFamily=id=>familyTags.get(id)||[];
  const rows = products.map((product) => ({ ...product, tags: tagsForFamily(product.product_family_id) })).filter((row) => {
    const productText = [row.product_family_name,row.product_name,row.product_name_en,row.product_name_cn,row.product_name_bm,row.product_code,row.variant_name].join(' ');
    const stockStatus = Number(row.current_balance || 0) <= 0 ? "out_of_stock" : "in_stock";
    return includesText(productText, filters.product) && (!filters.tag || row.tags.some(tag => tag.id === filters.tag)) && (!filters.category || row.category_id === filters.category) && (!filters.status || row.status === filters.status || stockStatus === filters.status);
  });
  const groups = groupFinishedGoods(families, rows, categories);
  const visibleGroups = groups.map(group => ({ ...group, tags: tagsForFamily(group.id) })).filter((group) => {
    const groupNameMatches = includesText(`${group.product_group_name} ${group.name_cn || ""} ${group.name_bm || ""}`, filters.product);
    const matchesCategory = !filters.category || group.category_id === filters.category || group.skus.some((sku) => sku.category_id === filters.category);
    const matchesStatus = !filters.status || group.status === filters.status || group.skus.some((sku) => sku.status === filters.status || (Number(sku.current_balance || 0) <= 0 ? "out_of_stock" : "in_stock") === filters.status);
    return (!filters.tag || group.tags.some(tag => tag.id === filters.tag)) && (groupNameMatches || group.skus.length > 0) && matchesCategory && matchesStatus && (group.skus.length > 0 || !filters.product || groupNameMatches);
  });
  return {rows, groups:visibleGroups};
}
