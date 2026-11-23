import {AssistantError} from '../assistantError.js';
import {exactName} from '../assistant/entityResolution.js';
import {countedRows,invalidArgument,page,pick,readContract} from '../assistant/readContract.js';
import {groupProductRecipes,recipeProductIdentity} from './productRecipeGroups.js';

const fields=['id','recipe_code','product_name','recipe_name','version','status','yield_quantity','uom','updated_at'];
const columns={name:'recipe_name',code:'recipe_code',product_name:'product_name',status:'status'};
const filter={type:'string',nullable:true,maxLength:120};
// One statement supplies the population, status and ordering for both counts.
// The count check rejects truncated snapshots, including PostgREST's own row cap.
const select=[...fields,'created_at','product_family_id','finished_good_id',
 'product_family:factory_product_families(name_en,name_cn)',
 'finished_good:factory_finished_goods(product_family_id,product_name,product_name_en,product_name_cn,product_family:factory_product_families(name_en,name_cn))'].join(',');
const norm=value=>String(value??'').normalize('NFKC').trim().toLowerCase();
function statusCounts(rows){
 const counts=new Map([['active',0],['draft',0],['archived',0]]);
 for(const row of rows)counts.set(row.status,(counts.get(row.status)||0)+1);
 return {total:rows.length,by_status:Object.fromEntries(counts)};
}
const lifecycleLabels={
 active:{match:/\b(?:active|aktif)\b|启用|啟用|活跃|活躍|生效|在用/iu,en:'active',zh:'启用',hant:'啟用',ms:'aktif'},
 draft:{match:/\b(?:drafts?|draf)\b|草稿/iu,en:'draft',zh:'草稿',hant:'草稿',ms:'draf'},
 archived:{match:/\b(?:archived|diarkibkan|arkib)\b|归档|歸檔|已封存/iu,en:'archived',zh:'已归档',hant:'已歸檔',ms:'diarkibkan'},
};
// This comparison needs both populations and a single named lifecycle status.
// Leave broader questions to their normal field- and scope-aware answer path.
function requestedRecipeComparison(prompt){
 if(!/(?:\b(?:recipes?|bom|resipi)\b|配方|食谱|食譜)/iu.test(prompt)
  ||!/(?:\b(?:current(?:ly)?|latest|semasa|terkini)\b|当前|當前|现行|現行|目前|最新)/iu.test(prompt)
  ||!/(?:\b(?:standards?|piawai(?:an)?|products?|produk)\b|标准|標準|产品|產品)/iu.test(prompt)
  ||!/(?:\b(?:versions?|versi)\b|版本)/iu.test(prompt)
  ||!/(?:\b(?:saved|recorded|earlier|historical|all (?:recipe )?versions|tersimpan|disimpan|direkodkan|semua versi)\b|保存|储存|儲存|歷史|历史|所有(?:配方)?版本|全部(?:配方)?版本)/iu.test(prompt)
  ||!/(?:\b(?:how many|counts?|totals?|compare|comparison|berapa|bilangan|jumlah|bandingkan)\b|多少|总数|總數|数量|數量|对比|對比|比较|比較)/iu.test(prompt))return null;
 if(/\b(?:costs?|prices?|ingredients?|yield|time|durations?|quantities|why|recommend\w*|suggest\w*|advice|names?|list|which|kos|harga|bahan|senarai|mengapa|cadang\w*)\b|成本|价格|價格|用料|产量|產量|原因|建议|建議|名称|名稱|哪些|清单|清單|详情|詳情/iu.test(prompt))return null;
 if(/\b(?:inactive|non[- ]active|not active|not archived|not draft|tidak aktif|since|between|last year|last month|outlet|v\d+(?:\.\d+)*)\b|\b20\d{2}\b|未启用|未啟用|非[启啟]用|门店|門店|上月|去年/iu.test(prompt))return null;
 const statuses=Object.keys(lifecycleLabels).filter(key=>lifecycleLabels[key].match.test(prompt));
 return statuses.length===1?statuses[0]:null;
}
function formatRecipeComparison(e,prompt=''){
 const status=requestedRecipeComparison(prompt),scope=e.requested_scope;
 if(!status||!e.aggregate_complete||scope?.mode!=='summary'||scope.page!==1||!['versions','current_products'].includes(scope.measure)||
  scope.status&&norm(scope.status)!==status||scope.code||scope.name||scope.product_name)return null;
 const counts=[e.current_products,e.recorded_versions];
 if(!counts.every(c=>Number.isSafeInteger(c?.total)&&c.total>=0&&c.by_status&&Object.hasOwn(c.by_status,status)&&
  Object.values(c.by_status).every(v=>Number.isSafeInteger(v)&&v>=0)&&Object.values(c.by_status).reduce((sum,n)=>sum+n,0)===c.total))return null;
 const [products,versions]=counts,productCount=products.by_status[status],versionCount=versions.by_status[status];
 if(products.total>versions.total)return null;
 const label=lifecycleLabels[status];
 if(/\p{Script=Han}/u.test(prompt)){
  const traditional=/標準|產品|總數|數量|當前|啟用|歸檔|食譜|對比|比較/u.test(prompt);
  return traditional?'目前 '+products.total+' 項產品配方標準中，'+productCount+' 項為'+label.hant+'；'+versions.total+' 個已儲存配方版本中，'+versionCount+' 個為'+label.hant+'。':
   '目前 '+products.total+' 项产品配方标准中，'+productCount+' 项为'+label.zh+'；'+versions.total+' 个已保存配方版本中，'+versionCount+' 个为'+label.zh+'。';
 }
 if(/\b(?:berapa|resipi|kilang|semasa|piawai(?:an)?|jumlah|versi)\b/iu.test(prompt))return 'Daripada '+products.total+' standard resipi produk semasa, '+productCount+' berstatus '+label.ms+'. Daripada '+versions.total+' versi resipi tersimpan, '+versionCount+' berstatus '+label.ms+'.';
 const line=(n,total,noun)=>n+' of '+total+' '+noun+(total===1?'':'s')+(n===1?' is ':' are ')+(status==='draft'?'marked draft':label.en)+'.';
 return line(productCount,products.total,'current product recipe standard')+' '+line(versionCount,versions.total,'saved recipe version');
}
async function load(caller,a,signal){
 const versions=a.measure==='versions';
 const plainVersions=versions&&(a.mode==='list'||a.name||a.code||a.product_name);
 const versionsPage=async()=>{
  let query=caller.from('factory_product_recipes').select(fields.join(','),{count:'exact',head:a.mode==='summary'});
  for(const [key,column] of Object.entries(columns))if(a[key])query=exactName(query,column,a[key].trim());
  const result=await countedRows(query.order('id'),a,fields,signal);
  return {...result,returned_count:result.rows.length,complete:false};
 };
 if(plainVersions)return versionsPage();
 const {data,count,error}=await caller.from('factory_product_recipes').select(select,{count:'exact'}).order('id').limit(1000).abortSignal(signal);
 if(error||!Array.isArray(data)||!Number.isSafeInteger(count)||count<0)
  throw new AssistantError(error?.code==='42501'?'business_read_denied':'business_read_unavailable',error?.code==='42501'?403:503);
 if(count>data.length){
  if(versions)return versionsPage();
  throw new AssistantError('business_result_limit',413);
 }
 if(count!==data.length||new Set(data.map(r=>r.id)).size!==count)throw new AssistantError('business_read_unavailable',503);
 let groups=groupProductRecipes(data.map(row=>({...row,...recipeProductIdentity(row)})));
 if(a.product_name)groups=groups.filter(g=>[g.productName,g.productNameCn].some(n=>norm(n)===norm(a.product_name)));
 const allVersions=groups.flatMap(g=>g.versions);
 const standards=groups.map(g=>({...pick(g.versions[0],fields),product_name:g.productName,version_count:g.versions.length}));
 const population=versions?allVersions:standards;
 const matching=a.status?population.filter(row=>norm(row.status)===norm(a.status)):population;
 const offset=(a.page-1)*20;
 const rows=a.mode==='summary'?[]:matching.slice(offset,offset+20);
 return {rows,returned_count:rows.length,complete:false,page:a.page,page_size:20,total_matching:matching.length,aggregate_complete:true,
  truncated:a.mode!=='summary'&&matching.length>offset+20,current_products:statusCounts(standards),
  recorded_versions:statusCounts(allVersions),
  count_scope:'Status breakdowns are before the selected status filter. Each product contributes its latest version to current_products. All its recorded versions contribute to recorded_versions.'};
}

export const recipeVersionRead=readContract({
 id:'read_factory_recipe_versions',module_id:'factory_product_recipes',version:3,label:'Factory recipe versions and current product standards',
 queryIntent:prompt=>requestedRecipeComparison(prompt)?'current_standards_and_recorded_versions':null,
 format:formatRecipeComparison,
 source:'/factory/master-data/product-recipes',permission:'factory_product_recipes.view',scope:'Factory Product Recipes / BOM register under current human permission and row access.',
 description:'For the number of products with active or draft current standards, or comparison to saved recipe versions, use measure=current_products, mode=summary. One scoped snapshot returns both current product counts and recorded version counts, including a status breakdown for each. Use measure=versions to read version records by exact code, name, recorded product name or status. Yield has its recorded unit.',
 discoveryPhrases:['Factory product recipes','Factory recipe versions','current product standards','current recipe standards','product recipe versions','配方版本','配方标准','标准食谱','标准食譜'],
 properties:{page,mode:{type:'string',enum:['list','summary']},measure:{type:'string',enum:['versions','current_products']},name:filter,code:filter,product_name:filter,status:filter},
 normalizeArguments:a=>a&&typeof a==='object'&&!Array.isArray(a)?{page:1,mode:'list',measure:'versions',name:null,code:null,product_name:null,status:null,...a}:a,
 check(a){if(a.mode==='summary'&&a.page!==1)invalidArgument('unsupported_value','page');
  for(const k of Object.keys(columns))if(a[k]!==null&&!a[k].trim())invalidArgument('nonblank_text_or_null',k);
  if(a.measure==='current_products'&&(a.name||a.code))invalidArgument('unsupported_value',a.name?'name':'code');
 },
 load,project:data=>data,pageableModes:['list'],
 interface:{authority:'factory_product_recipes',fields:[...fields,'version_count','current_products','recorded_versions'],
  queryKinds:['count','summary','list','filter','group'],aggregates:'complete_filtered_scope',
  pagination:'20 rows per page. Grouped projections require a complete snapshot of at most 1,000 visible version headers. Version register pages and counts can use the full filtered register.',
  semantics:{entities:['Factory product recipe','current product standard','recipe version'],time:'Current register; a version status is distinct from the status of a product’s latest version.',
   relationships:['One product group per family, otherwise per SKU. Unlinked legacy records stay separate. Order versions naturally by version, update time and stable identity before filtering the current status.'],
   metrics:{entry_count:{field:'total_matching',unit:'selected records',definition:'Matching records in the requested measure and status.'},
    product_count:{field:'current_products.total',unit:'products',definition:'Distinct products with a recipe; active means the latest standard is active.'},
    version_count:{field:'recorded_versions.total',unit:'recipe versions',definition:'All saved recipe versions, including superseded versions and versions with a different status than their current product standard.'}}}},
});
