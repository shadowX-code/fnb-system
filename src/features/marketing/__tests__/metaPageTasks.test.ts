import {describe,it,expect,vi} from 'vitest';
import {resolvePageRoleTasks,discoverAuthorizerAssignments,resolveBusinessPageTasks} from '../../../../supabase/functions/_shared/metaPageTasks.ts';
describe('authorizing-user Page roles evidence',()=>{
 it('requires exact active authorizer and explicit content tasks',async()=>{
  const read=vi.fn().mockResolvedValue({data:[{id:'789',is_active:true,tasks:['MANAGE','ANALYZE'],name:'private-name'}]});
  const result=await resolvePageRoleTasks('111','789',read);
  expect(result).toMatchObject({state:'verified',can_create:true,tasks:['MANAGE','ANALYZE']});
  expect(read).toHaveBeenCalledWith('111/roles',{uid:'789',fields:'id,is_active,tasks',limit:2});
  expect(JSON.stringify(result)).not.toContain('789');expect(JSON.stringify(result)).not.toContain('private-name');
 });
 it('distinguishes explicit non-content tasks from unavailable evidence',async()=>{
  for(const value of [null,{data:[]},{data:[{id:'999',is_active:true,tasks:['MANAGE']}]},{data:[{id:'789',tasks:['MANAGE']}]},{data:[{id:'789',is_active:true,tasks:['unknown-task']}]},{data:[{id:'789',is_active:true,tasks:['MANAGE']}],paging:{next:'private-token'}}]) {
   const result=await resolvePageRoleTasks('111','789',async()=>value);
   expect(result.state).toBe('unverified');expect(result.can_create).toBe(false);
  }
  for(const row of [{id:'789',is_active:true,tasks:['ANALYZE']},{id:'789',is_active:true,tasks:[]},{id:'789',is_active:false,tasks:['MANAGE']}]) {
   expect(await resolvePageRoleTasks('111','789',async()=>({data:[row]}))).toMatchObject({state:'not_granted',can_create:false});
  }
 });
 it('does not send a caller-supplied or unavailable subject to Meta',async()=>{
  const read=vi.fn();expect((await resolvePageRoleTasks('111','',read)).state).toBe('unverified');
  expect((await resolvePageRoleTasks('invalid-page','789',read)).state).toBe('unverified');expect(read).not.toHaveBeenCalled();
 });
});

describe('business Page tasks for exact OAuth authorizer',()=>{
 it('maps only through the User relationship, requests no profile fields, and rejects ambiguous mappings',async()=>{
  const read=vi.fn().mockResolvedValue({data:[{id:'555',business:{id:'777'},name:'private'}]});
  expect(await discoverAuthorizerAssignments('789',read)).toEqual([{subject:'789',businessId:'777',businessUserId:'555'}]);
  expect(read).toHaveBeenCalledWith('789/business_users',{fields:'id,business{id}',limit:20});
  for(const value of [null,{data:[{id:'555'}]},{data:[{id:'555',business:{id:'777'}},{id:'556',business:{id:'777'}}]},{data:[],paging:{next:'secret'}}])expect(await discoverAuthorizerAssignments('789',async()=>value)).toEqual([]);
 });
 it('reads actual tasks for the mapped authorizer, never another assigned user or permitted_tasks',async()=>{
  const assignment={subject:'789',businessId:'777',businessUserId:'555'};
  const read=vi.fn().mockResolvedValue({data:[{id:'999',tasks:['MANAGE']},{id:'555',tasks:['CREATE_CONTENT'],name:'private'}]});
  const result=await resolveBusinessPageTasks('111','789',assignment,read);
  expect(result).toMatchObject({state:'verified',source:'page_assigned_users',tasks:['CREATE_CONTENT'],can_create:true});
  expect(read).toHaveBeenCalledWith('111/assigned_users',{business:'777',fields:'id,tasks',limit:50,after:undefined});
  expect(JSON.stringify(result)).not.toMatch(/789|555|private/);
  for(const rows of [[{id:'999',tasks:['MANAGE']}],[{id:'555',permitted_tasks:['MANAGE']}],[{id:'555',tasks:['PROFILE_PLUS_FULL_CONTROL']}],[{id:'555',tasks:['MANAGE']},{id:'555',tasks:['MANAGE']}]])expect((await resolveBusinessPageTasks('111','789',assignment,async()=>({data:rows}))).state).toBe('unverified');
  expect((await resolveBusinessPageTasks('111','789',assignment,async()=>({data:[{id:'555',tasks:['ANALYZE'],permitted_tasks:['MANAGE']}]}))).state).toBe('not_granted');
  const unused=vi.fn();expect((await resolveBusinessPageTasks('111','999',assignment,unused)).state).toBe('unverified');expect(unused).not.toHaveBeenCalled();
 });
 it('requires complete bounded pagination before adopting tasks',async()=>{
  const assignment={subject:'789',businessId:'777',businessUserId:'555'};
  const read=vi.fn().mockResolvedValueOnce({data:[{id:'555',tasks:['MANAGE']}],paging:{next:'not-followed-secret',cursors:{after:'cursor'}}}).mockResolvedValueOnce({data:[]});
  expect((await resolveBusinessPageTasks('111','789',assignment,read)).state).toBe('verified');expect(read.mock.calls[1][1].after).toBe('cursor');
  expect((await resolveBusinessPageTasks('111','789',assignment,async()=>({data:[{id:'555',tasks:['MANAGE']}],paging:{next:'secret'}}))).state).toBe('unverified');
 });
});
