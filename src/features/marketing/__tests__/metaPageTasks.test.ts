import {describe,it,expect,vi} from 'vitest';
import {resolvePageRoleTasks} from '../../../../supabase/functions/_shared/metaPageTasks.ts';
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
