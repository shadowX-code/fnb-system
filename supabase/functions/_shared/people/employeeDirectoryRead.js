import {readContract,uuid,pick} from '../assistant/readContract.js';
import {employeeDirectoryArguments,employeeDirectoryFields} from './employeeDirectory.js';
export const employeeDirectoryRead=readContract({
 id:'read_employee_directory',module_id:'employees',label:'Employee headcount and directory',permission:'employees.view',
 source:'/people/employees',scope:'Current human RLS-visible Employees; optional company/workplace/status/name filters; unique employee IDs, not assignment rows',
 description:'Use summary for employee headcount, active/inactive employment counts; no employee ID or company ID needed. Use list to find authorized employees by name/code, status or workplace, then the existing assignment tool for effective-dated assignment details. Inactive means resigned or terminated, not disabled login. Never count a page as total headcount. Null filters mean all records already visible to this user.',
 properties:{mode:{type:'string',enum:['summary','list','detail']},employee_id:{...uuid,nullable:true},status:{type:'string',enum:['all','active','inactive','resigned','terminated']},legal_entity_id:{...uuid,nullable:true},workplace:{type:'string',maxLength:120,nullable:true},query:{type:'string',maxLength:80},page:{type:'number',minimum:1,maximum:1000}},
 rpc:'employee_directory_read',arguments:employeeDirectoryArguments,
 interface:{queryKinds:['summary','list','detail'],authority:'employee_directory_read',fields:employeeDirectoryFields,sensitive:'No contacts, auth IDs, identity documents, compensation, bank data or disciplinary records.',aggregates:'complete_filtered_scope',pagination:'20 rows per page; summary and total_count span all matching authorized records.',unavailable:'Denied detail returns no evidence; empty authorized summary is zero. Unknown employment statuses remain other.'},
 project:d=>({summary:pick(d.summary,['total','active','inactive','resigned','terminated','other']),rows:d.rows.map(r=>pick(r,employeeDirectoryFields)),total_count:d.total_count,page:d.page,page_size:d.page_size,truncated:d.has_more,source_as_of:d.as_of,source_version:d.schema_version,aggregate_complete:d.aggregate_complete,status_definition:d.status_definition})
});
