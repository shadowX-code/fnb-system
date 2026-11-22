import {readContract,uuid,pick} from '../assistant/readContract.js';
import {employeeDirectoryArguments,employeeDirectoryFields,readEmployeeDirectory} from './employeeDirectory.js';
import {AssistantError} from '../assistantError.js';
import {normalizedEntity} from '../assistant/entityResolution.js';

const employeeSubject=/\b(?:employees?|staff|workforce|headcount|pekerja|kakitangan|staf)\b|员工|員工|雇员|僱員|职员|職員/iu;
const headcount=/\b(?:headcount|total|overall|number of|count of|jumlah|keseluruhan|semua)\b|总数|總數|总人数|總人數|一共|总共|總共|全部|所有|^\s*how many (?:authorized )?(?:employees?|staff)(?: are there| do we have)?\s*$|^\s*berapa(?:kah)? (?:pekerja|kakitangan)\s*$|^\s*(?:有)?多少(?:名|位|个|個)?[員员]工\s*$/iu;
const statusTerm=/\b(?:active|inactive|employed|resigned|terminated|left|aktif|berhenti|ditamatkan|diberhentikan)\b|在[职職]|[离離][职職]|[辞辭][职職]|解[雇僱]|受[雇僱]|[现現][职職]/iu;
const statusQualifier=/^(?:\s*(?:only|just|include|including|exclude|excluding|hanya|sahaja|仅限|只算|只看|仅|只|不含|排除)\s*)?(?:active|inactive|resigned|terminated|(?:tidak )?aktif|berhenti|ditamatkan|diberhentikan|在[职職]|[离離][职職])(?:\s+(?:only|ones|sahaja)|的)?\s*$/iu;

async function authorizedDirectoryData(caller,values,signal){
 const {data,error}=await readEmployeeDirectory(caller,values).abortSignal(signal);
 if(error||!data)throw new AssistantError(error?.code==='42501'?'business_read_denied':'business_read_unavailable',error?.code==='42501'?403:503);
 return data;
}
export async function resolveDirectoryEmployee(caller,args,signal){
 const listed=await authorizedDirectoryData(caller,{...args,mode:'list',page:1,employee_id:null},signal);
 if(!Array.isArray(listed.rows)||typeof listed.has_more!=='boolean')throw new AssistantError('business_read_unavailable',503);
 if(listed.has_more)throw new AssistantError('entity_scope_required',409);
 const employee=normalizedEntity(listed.rows,args.query,['full_name','employee_code']);
 if(!employee)throw new AssistantError('entity_unresolved',409);
 return employee;
}
async function readDirectory(caller,args,signal){
 if(args.mode!=='detail'||!args.query)return authorizedDirectoryData(caller,args,signal);
 const employee=await resolveDirectoryEmployee(caller,args,signal);
 if(args.employee_id&&args.employee_id!==employee.id)throw new AssistantError('entity_ambiguous',409);
 return authorizedDirectoryData(caller,{...args,query:'',employee_id:employee.id},signal);
}
export const employeeDirectoryRead=readContract({
 id:'read_employee_directory',policyGroup:'employees',version:2,normalizeArguments:a=>a&&typeof a==='object'&&!Array.isArray(a)?{mode:'summary',employee_id:null,status:'all',legal_entity_id:null,workplace:null,query:'',page:1,outlet_id:null,employment_type:null,...a}:a,module_id:'employees',label:'Employee headcount and directory',permission:'employees.view',
 source:'/people/employees',scope:'Current human RLS-visible Employees; optional company/workplace/status/name filters; unique employee IDs, not assignment rows',
 discoveryPhrases:['HR Employees','Employee headcount','Employees scope','Employee directory'],
 pageableModes:['list'],
 scopeTextArguments(args,prompt){
  if(args?.mode!=='summary'||!['active','inactive','resigned','terminated'].includes(args.status))return args;
  // Correct an invented employment-status filter only for an explicit overall
  // employee count. Other domains use different meanings of “active”.
  const clauses=prompt.split(/[,，;；.!?。？！]|\b(?:and|dan)\s+(?=(?:what|which|how|who|berapa|apakah)\b)|另外|以及|并且|並且/iu);
  const own=clauses.filter(clause=>employeeSubject.test(clause));
  const total=own.some(clause=>headcount.test(clause)&&!statusTerm.test(clause));
  return total&&!own.some(clause=>statusTerm.test(clause))&&!clauses.some(clause=>statusQualifier.test(clause.trim()))
   ?{...args,status:'all'}:args;
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
