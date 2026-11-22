import {countedRows,invalidArgument,month,page,readContract,uuid} from '../assistant/readContract.js';
import {purchaseRecordLabels} from './purchaseRecordLabels.js';

const fields=['id','outlet_id','year','month','supplier_id','category_id','amount','updated_at'];
const exposed=[...fields,'supplier_name','category_name'];
const labels='supplier:suppliers(name,category),category:purchase_categories(name)';

export const purchaseInputRead=readContract({
 id:'read_purchase_records',module_id:'purchase-input',version:2,label:'purchase-input monthly records',
 permission:'purchase_input.view',source:'/restaurant/purchases/input',scope:'Entered purchase rows for one authorized Restaurant outlet and calendar month.',
 discoveryPhrases:['purchase input','purchase entries','recorded purchase amounts','采购录入','采购金额','rekod pembelian'],
 description:'Count or list Restaurant Purchase Input entries for an outlet and calendar month. Use amount_desc or amount_asc to rank individual entries before paging; id preserves the existing stable row order. Use supplier and category labels when recorded. Row amounts are recorded purchases, not payments, inventory-adjusted costs or supplier totals.',
 properties:{page,outlet_id:uuid,month,mode:{type:'string',enum:['list','summary']},sort:{type:'string',enum:['id','amount_desc','amount_asc']}},
 normalizeArguments:args=>args&&typeof args==='object'&&!Array.isArray(args)?{page:1,mode:'list',sort:'id',...args}:args,
 check(args){
  if(args.mode==='summary'&&args.page!==1)invalidArgument('unsupported_value','page');
  if(args.mode==='summary'&&args.sort!=='id')invalidArgument('unsupported_value','sort');
 },
 outletScope:true,
 async load(caller,args,signal){
  const summary=args.mode==='summary';
  let query=caller.from('purchase_records').select(summary?'id':fields.join(',')+','+labels,{head:summary,count:'exact'})
   .eq('outlet_id',args.outlet_id).eq('year',Number(args.month.slice(0,4))).eq('month',Number(args.month.slice(5,7)));
  if(args.sort!=='id')query=query.order('amount',{ascending:args.sort==='amount_asc',nullsFirst:false});
  const result=await countedRows(query.order('id'),args,[...fields,'supplier','category'],signal);
  const rows=result.rows.map(({supplier,category,...row})=>({...row,...purchaseRecordLabels({supplier,category})}));
  return {...result,rows,returned_count:rows.length,complete:false};
 },
 project:data=>data,
 interface:{authority:'Restaurant Purchase Input monthly records and the Admin purchase-record display labels',
  fields:exposed,queryKinds:['count','summary','list','rank'],aggregates:'complete_filtered_scope',
  pagination:'The source count is exact; at most 20 entries per page. Ranking applies to individual recorded amounts across the requested outlet/month.',
  unsupported:['Supplier totals, payments and statutory expenses are separate measures. Unavailable labels stay blank.'],
  semantics:{entities:['monthly purchase entry','supplier','purchase category'],time:'Selected recorded year and month.',
   relationships:['A purchase row can reference a supplier and category visible under the same authorized Purchase Input read.'],
   metrics:{
    entry_count:{field:'total_matching',unit:'entries',definition:'Number of entered purchase rows at this outlet for this month.'},
    entry_amount:{field:'rows[].amount',unit:'MYR',definition:'Recorded amount on one purchase entry. This does not establish a supplier total or payment.'},
   }},
 },
});
