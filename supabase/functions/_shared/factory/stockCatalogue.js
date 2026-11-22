import {AssistantError} from '../assistantError.js';

export const stockRankFields = {
 sort: {type:'string',enum:['name','balance_desc','balance_asc'],description:'Use balance_desc for highest stock or balance_asc for lowest stock, before pagination.'},
 uom: {type:['string','null'],maxLength:24,description:'Exact stock unit, such as kg. Mixed units cannot be ranked together. Null is allowed when all matching rows use a single known unit.'},
};
export function validateStockRanking(args) {
 if(!stockRankFields.sort.enum.includes(args.sort) || (args.uom !== null && (typeof args.uom !== 'string'||!args.uom.trim()||args.uom.length>24))
   || (args.sort !== 'name' && args.mode !== 'list'))throw new AssistantError('tool_arguments_invalid',400);
}
export const stockNumber = n => n == null || n === '' || !Number.isFinite(Number(n)) ? null : Number(n);
export const stockUnit = unit => String(unit || '').trim().toLowerCase();
export const stockSku = sku => String(sku||'').normalize('NFKC').trim().toUpperCase();

export async function loadStockCatalogue(caller, {entity,table,fields}, signal) {
 const {data:ids,error}=await caller.rpc('factory_get_master_id_snapshot',{p_entity:entity}).abortSignal(signal);
 if(error||!Array.isArray(ids))throw new AssistantError(error?.code==='42501'?'business_read_denied':'inventory_unavailable',error?.code==='42501'?403:503);
 if(ids.length>1000)throw new AssistantError('inventory_result_limit',413);
 const expected = new Set(ids);
 const rows=[];
 for(let i=0;i<ids.length;i+=100){
  const {data,error:failure}=await caller.from(table).select(fields).in('id',ids.slice(i,i+100)).abortSignal(signal);
  if(failure||!Array.isArray(data))throw new AssistantError(failure?.code==='42501'?'business_read_denied':'inventory_unavailable',failure?.code==='42501'?403:503);
  rows.push(...data.map(row=>Object.fromEntries(fields.split(',').map(field=>[field,row[field]]))));
 }
 if(rows.length!==expected.size||new Set(rows.map(r=>r.id)).size!==expected.size||rows.some(r=>!expected.has(r.id)))throw new AssistantError('inventory_scope_changed',409);
 return rows.map(row=>({...row,current_balance:stockNumber(row.current_balance),min_stock_level:stockNumber(row.min_stock_level)}));
}

export function stockPage(rows, args, name) {
 const byName = (a,b) => String(a[name]||'').localeCompare(String(b[name]||'')) || a.id.localeCompare(b.id);
 const units=[...new Set(rows.map(row=>stockUnit(row.uom)).filter(Boolean))].sort();
 const matching = args.uom===null ? rows : rows.filter(row=>stockUnit(row.uom)===stockUnit(args.uom));
 const excluded = matching.filter(row=>row.current_balance===null||!stockUnit(row.uom)).length;
 const ranking = args.sort!=='name';
 const requiresUnit = ranking && args.uom===null && units.length>1;
 const ranked=requiresUnit ? [] : matching.filter(row=>!ranking || (row.current_balance!==null&&stockUnit(row.uom))).sort((a,b)=>
  (ranking ? (args.sort==='balance_desc'? b.current_balance-a.current_balance : a.current_balance-b.current_balance) : 0) || byName(a,b));
 const offset=(args.page-1)*20;
 return {
  rows:args.mode==='summary'?[]:ranked.slice(offset,offset+20),
  total_matching:matching.length,
  truncated:!requiresUnit&&args.mode!=='summary'&&ranked.length>offset+20,
  ...(ranking?{ranking:{status:requiresUnit?'unit_required':ranked.length?'ranked':'no_rankable_rows',
   available_units:units,unit:args.uom===null?(units.length===1?units[0]:null):stockUnit(args.uom),
   ranked_count:ranked.length,excluded_unknown_balance_or_unit:excluded,
   order:args.sort,definition:'Rank recorded balances over all matching rows of one stock unit before paging. No cross-unit conversion or forecast.'}}:{}),
 };
}

// Shared with Factory Raw Material Inventory. A known zero/negative balance
// takes precedence over the inclusive minimum threshold.
export function rawMaterialStockStatus(balance, minimum) {
 return balance <= 0 ? 'Out of Stock' : Number(minimum || 0)>0 && balance<=Number(minimum) ? 'Low Stock' : 'In Stock';
}
