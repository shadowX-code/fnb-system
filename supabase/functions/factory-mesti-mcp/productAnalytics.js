import {aggregateItems,rankProducts,mapProductItem} from '../_shared/productAnalyticsModel.js';
import {readCompleteRows} from '../_shared/completeRows.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const productAnalyticsTool={name:'query_product_sales_analytics',description:'Read canonical Product Sales Analytics for one authorized outlet: periods, complete product/category rankings, quantities, net sales, discounts and an optional comparison period. Reads every source page before aggregating; refuses changed/incomplete sources. Missing reports are explicit. POS reports and sales remain read-only.',annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:{type:'object',additionalProperties:false,required:['outlet_id'],properties:{outlet_id:{type:'string',format:'uuid'},periods:{type:'boolean'},year:{type:'integer',minimum:2000,maximum:2100},month:{type:'integer',minimum:1,maximum:12},compare_year:{type:'integer',minimum:2000,maximum:2100},compare_month:{type:'integer',minimum:1,maximum:12},include_variants:{type:'boolean'},rank_by:{type:'string',enum:['sales','quantity']},page:{type:'integer',minimum:1,maximum:500},page_size:{type:'integer',minimum:1,maximum:100}}}};
export function productAnalyticsArguments(args){if(!args||Array.isArray(args)||typeof args!=='object'||Object.keys(args).some(k=>!Object.hasOwn(productAnalyticsTool.inputSchema.properties,k))||!uuid.test(args.outlet_id||''))throw new Error('Use an authorized outlet and supported Product Analytics query.');for(const k of ['year','compare_year'])if(args[k]!==undefined&&(!Number.isInteger(args[k])||args[k]<2000||args[k]>2100))throw new Error('Invalid report year.');for(const k of ['month','compare_month'])if(args[k]!==undefined&&(!Number.isInteger(args[k])||args[k]<1||args[k]>12))throw new Error('Invalid report month.');for(const k of ['periods','include_variants'])if(args[k]!==undefined&&typeof args[k]!=='boolean')throw new Error('Invalid query flag.');if(!args.periods&&!args.year)throw new Error('Report year required.');if(args.compare_month&&!args.compare_year)throw new Error('Comparison year required.');if(args.rank_by!==undefined&&!['sales','quantity'].includes(args.rank_by))throw new Error('Rank by sales or quantity.');for(const [k,max] of [['page',500],['page_size',100]])if(args[k]!==undefined&&(!Number.isInteger(args[k])||args[k]<1||args[k]>max))throw new Error('Invalid result page.');return args;}
export async function readProductAnalytics(args,source){
 if(args.periods)return source({p_outlet_id:args.outlet_id,p_periods:true});
 const window=async(year,month)=>{
  let after=null,snapshot=null,reports=[];
  const result=await readCompleteRows('Product Analytics',async()=>{
   const page=await source({p_outlet_id:args.outlet_id,p_year:year,p_month:month??null,p_after:after,p_snapshot:snapshot});
   if(!page||!Array.isArray(page.reports)||typeof page.snapshot!=='string')throw new Error('Product Analytics source completeness unavailable.');
   if(snapshot!==null&&snapshot!==page.snapshot)throw new Error('Product reports changed; restart the complete read.');
   snapshot=page.snapshot;reports=page.reports;
   if(page.records?.length)after=page.records.at(-1).id;
   return {data:page.records,count:page.total_records,error:null};
  });
  const items=result.data.map(mapProductItem).sort((a,b)=>b.nett_sales-a.nett_sales||a.id.localeCompare(b.id));
  const model=aggregateItems(items,{includeVariants:args.include_variants===true});
  const missingMonths=Array.from({length:month?1:12},(_,i)=>month||i+1).filter(m=>!reports.some(r=>Number(r.report_month)===m));
  return {...model,year,month:month??null,source_complete:true,source_rows:items.length,snapshot,reports,missing_months:missingMonths,financial_source_complete:missingMonths.length===0&&reports.every(r=>r.status==='completed')};
 };
 const current=await window(args.year,args.month);const comparison=args.compare_year?await window(args.compare_year,args.compare_month):null;
 const products=rankProducts(current.products,args.rank_by);
 const size=args.page_size??50,page=args.page??1;
 if(products.length&&((page-1)*size)>=products.length)throw new Error('Result page is outside the complete product window.');
 const {products:unused,...summary}=current;
 return {outlet_id:args.outlet_id,...summary,products:products.slice((page-1)*size,page*size),total_products:products.length,page,page_size:size,next_page:page*size<products.length?page+1:null,comparison:comparison?{year:comparison.year,month:comparison.month,totals:comparison.totals,source_complete:comparison.source_complete,financial_source_complete:comparison.financial_source_complete,missing_months:comparison.missing_months,snapshot:comparison.snapshot}:null,limitations:'Aggregates use all saved rows in the selected window. Missing/uncompleted report periods are explicit; completeness of retrieval does not imply a complete POS reporting period.'};
}
