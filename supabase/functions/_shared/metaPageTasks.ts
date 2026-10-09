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
