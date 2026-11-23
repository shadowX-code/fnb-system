import {countedRows,invalidArgument,month,readContract} from '../assistant/readContract.js';
import {formatSupplierPurchases,formatSupplierRanking,loadSupplierPurchases,purchaseAnswerAmounts,purchaseOutlet,purchaseOutletFields,purchasePageSize,supplierFilter,supplierPurchaseIntent,supplierPurchaseMetrics,validatePurchaseScope} from './supplierPurchases.js';
import {purchaseRecordLabels} from './purchaseRecordLabels.js';

const fields=['id','outlet_id','year','month','supplier_id','category_id','amount','updated_at'];
const exposed=[...fields,'supplier_name','category_name'];
const labels='supplier:suppliers(name,category),category:purchase_categories(name)';

export const purchaseInputRead=readContract({
 id:'read_purchase_records',module_id:'purchase-input',version:3,label:'Restaurant monthly purchase entries and supplier totals',
 permission:'purchase_input.view',source:'/restaurant/purchases/input',scope:'Entered purchase rows for one authorized Restaurant outlet and calendar month.',
 discoveryPhrases:['purchase input','purchase entries','recorded purchase amounts','采购录入','采购金额','rekod pembelian','本月供应商采购额','本月供應商採購額','pembelian pembekal bulan ini'],
 answerAmounts:purchaseAnswerAmounts,format:formatSupplierPurchases,formatFollowUpAnswer:formatSupplierRanking,fixedPageSize:purchasePageSize,
 queryIntent:prompt=>supplierPurchaseIntent(prompt)==='supplier_month'?'monthly_supplier_purchases':null,
 narrowerOffer:{en:'I can check recorded supplier purchases for one outlet and month. Which month would you like?',zh:'我可以按门店查看一个月已记录的供应商采购额。您想查哪个月？',ms:'Saya boleh semak pembelian pembekal yang direkodkan untuk satu cawangan dan satu bulan. Bulan mana yang anda mahu semak?'},
 description:'Count or list Restaurant Purchase Input entries for an outlet and calendar month. Use amount_desc or amount_asc to rank individual entries before paging; id preserves the existing stable row order. Use supplier and category labels when recorded. For the total purchases per supplier or all suppliers for one month, use supplier_totals with optional recorded supplier_name. Amounts are MYR; these are recorded purchases, not payments or inventory-adjusted costs.',
 properties:{...supplierFilter,...purchaseOutletFields,month,mode:{type:'string',enum:['list','summary','supplier_totals']},sort:{type:'string',enum:['id','amount_desc','amount_asc']}},
 normalizeArguments:args=>args&&typeof args==='object'&&!Array.isArray(args)?{page:1,mode:'list',sort:'id',supplier_name:null,outlet_id:null,outlet_name:null,...args}:args,
 check(args){
  validatePurchaseScope(args);
  if(args.mode!=='supplier_totals'&&args.supplier_name)invalidArgument('unsupported_value','supplier_name');
  if(args.mode==='summary'&&args.page!==1)invalidArgument('unsupported_value','page');
  if(args.mode!=='list'&&args.sort!=='id')invalidArgument('unsupported_value','sort');
 },
 async load(caller,args,signal){
  const outlet=await purchaseOutlet(caller,args,signal);
  if(args.mode==='supplier_totals')return loadSupplierPurchases(caller,args,outlet,false,signal);
  const summary=args.mode==='summary';
  let query=caller.from('purchase_records').select(summary?'id':fields.join(',')+','+labels,{head:summary,count:'exact'})
   .eq('outlet_id',outlet.id).eq('year',Number(args.month.slice(0,4))).eq('month',Number(args.month.slice(5,7)));
  if(args.sort!=='id')query=query.order('amount',{ascending:args.sort==='amount_asc',nullsFirst:false});
  const result=await countedRows(query.order('id'),args,[...fields,'supplier','category'],signal);
  const rows=result.rows.map(({supplier,category,...row})=>({...row,...purchaseRecordLabels({supplier,category})}));
  return {...result,outlet,rows,entry_count:result.total_matching,returned_count:rows.length,complete:false};
 },
 project:data=>data,
 interface:{authority:'Restaurant Purchase Input monthly records and the Admin purchase-record display labels',
  fields:[...exposed,'recorded_total','monthly_totals','missing_months','entry_count'],queryKinds:['count','summary','list','rank','group','filter'],aggregates:'complete_filtered_scope',
  pagination:'The source count is exact; at most 20 entries per page. Entry ranking applies across the requested month. Supplier mode returns ten groups per page and exact totals before pagination from a complete snapshot of up to 1,000 entries.',
  unsupported:['Payments, statutory expenses and unentered purchases are outside the source. Unavailable labels stay blank.'],
  semantics:{entities:['monthly purchase entry','supplier','purchase category'],time:'Selected recorded year and month.',
   relationships:['A purchase row can reference a supplier and category visible under the same authorized Purchase Input read.'],
   metrics:{...supplierPurchaseMetrics,
    entry_count:{field:'entry_count',unit:'entries',definition:'Number of recorded purchase entries in the selected period and supplier scope.'},
    entry_amount:{field:'rows[].amount',unit:'MYR',definition:'Recorded amount on one purchase entry. This does not establish a supplier total or payment.'},
   }},
 },
});
