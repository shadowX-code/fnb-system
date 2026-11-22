import {date,readContract,uuid,pick} from '../assistant/readContract.js';

export const employmentRead=readContract({
 id:'read_employee_assignment',policyGroup:'employees',version:2,module_id:'employees',label:'Employment assignment',
 permission:'employees.view',scope:'Current Admin employee/outlet authority',source:'/employees',employeeNameLookup:true,
 description:'Read the verified employment assignment on a specified date or today. The timeline may start after the requested date. Compensation, contacts, identity documents and disciplinary records are excluded.',
 properties:{employee_id:uuid,on:{...date,nullable:true}},normalizeArguments:a=>({on:null,...a}),
 interface:{queryKinds:['detail','history'],authority:'employee_employment_assignment_read',pagination:'A single effective assignment on the requested date; unresolved before verified history.'},
 rpc:'employee_employment_assignment_read',arguments:a=>({p_employee_id:a.employee_id,p_on:a.on}),
 project:data=>({state:data.state,effective_on:data.as_of,verified_from:data.verified_from,
  assignment:data.assignment?pick(data.assignment,['id','effective_from','employment_type','employment_status','position','workplace','legal_entity_id']):null}),
});
