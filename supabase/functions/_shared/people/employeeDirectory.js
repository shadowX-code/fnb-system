// Employees owns this public read contract; Admin and Assistant use the same RPC.
export const employeeDirectoryFields=['id','full_name','employee_code','employment_status','employment_type','legal_entity_id','workplace','department','position','updated_at'];
export const employeeDirectoryArguments=a=>({p_mode:a.mode,p_employee_id:a.employee_id,p_status:a.status,p_legal_entity_id:a.legal_entity_id,p_workplace:a.workplace,p_query:a.query,p_page:a.page});
export function readEmployeeDirectory(caller,args){return caller.rpc('employee_directory_read',employeeDirectoryArguments(args));}
export const employmentStatus=value=>value??'active';
export const employmentType=value=>value??'probation';
export function employeeHeadcount(rows){
 const unique=[...new Map(rows.map(r=>[r.id,r])).values()];
 const count=status=>unique.filter(r=>employmentStatus(r.employment_status)===status).length;
 const active=count('active'),resigned=count('resigned'),terminated=count('terminated');
 return {total:unique.length,active,inactive:resigned+terminated,resigned,terminated,other:unique.length-active-resigned-terminated};
}
