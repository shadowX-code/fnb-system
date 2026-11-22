import {countedRows,invalidArgument,page,readContract} from './readContract.js';
import {exactName} from './entityResolution.js';

// Owners supply a fixed table, public directory fields and name column. Request
// arguments can only narrow the existing human-visible records.
export function directoryRead({id,module_id,label,table,fields,select=fields.join(','),name='name',code,activeFlag,statusValues,permission,source,scope}){
 const states=activeFlag?['active','inactive']:statusValues;
 const status=states?{status:{type:'string',enum:['all',...states]}}:{};
 return readContract({
  id,module_id,label,permission,source,scope,version:2,
  description:'Count or list '+label+' in the authorized directory. Supply an exact name'+(code?' or business code':'')+' if desired.'+
   (activeFlag?' Active and inactive filter the same activity flag used by the Admin directory.':'')+
   ' Counts represent directory entries. A count is independent of the size of the page.',
  properties:{page,mode:{type:'string',enum:['list','summary']},name:{type:'string',nullable:true,maxLength:120},
   ...(code?{code:{type:'string',nullable:true,maxLength:120}}:{}),...status},
  normalizeArguments:args=>args&&typeof args==='object'&&!Array.isArray(args)?{mode:'list',page:1,name:null,...(states?{status:'all'}:{}),...(code?{code:null}:{}),...args}:args,
  pageableModes:['list'],
  check(args){
   if(args.mode==='summary'&&args.page!==1)invalidArgument('unsupported_value','page');
   if(args.name!==null&&!args.name.trim())invalidArgument('nonblank_text_or_null','name');
   if(code&&args.code!==null&&!args.code.trim())invalidArgument('nonblank_text_or_null','code');
  },
  async load(caller,args,signal){
   let query=caller.from(table).select(select,{count:'exact',head:args.mode==='summary'});
   if(activeFlag&&args.status!=='all')query=query.eq(activeFlag,args.status==='active');
   if(statusValues&&args.status!=='all')query=query.eq('status',args.status);
   if(args.name)query=exactName(query,name,args.name.trim());
   if(code&&args.code)query=exactName(query,code,args.code.trim());
   const result=await countedRows(query.order('id'),args,fields,signal);
   return {...result,returned_count:result.rows.length,complete:false};
  },
  project:result=>result,
  interface:{authority:table,queryKinds:['summary','count','list','filter'],fields,
   aggregates:'complete_filtered_scope',pagination:'Exact filtered directory count; pages of 20 in stable ID order.',
   semantics:{entities:[label],time:'Current directory, as of this read.',
    relationships:['Only records visible in this module under the current human account are included.'],
    metrics:{entry_count:{field:'total_matching',unit:'entries',definition:'Matching visible '+label+' entries, before pagination.'}}}},
 });
}
