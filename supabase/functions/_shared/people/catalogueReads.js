import { AssistantError } from '../assistantError.js';
import { exactName } from '../assistant/entityResolution.js';
import { countedRows, page, readContract } from '../assistant/readContract.js';

// Match the Admin catalogue fields. Employee counts are owned by Employees,
// whose permission is separate from either catalogue.
function peopleCatalogue({id,module_id,label,permission,table,departmentFilter=false}) {
 const fields=['id','name',...departmentFilter?['department']:[],'description','status','updated_at'];
 const name={type:'string',maxLength:120,nullable:true};
 return readContract({id,module_id,label,permission,version:2,source:'/hr',
  scope:'Canonical shared People catalogue under current human permission and RLS.',
  discoveryPhrases:departmentFilter?['job positions','position directory','jawatan kerja','职位目录']:['HR departments','department directory','department catalogue','senarai jabatan','部门目录'],
  description:'Count or list '+label+' by exact name and optional recorded active/inactive status.'+
   (departmentFilter?' Filter by human-readable department name.':'')+' Counts describe catalogue entries and do not measure employee headcount.',
  properties:{page,mode:{type:'string',enum:['list','summary']},status:{type:'string',enum:['all','active','inactive']},
   name,...departmentFilter?{department:name}:{}},
  normalizeArguments:args=>args&&typeof args==='object'&&!Array.isArray(args)
   ?{page:1,mode:'list',status:'all',name:null,...departmentFilter?{department:null}:{},...args}:args,
  check(args){if(args.mode==='summary'&&args.page!==1)throw new AssistantError('tool_arguments_invalid',400);},
  async load(caller,args,signal){
   let query=caller.from(table).select(fields.join(','),{count:'exact',head:args.mode==='summary'});
   if(args.status!=='all')query=query.eq('status',args.status);
   if(args.name)query=exactName(query,'name',args.name.trim());
   if(args.department)query=exactName(query,'department',args.department.trim());
   return countedRows(query.order('name').order('id'),args,fields,signal);
  },
  project:data=>data,
  interface:{queryKinds:['summary','count','list','filter'],authority:table+' under human RLS',fields,
   aggregates:'complete_filtered_scope',pagination:'Exact filtered catalogue count; list pages of 20.',
   unsupported:['Employee headcount, roster usage, compensation and historical comparisons are separate authorities.']},
 });
}

export const peopleCatalogueReads=[
 peopleCatalogue({id:'read_departments',module_id:'departments',label:'HR departments',permission:'departments.view',table:'departments'}),
 peopleCatalogue({id:'read_job_positions',module_id:'job-positions',label:'HR job positions',permission:'job_positions.view',table:'job_positions',departmentFilter:true}),
];
