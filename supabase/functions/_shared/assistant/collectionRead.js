import {AssistantError} from '../assistantError.js';
import {invalidArgument,page,pick,readContract} from './readContract.js';

const normalize=value=>String(value??'').normalize('NFKC').trim().toLowerCase();
const pageSizes=[20,10,5,1];
const maxOffset=page.maximum*20;

// The owner has already authorized and projected this page. A smaller page
// starts at the same record and never re-runs the underlying RPC.
function fitCollectionPage(evidence,fits){
 const start=(evidence.page-1)*evidence.page_size;
 for(const size of pageSizes.filter(size=>size<evidence.page_size&&evidence.requested_scope.mode==='list')){
  const currentPage=start/size+1;
  const rows=evidence.rows.slice(0,size);
  const truncated=start+rows.length<evidence.total_matching;
  const smaller={...evidence,page:currentPage,page_size:size,rows,returned_count:rows.length,truncated,
   pagination_adjustment:'Same starting record, smaller page to fit the evidence limit.',
   completeness:{...evidence.completeness,page:currentPage,has_more:truncated}};
  if(fits(smaller))return smaller;
 }
 const reason=evidence.rows.length&&fits({...evidence,rows:[]})?'single_record_exceeds_evidence_limit':'metadata_exceeds_evidence_limit';
 throw new AssistantError('business_result_limit',413,{reason});
}

// For RPCs that return an entire authorized collection as a JSON array. Owners
// select that collection before paging and explicitly allow every exposed field.
// Never use this with a source-side LIMIT, sampled rows or a paged RPC response.
export function collectionRead({records,fields,filters={},sortBy,metric,decorate,...owner}){
 const filterKeys=Object.keys(filters);
 const defaults=Object.fromEntries(filterKeys.map(key=>[key,null]));
 const filterSchema=Object.fromEntries(filterKeys.map(key=>[key,{type:'string',nullable:true,maxLength:120,
  description:'Optional exact '+key.replaceAll('_',' ')+'. Null includes all values.'}]));
 return readContract({...owner,version:2,pageableModes:['list'],fitEvidence:fitCollectionPage,
  description:owner.description+' Count or page all matching records in this scope. Use summary for a count.',
  properties:{...owner.properties,mode:{type:'string',enum:['summary','list']},page:{...page,maximum:maxOffset},
   page_size:{type:'number',enum:pageSizes,description:'Use 20 normally; for the next page preserve the page size in the returned evidence.'},...filterSchema},
  normalizeArguments:args=>args&&typeof args==='object'&&!Array.isArray(args)?{mode:'list',page:1,page_size:20,...defaults,...(owner.normalizeArguments?owner.normalizeArguments(args):args)}:args,
  check(args){
   owner.check?.(args);
   if(args.mode==='summary'&&args.page!==1)invalidArgument('unsupported_value','page');
   if((args.page-1)*args.page_size>=maxOffset)invalidArgument('unsupported_value','page');
   for(const key of filterKeys)if(args[key]!==null&&!normalize(args[key]))invalidArgument('nonblank_text_or_null',key);
  },
  interface:{...owner.interface,authority:owner.rpc,queryKinds:['count','summary','list',...(filterKeys.length?['filter']:[])],
   fields,aggregates:'complete_filtered_scope',pagination:'Complete matching count. Stable pages of 20, 10, 5 or 1. Use the returned page coordinates for continuation. The first 2,000 matching records are addressable.',
   semantics:{entities:[metric.unit],time:metric.time,relationships:[owner.scope],
    metrics:{record_count:{field:'total_matching',unit:metric.unit,definition:metric.definition}}}},
  project(data,args){
   const rows=records(data,args);
   if(!Array.isArray(rows))throw new AssistantError('business_read_unavailable',503);
   const matches=rows.filter(row=>filterKeys.every(key=>args[key]===null||
    filters[key].some(field=>row[field]!=null&&normalize(row[field])===normalize(args[key]))));
   const size=args.page_size??20;
   const offset=(args.page-1)*size;
   let result=[];
   if(args.mode==='list'){
    matches.sort((left,right)=>{
     for(const {key,descending} of sortBy){
      const a=String(left[key]??''),b=String(right[key]??'');
      if(a!==b)return (a<b?-1:1)*(descending?-1:1);
     }
     return 0;
    });
    result=matches.slice(offset,offset+size).map(row=>pick(row,fields));
   }
   return {rows:result,page:args.page,page_size:size,returned_count:result.length,total_matching:matches.length,
    aggregate_complete:true,truncated:args.mode==='list'&&matches.length>offset+size,...decorate?.(data,args)};
  },
 });
}
