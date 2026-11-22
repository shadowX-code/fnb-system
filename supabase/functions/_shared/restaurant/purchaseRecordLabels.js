// The Admin Purchase Input service embeds these relations under the caller's RLS.
// Historical records without the category relation use the supplier category.
export function purchaseRecordLabels(row){
 return {
  supplier_name:row.supplier?.name??'',
  category_name:row.category?.name??row.supplier?.category??'',
 };
}
