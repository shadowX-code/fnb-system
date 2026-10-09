// Page roles is a relationship edge, not a Page field. Its uid is derived only
// from a verified Meta token subject; neither that subject nor raw rows escape.
export async function resolvePageRoleTasks(pageId:string,subject:string,read:(path:string,params:Record<string,any>)=>Promise<any>) {
 const unknown=(reason:string)=>({state:'unverified',source:'page_roles',tasks:[] as string[],can_create:false,reason});
 if(!/^\d{1,30}$/.test(pageId)||!/^\d{1,30}$/.test(subject))return unknown('authorizer_identity_unavailable');
 const value=await read(`${pageId}/roles`,{uid:subject,fields:'id,is_active,tasks',limit:2});
 if(!Array.isArray(value?.data))return unknown('task_edge_unavailable');
 if(value.data.length===0)return unknown('authorizer_not_returned');
 if(value.data.length!==1||value.paging?.next||String(value.data[0]?.id)!==subject)return unknown('authorizer_identity_mismatch');
 const row=value.data[0];
 if(typeof row.is_active!=='boolean'||!Array.isArray(row.tasks)||row.tasks.some((s:unknown)=>typeof s!=='string'))return unknown('task_evidence_incomplete');
 if(row.tasks.some((s:string)=>!['MANAGE','CREATE_CONTENT','MODERATE','ADVERTISE','ANALYZE'].includes(s)))return unknown('task_vocabulary_unrecognized');
 const tasks=row.tasks.filter((s:string)=>['MANAGE','CREATE_CONTENT','MODERATE','ADVERTISE','ANALYZE'].includes(s));
 const create=row.is_active&&tasks.some((s:string)=>s==='MANAGE'||s==='CREATE_CONTENT');
 return {state:create?'verified':'not_granted',source:'page_roles',tasks,can_create:create,reason:create?null:row.is_active?'content_task_not_granted':'authorizer_inactive'};
}

export type AuthorizerAssignment={subject:string;businessId:string;businessUserId:string};
const numeric=(v:unknown)=>typeof v==='string'&&/^\d{1,30}$/.test(v);
// This mapping must come from the verified OAuth User token, never names or client IDs.
export async function discoverAuthorizerAssignments(subject:string,read:(path:string,params:Record<string,any>)=>Promise<any>):Promise<AuthorizerAssignment[]> {
 if(!numeric(subject))return [];
 const value=await read(`${subject}/business_users`,{fields:'id,business{id}',limit:20});
 if(!Array.isArray(value?.data)||value.paging?.next||value.data.length>20)return [];
 const rows=value.data;
 if(rows.some((r:any)=>!numeric(r?.id)||!numeric(r?.business?.id)))return [];
 if(new Set(rows.map((r:any)=>r.business.id)).size!==rows.length)return [];
 return rows.map((r:any)=>({subject,businessId:r.business.id,businessUserId:r.id}));
}
export async function resolveBusinessPageTasks(pageId:string,subject:string,assignment:AuthorizerAssignment|undefined,read:(path:string,params:Record<string,any>)=>Promise<any>) {
 const unknown=(reason:string)=>({state:'unverified',source:'page_assigned_users',tasks:[] as string[],can_create:false,reason});
 if(!numeric(pageId)||!numeric(subject)||!assignment||assignment.subject!==subject||!numeric(assignment.businessId)||!numeric(assignment.businessUserId))return unknown('business_authorizer_mapping_unavailable');
 const rows:any[]=[];let after:string|undefined;
 for(let page=0;page<10;page++) {
  const value=await read(`${pageId}/assigned_users`,{business:assignment.businessId,fields:'id,tasks',limit:50,after});
  if(!Array.isArray(value?.data))return unknown('business_task_edge_unavailable');
  rows.push(...value.data);
  if(!value.paging?.next)break;
  after=value.paging?.cursors?.after;
  if(typeof after!=='string'||!after||after.length>2048||page===9)return unknown('business_task_pagination_incomplete');
 }
 const matches=rows.filter(r=>r?.id===assignment.businessUserId);
 if(!matches.length)return unknown('business_authorizer_not_returned');
 if(matches.length!==1||!Array.isArray(matches[0].tasks)||matches[0].tasks.some((t:unknown)=>typeof t!=='string'))return unknown('business_task_evidence_incomplete');
 // permitted_tasks is assignable authority, never an actual task grant.
 const tasks=matches[0].tasks.filter((t:string)=>['MANAGE','CREATE_CONTENT'].includes(t));
 const create=tasks.length>0;
 if(!create&&matches[0].tasks.some((t:string)=>!['ADVERTISE','ANALYZE','MODERATE','MESSAGING'].includes(t)))return unknown('task_vocabulary_unrecognized');
 return {state:create?'verified':'not_granted',source:'page_assigned_users',tasks,can_create:create,reason:create?null:'content_task_not_granted'};
}
