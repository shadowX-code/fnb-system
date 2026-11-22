import {readContract,uuid,pick} from '../assistant/readContract.js';
import {employeeDirectoryArguments,employeeDirectoryFields,readEmployeeDirectory} from './employeeDirectory.js';
import {AssistantError} from '../assistantError.js';
import {normalizedEntity} from '../assistant/entityResolution.js';

async function readDirectory(caller,args,signal){
 const read=async values=>{
  const {data,error}=await readEmployeeDirectory(caller,values).abortSignal(signal);
  if(error||!data)throw new AssistantError(error?.code==='42501'?'business_read_denied':'business_read_unavailable',error?.code==='42501'?403:503);
  return data;
 };
 if(args.mode!=='detail'||!args.query)return read(args);
 const listed=await read({...args,mode:'list',page:1,employee_id:null});
 if(!Array.isArray(listed.rows))throw new AssistantError('business_read_unavailable',503);
 if(listed.has_more)throw new AssistantError('entity_scope_required',409);
 const employee=normalizedEntity(listed.rows,args.query,['full_name','employee_code']);
 if(!employee)throw new AssistantError('entity_unresolved',409);
 return read({...args,query:'',employee_id:employee.id});
}
export const employeeDirectoryRead=readContract({
 id:'read_employee_directory',policyGroup:'employees',version:2,normalizeArguments:a=>a&&typeof a==='object'&&!Array.isArray(a)?{mode:'summary',employee_id:null,status:'all',legal_entity_id:null,workplace:null,query:'',page:1,outlet_id:null,employment_type:null,...a}:a,module_id:'employees',label:'Employee headcount and directory',permission:'employees.view',
 source:'/people/employees',scope:'Current human RLS-visible Employees; optional company/workplace/status/name filters; unique employee IDs, not assignment rows',
 discoveryPhrases:['HR Employees','Employee headcount','Employees scope','Employee directory'],
 scopeTextArguments(args,prompt){
  if(args?.mode!=='summary'||!['active','inactive','resigned','terminated'].includes(args.status))return args;
  // Bind an explicit unfiltered headcount to its clause, not a neighbouring status filter.
  const clauses=prompt.split(/[,;.!?]|\band\s+(?=(?:what|which|how|who)\b)/iu);
  const unfiltered=/^\s*(?:how many (?:authorized )?employees(?: are there)?|(?:(?:what is|give me|show me)\s+)?(?:the\s+)?(?:total|overall)\s+(?:authorized\s+)?(?:employees?\s+headcount|(?:number|count)\s+of\s+employees))\s*$/iu.test(clauses[0]);
  const statusClauses=clauses.filter(clause=>/\b(?:active|inactive|resigned|terminated)\b/iu.test(clause));
  const differentResource=clause=>/\b(?:factory|finished goods|raw materials?|sku|inventory|stock)\b/iu.test(clause)&&
   !/\b(?:employees?|staff|workforce|headcount)\b/iu.test(clause);
  return unfiltered&&statusClauses.every(differentResource)?{...args,status:'all'}:args;
 },
 description:'Use summary for unique employee headcount, status and employment-type breakdowns; no employee ID or company ID needed. Use list to search by name/code, or detail with the exact employee name/code in query. Null filters mean all records already visible to the human. Inactive means resigned or terminated, not disabled login.',
 properties:{outlet_id:{...uuid,nullable:true,description:'Optional filter. Null means all employee rows already visible to the human. Never required for headcount.'},employment_type:{type:'string',maxLength:60,nullable:true,description:'Optional exact type filter. Null means all types; summary returns the breakdown.'},mode:{type:'string',enum:['summary','list','detail']},employee_id:{...uuid,nullable:true},status:{type:'string',enum:['all','active','inactive','resigned','terminated']},legal_entity_id:{...uuid,nullable:true},workplace:{type:'string',maxLength:120,nullable:true},query:{type:'string',maxLength:80},page:{type:'number',minimum:1,maximum:1000}},
 rpc:'employee_directory_query',arguments:employeeDirectoryArguments,load:readDirectory,
 interface:{semantics:{
  entities:['employee','employment status','employment type'],time:'Current employee directory and current assignments.',
  relationships:['An employee may have multiple assignments. Count the employee once within the filtered scope.'],
  metrics:{
   headcount:{field:'summary.total',unit:'employees',definition:'Distinct visible employee identities after filters.'},
   employment_status:{field:'summary',unit:'employees',definition:'Active, resigned, terminated and other. Inactive combines resigned and terminated.'},
   employment_type:{field:'employment_types',unit:'employees',definition:'Counts by recorded employment type, independent of employment status and login access.'},
  }},queryKinds:['summary','count','list','search','detail','filter','group'],authority:'employee_directory_query',fields:employeeDirectoryFields,sensitive:'No contacts, auth IDs, identity documents, compensation, bank data or disciplinary records.',aggregates:'complete_filtered_scope',pagination:'20 rows per page; summary and total_count span all matching authorized records.',unavailable:'Denied detail returns no evidence; empty authorized summary is zero. Unknown employment statuses remain other.'},
 project:d=>({employment_types:d.employment_types,summary:pick(d.summary,['total','active','inactive','resigned','terminated','other']),rows:d.rows.map(r=>pick(r,employeeDirectoryFields)),total_count:d.total_count,page:d.page,page_size:d.page_size,truncated:d.has_more,source_as_of:d.as_of,source_version:d.schema_version,aggregate_complete:d.aggregate_complete,status_definition:d.status_definition})
});
