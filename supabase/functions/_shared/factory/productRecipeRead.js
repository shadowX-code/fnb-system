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
