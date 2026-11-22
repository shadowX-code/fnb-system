import {boundedPeriod,countedRows,date,invalidArgument,month,page,readContract,uuid} from './readContract.js';
import {exactName} from './entityResolution.js';

// A domain supplies the fixed table or table-valued RPC, fields, date and name-column mapping.
// The count and pages use exactly the same scoped query. No submitted value
// can choose the source table, requested columns or PostgREST operator.
export function recordPageRead({id,module_id,label,permission,source,scope,table,rpc,rpcArguments,fields,filters={},dateField,dateWindow=false,order=[{key:'id'}],calendarMonth=false,outletScope=false,description}){
 const optionalName={type:'string',nullable:true,maxLength:120};
 const properties=Object.fromEntries(Object.keys(filters).map(key=>[key,optionalName]));
 if(dateField)Object.assign(properties,{from:{...date,nullable:true},to:{...date,nullable:true}});
 const defaults=Object.fromEntries(Object.keys(properties).map(key=>[key,null]));
 return readContract({id,module_id,label,source,scope,permission,outletScope,version:2,
  description:'Count or list '+label+'. '+description,
  properties:{page,mode:{type:'string',enum:['list','summary']},...(outletScope?{outlet_id:uuid}:{}),...(calendarMonth?{month}:{}),...(dateWindow?{from:date,to:date}:{}),...properties},
  normalizeArguments:args=>args&&typeof args==='object'&&!Array.isArray(args)?{mode:'list',page:1,...defaults,...args}:args,
  check(args){
   if(dateWindow)boundedPeriod(args);
   if(args.mode==='summary'&&args.page!==1)invalidArgument('unsupported_value','page');
   if(dateField&&(!!args.from!==!!args.to||args.from&&args.from>args.to))invalidArgument('invalid_date_range','from');
   for(const key of Object.keys(filters))if(args[key]!==null&&!args[key].trim())invalidArgument('nonblank_text_or_null',key);
  },
  pageableModes:['list'],rpc,
  async load(caller,args,signal){
   let query;
   if(rpc){
    query=caller.rpc(rpc,rpcArguments(args),{count:'exact'}).select(fields.join(','));
    if(args.mode==='summary')query=query.limit(1);
   }else query=caller.from(table).select(fields.join(','),{count:'exact',head:args.mode==='summary'});
   if(outletScope)query=query.eq('outlet_id',args.outlet_id);
   if(calendarMonth)query=query.eq('year',Number(args.month.slice(0,4))).eq('month',Number(args.month.slice(5,7)));
   if(dateField&&args.from)query=query.gte(dateField,args.from).lte(dateField,args.to);
   for(const [name,column] of Object.entries(filters))if(args[name])query=exactName(query,column,args[name].trim());
   for(const {key,descending} of order)query=query.order(key,{ascending:!descending});
   const result=await countedRows(query,args,fields,signal);
   return {...result,returned_count:result.rows.length,complete:false};
  },
  project:data=>data,
  interface:{authority:rpc??table,fields,queryKinds:['list','count','summary','filter'],aggregates:'complete_filtered_scope',
   pagination:'Exact count of matching records; stable pages of 20. Row quantities and amounts are not aggregate totals.',
   semantics:{entities:[label,...(outletScope?['outlet']:[])],time:calendarMonth?'Selected source calendar month.':
    dateWindow?'Requested source period in the canonical local calendar.':dateField?'Optional inclusive date range on the recorded '+dateField.replaceAll('_',' ')+'.':'Current register as recorded.',
    relationships:[scope],metrics:{entry_count:{field:'total_matching',unit:'records',definition:'All matching '+label+' records before paging.'}}}},
 });
}
