// Brand intent determines the security scope; legacy scope URLs/preferences remain read-compatible.
export function resolveBrandContext(context, requestedBrand = '', fallbackScope = '') {
 const scopes=context?.organizations||[], brands=context?.brands||[];
 const selected=brands.find(b=>b.id===requestedBrand&&scopes.some(s=>s.id===b.organization_id));
 const org=selected?.organization_id||(scopes.some(s=>s.id===fallbackScope)?fallbackScope:scopes[0]?.id)||'';
 return {org,brand:selected?.id||''};
}
export function selectBrandContext(context,value,currentScope,setScope,setBrand){
 const next=resolveBrandContext(context,value,currentScope);
 setScope(next.org);setBrand(next.brand);
}
