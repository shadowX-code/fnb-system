import {it,expect,vi} from 'vitest';
import {savePlannerTask,mergeTaskDraft} from '../plannerTaskSave.js';
import {taskPayload} from '../contentPlanner.js';
const task={id:'t',organization_id:'o',brand_id:'b',revision:3,status:'planned',planning_month:'2026-10-01',title:'Photo',brief:'Original',asset_ids:['a'],linked_content_id:null};
const conflict=()=>Object.assign(new Error('Task changed'),{cause:{code:'PT409'}});
function setup(current={...task,revision:4,priority:'high'}){
 const service={command:vi.fn().mockRejectedValueOnce(conflict()).mockResolvedValue({...current,revision:5,asset_ids:[]}),read:vi.fn().mockResolvedValue({tasks:[current]})};
 const args={task,intent:{org:'o',brand:'b',id:'t',revision:3,action:'save',payload:{...taskPayload(task),month:'2026-10-01',asset_ids:[]}},attempt:{id:'stable'},readBrand:'b'};
 return {service,args};
}
it('rebases only the changed media field after unrelated ordering or property changes',async()=>{
 const {service,args}=setup();await savePlannerTask(service,args);
 expect(service.command.mock.calls[0][0]).toMatchObject({requestId:'stable',revision:3,payload:{month:'2026-10-01',asset_ids:[]}});
 expect(Object.keys(service.command.mock.calls[1][0].payload)).toEqual(['month','asset_ids']);expect(service.command.mock.calls[1][0].revision).toBe(4);
 expect(service.read).toHaveBeenCalledWith('o','2026-10-01','b');
});
it.each([{asset_ids:['other']},{status:'completed'},{linked_content_id:'published'},{planning_month:'2026-11-01'},{brand_id:'other'},{organization_id:'other'}])('preserves genuine conflicts and authority changes %j',async patch=>{
 const {service,args}=setup({...task,revision:4,...patch});await expect(savePlannerTask(service,args)).rejects.toThrow(/edits are kept/);expect(service.command).toHaveBeenCalledTimes(1);
});
it('recognizes the exact desired association already persisted without another write',async()=>{
 const {service,args}=setup({...task,revision:4,asset_ids:[]});expect((await savePlannerTask(service,args)).revision).toBe(4);expect(service.command).toHaveBeenCalledTimes(1);
});
it('does not retry permission failures or uncertain network outcomes',async()=>{
 for(const code of ['42501','NETWORK']){const {service,args}=setup();service.command.mockReset().mockRejectedValue(Object.assign(new Error('Unavailable'),{cause:{code}}));await expect(savePlannerTask(service,args)).rejects.toThrow('Unavailable');expect(service.read).not.toHaveBeenCalled();expect(service.command).toHaveBeenCalledTimes(1);}
});
it('retains the exact rebased request identity for a user retry after uncertain response',async()=>{
 const {service,args}=setup();service.command.mockReset().mockRejectedValueOnce(conflict()).mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({...task,revision:5,asset_ids:[]});
 await expect(savePlannerTask(service,args)).rejects.toThrow('Network unavailable');const sent=service.command.mock.calls[1][0];await savePlannerTask(service,args);expect(service.command.mock.calls[2][0]).toEqual(sent);expect(service.read).toHaveBeenCalledTimes(1);
});
it('bounds repeated concurrency and requires explicit review after a second rejection',async()=>{
 const {service,args}=setup();service.command.mockReset().mockRejectedValue(conflict());await expect(savePlannerTask(service,args)).rejects.toThrow();await expect(savePlannerTask(service,args)).rejects.toThrow(/Load the latest/);expect(service.command).toHaveBeenCalledTimes(3);
});
it('does not retry after the authorized UI scope changes',async()=>{
 const {service,args}=setup();args.isCurrent=()=>false;await expect(savePlannerTask(service,args)).rejects.toThrow('Task changed');expect(service.command).toHaveBeenCalledTimes(1);
});
it('refreshes untouched fields while retaining unsaved selections and description',()=>{
 const draft={...taskPayload(task),asset_ids:[],brief:'My unsaved description'};const fresh={...task,revision:4,title:'New title',asset_ids:['other']};const merged=mergeTaskDraft(draft,task,fresh);expect(merged).toMatchObject({title:'New title',asset_ids:[],brief:'My unsaved description'});expect(mergeTaskDraft(merged,fresh,{...fresh,revision:5,asset_ids:[],brief:merged.brief})).toEqual(merged);
});

it('rebases a carried task from the displayed month without treating its origin as a conflict',async()=>{
 const task={id:'carry',brand_id:'b',organization_id:'o',planning_month:'2026-10-01',revision:1,status:'planned',asset_ids:['a']};
 const service={command:vi.fn().mockRejectedValueOnce(Object.assign(new Error('stale'),{code:'PT409'})).mockResolvedValueOnce({...task,revision:3,asset_ids:[]}),read:vi.fn().mockResolvedValue({tasks:[{...task,revision:2,carried_forward:true}]})};
 await savePlannerTask(service,{task,intent:{org:'o',brand:'b',action:'save',id:'carry',revision:1,payload:{month:'2026-11-01',asset_ids:[]}},attempt:{id:'first'},readBrand:'b'});
 expect(service.read).toHaveBeenCalledWith('o','2026-11-01','b');expect(service.command.mock.calls[1][0].payload.month).toBe('2026-11-01');
});
