import {parLevelRead} from './parLevelRead.js';
import {groupRead,orderRead,recipeCatalogueRead,salesInputRead,wasteRead} from './operationalRecordReads.js';
import {stockCheckRead} from './stockCheckRead.js';
import {purchaseInputRead} from './purchaseInputRead.js';
import {directoryRead} from '../assistant/directoryRead.js';
import {inventoryStockEvidenceRead} from './inventoryStockEvidenceRead.js';
import {operatingExpenseRead} from './operatingExpenseRead.js';
import {countedRows,invalidArgument,readContract,page,uuid,rowsEvidence} from '../assistant/readContract.js';
import {exactName,normalizedEntity,sourceRows} from '../assistant/entityResolution.js';
import {AssistantError} from '../assistantError.js';
import {inventoryMasterRead} from './inventoryMasterRead.js';
import {inventoryMovementRead} from './inventoryMovementRead.js';

const supplierFields=['id','name','category','status','is_active','updated_at'];
async function loadSuppliers(caller,args,signal){
 const query=()=>caller.from('suppliers').select(supplierFields.join(','));
 if(!args.query){
  const source=caller.from('suppliers').select(supplierFields.join(','),{count:'exact',head:args.mode==='summary'});
  return countedRows(source.order('id'),args,supplierFields,signal);
 }
 const exact=await sourceRows(exactName(query(),'name',args.query).limit(2),signal);
 if(exact.length>1)throw new AssistantError('entity_ambiguous',409);
 if(exact.length===1)return {rows:exact,match_status:'matched'};
 const candidates=await sourceRows(query().order('id').limit(201),signal);
 if(candidates.length>200)throw new AssistantError('entity_scope_required',409);
 const match=normalizedEntity(candidates,args.query,['name']);
 return {rows:match?[match]:[],match_status:match?'matched':'not_found'};
}
// Fixed projections of the owning Admin service queries, under human RLS; no privileged client.
export const restaurantCatalogueReads=[
 readContract({id:'read_outlet_tax_policy',module_id:'tax-settings',label:'Outlet tax configuration versions',permission:'tax_settings.view',source:'/sales-purchase',scope:'Authorized outlet; paged20 effective-dated configuration records',description:'Read configured tax rates and effective periods. These are platform settings, not legal/tax advice. No rate changes or recalculation.',properties:{page,outlet_id:uuid},outletScope:true,query:(caller,a)=>caller.from('outlet_tax_configs').select('id,outlet_id,tax_type,enabled,rate,effective_from,effective_until,updated_at').eq('outlet_id',a.outlet_id).order('id').range((a.page-1)*20,a.page*20),project:d=>rowsEvidence(d,['id','outlet_id','tax_type','enabled','rate','effective_from','effective_until','updated_at'])}),
 inventoryMovementRead,
 operatingExpenseRead,
 purchaseInputRead,
 salesInputRead,
 inventoryStockEvidenceRead,
 wasteRead,
 stockCheckRead,
 orderRead,
 directoryRead({id:'read_outlet_directory',module_id:'outlets',label:'outlet directory',permission:'outlets.view',
  source:'/restaurant/operations/outlets',scope:'Current human outlet scope and RLS.',table:'outlets',activeFlag:'is_active',
  fields:['id','name','code','status','is_active','updated_at']}),
 directoryRead({id:'read_sales_channels',module_id:'sales-channels',label:'sales channels',permission:'sales_channels.view',
  source:'/restaurant/sales/channels',scope:'Canonical shared catalogue under human permission and RLS.',table:'sales_channels',activeFlag:'is_active',
  fields:['id','name','type','status','is_active','updated_at']}),
 directoryRead({id:'read_purchase_categories',module_id:'purchase-categories',label:'purchase categories',permission:'purchase_categories.view',
  source:'/restaurant/purchases/categories',scope:'Canonical shared catalogue under human permission and RLS.',table:'purchase_categories',activeFlag:'is_active',
  fields:['id','name','status','is_active','updated_at']}),
 readContract({id:'read_supplier_directory',module_id:'suppliers',label:'supplier directory',permission:'suppliers.view',source:'/restaurant/purchases/suppliers',scope:'Canonical shared catalogue; human permission and RLS; paged20',description:'Count or list visible Restaurant supplier directory entries. Use a null query for total/list, or an exact supplier name for detail on page 1. Directory entries do not imply active supply or purchase volume.',properties:{page,query:{type:'string',nullable:true,maxLength:120},mode:{type:'string',enum:['list','summary']}},
  version:2,normalizeArguments:a=>a&&typeof a==='object'&&!Array.isArray(a)?{mode:'list',page:1,query:null,...a}:a,
  check(a){if(a.mode==='summary'&&(a.query||a.page!==1))invalidArgument('unfiltered_summary_required');},
  interface:{queryKinds:['count','summary','list','search','detail'],authority:'Restaurant Suppliers canonical RLS catalogue',fields:supplierFields,
   aggregates:'complete_filtered_scope',pagination:'Unfiltered summary and pages expose the exact authorized directory count. A name lookup establishes only its own match.',
   semantics:{entities:['restaurant supplier','supplier directory'],time:'Current Restaurant supplier directory.',relationships:['Factory suppliers belong to a separate catalogue.'],
    metrics:{entry_count:{field:'total_matching',unit:'suppliers',definition:'Visible Restaurant supplier directory records. Only supplied on directory summary and pages.'}}}},
  load:loadSuppliers,project:({rows,...metadata})=>({...rowsEvidence(rows,supplierFields),...metadata})}),
 inventoryMasterRead,
 parLevelRead,
 groupRead,
 recipeCatalogueRead,
];
