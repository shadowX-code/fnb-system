import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import AssistantCapabilityDetail from './AssistantCapabilityDetail.jsx';
import {capabilityInventory} from './assistantCapabilityPresentation.js';
afterEach(cleanup);
it('connection summary is independent of user access, with separate ACTION enablement',()=>{
 const ops=[{id:'one',module_id:'marketing_calendar',kind:'READ',connection_enabled:true,availability:'denied'},{id:'two',module_id:'marketing_calendar',kind:'ACTION',connection_enabled:true,ai_execution_enabled:false,availability:'disabled'}];
 expect(capabilityInventory(ops).find(r=>r.id==='marketing_calendar').status).toBe('partial');
 ops[1].ai_execution_enabled=true;expect(capabilityInventory(ops).find(r=>r.id==='marketing_calendar').status).toBe('connected');
 ops.forEach(o=>o.connection_enabled=false);expect(capabilityInventory(ops).find(r=>r.id==='marketing_calendar').status).toBe('disabled');
 expect(capabilityInventory().find(r=>r.id==='marketing_calendar').status).toBe('unsupported');
});
const row={id:'crew_roster',label:'Roster',workspaceLabel:'Crew',domain:'Workforce',status:'connected',sources:[]};
const read={id:'read',module_id:'crew_roster',kind:'READ',label:'Roster information',scope:'Authorized team roster',connection_enabled:true,availability:'denied',test_supported:true};
it('manages individual access without diagnostics or granting user permissions',()=>{
 const onFeature=vi.fn(async()=>({ok:true}));
 render(<AssistantCapabilityDetail row={{...row,operations:[read]}} data={{config:{revision:4}}} canEdit onFeature={onFeature} onClose={()=>{}}/>);
 expect(screen.getByText('AI Read Access')).toBeTruthy();
 expect(screen.getByText(/Your account cannot use/)).toBeTruthy();
 expect(screen.queryByText('Advanced Diagnostics')).toBeNull();
 expect(screen.queryByRole('button',{name:'Test Connection'})).toBeNull();
 expect(screen.queryByText('AI Actions')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/Disable AI Access:/}));
 expect(onFeature).toHaveBeenCalledExactlyOnceWith('capability_connection',{operation:'read',enabled:false,expected_revision:4});
});
it('keeps ACTION access and execution authorization independent',()=>{
 const onFeature=vi.fn(async()=>({ok:true}));
 render(<AssistantCapabilityDetail row={{...row,status:'disabled',operations:[{...read,id:'draft',kind:'ACTION',availability:'disabled',ai_execution_enabled:false}]}} data={{config:{revision:4}}} canEdit onFeature={onFeature} onClose={()=>{}}/>);
 expect(screen.getByText('AI Actions')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Enable execution authorization: Roster information'}));
 expect(onFeature).toHaveBeenCalledExactlyOnceWith('action_policy',{operation:'draft',enabled:true,expected_revision:4});
 expect(screen.getByText(/confirmation of a current preview/)).toBeTruthy();
});
it('unsupported resources have no configuration and view-only cannot edit',()=>{
 const {rerender}=render(<AssistantCapabilityDetail row={{...row,status:'unsupported',operations:[]}} data={{config:{revision:4}}} canEdit onFeature={vi.fn()} onClose={()=>{}}/>);
 expect(screen.getByText(/Not integrated coverage|Partial coverage/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:/AI Access/})).toBeNull();
 rerender(<AssistantCapabilityDetail row={{...row,operations:[read]}} data={{config:{revision:4}}} canEdit={false} onFeature={vi.fn()} onClose={()=>{}}/>);
 expect(screen.getByRole('button',{name:/Disable AI Access:/}).disabled).toBe(true);
});
it('explains partial coverage without granting module access and navigates to the existing owner',()=>{
 const onSelect=vi.fn(),onFeature=vi.fn();
 render(<AssistantCapabilityDetail row={{...row,status:'unsupported',operations:[],coverage:{classification:'partial',available:'Monthly operational P&L only.',missing:'No statutory statements.',reads:['read']},coverageReads:[{...read,module_id:'factory_finished_goods'}]}} data={{config:{revision:4}}} canEdit onFeature={onFeature} onClose={()=>{}} onSelect={onSelect}/>);
 expect(screen.getByText(/Partial coverage/)).toBeTruthy();
 expect(screen.getByText(/Not integrated coverage|Partial coverage/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:/Enable AI Access|Disable AI Access/})).toBeNull();
 expect(screen.getByText('policy at')).toBeTruthy();
 expect(screen.queryByRole('region',{name:'Shared READ access'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/Manage .* access/}));expect(onSelect).toHaveBeenCalledWith('factory_finished_goods');expect(onFeature).not.toHaveBeenCalled();
});

it('deduplicates owned coverage reads and keeps missing policy unavailable',()=>{
 render(<AssistantCapabilityDetail row={{...row,operations:[{...read,connection_enabled:undefined}],coverage:{classification:'partial',available:'Roster only.',missing:'No approvals.',reads:['read']},coverageReads:[read]}} data={{config:{revision:4}}} canEdit onFeature={vi.fn()} onClose={()=>{}}/>);
 expect(screen.getAllByText('Roster information')).toHaveLength(1);
 expect(screen.queryByRole('region',{name:'Related Data'})).toBeNull();
 expect(screen.getByText('Unavailable')).toBeTruthy();
 expect(screen.getByRole('button',{name:/Enable AI Access:/}).disabled).toBe(true);
});
it('deduplicates shared reads and leaves control with the actual owner',()=>{
 const shared={...read,module_id:'factory_finished_goods'};
 render(<AssistantCapabilityDetail row={{...row,operations:[shared],coverageReads:[shared]}} data={{config:{revision:4}}} canEdit onFeature={vi.fn()} onClose={()=>{}} onSelect={()=>{}}/>);
 expect(screen.getAllByText('Roster information')).toHaveLength(1);
 expect(screen.getByRole('region',{name:'Shared READ access'})).toBeTruthy();
 expect(screen.queryByRole('region',{name:'AI Read Access'})).toBeNull();
 expect(screen.queryByRole('region',{name:'Related Data'})).toBeNull();
 expect(screen.queryByRole('button',{name:/Enable AI Access:|Disable AI Access:/})).toBeNull();
});
it('shows refreshed server policy after a save and preserves exact revision ownership',async()=>{
 const onFeature=vi.fn(async()=>({ok:true}));
 const props={data:{config:{revision:4}},canEdit:true,onFeature,onClose:()=>{}};
 const {rerender}=render(<AssistantCapabilityDetail {...props} row={{...row,operations:[{...read,connection_enabled:false}]}}/>);
 fireEvent.click(screen.getByRole('button',{name:/Enable AI Access:/}));
 await screen.findByRole('status');
 expect(onFeature).toHaveBeenCalledExactlyOnceWith('capability_connection',{operation:'read',enabled:true,expected_revision:4});
 rerender(<AssistantCapabilityDetail {...props} data={{config:{revision:5}}} row={{...row,operations:[read]}}/>);
 expect(screen.getByRole('button',{name:/Disable AI Access:/}).disabled).toBe(false);
 expect(screen.getByText('Enabled')).toBeTruthy();
});
it('ordinary module policy explicitly groups reviewed reads without hiding mixed individual access',()=>{
 const onFeature=vi.fn(async()=>({ok:true}));
 const operations=[{...read,id:'read_employee_directory',module_id:'employees',policy_group:'employees',connection_enabled:false},{...read,id:'read_employee_assignment',label:'Assignment',module_id:'employees',policy_group:'employees',connection_enabled:true}];
 render(<AssistantCapabilityDetail row={{...row,id:'employees',operations}} data={{config:{revision:24}}} canEdit onFeature={onFeature} onClose={()=>{}}/>);
 expect(screen.getByText(/Mixed access/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Enable ordinary reads'}));
 expect(onFeature).toHaveBeenCalledExactlyOnceWith('capability_connection',{operation:'module:employees',enabled:true,expected_revision:24});
});

it('explains an unsupported module without showing an empty access-control section',()=>{
 const module=capabilityInventory().find(row=>row.id==='space_station');
 render(<AssistantCapabilityDetail row={module} data={{config:{revision:4}}} canEdit onFeature={vi.fn()} onClose={()=>{}}/>);
 expect(screen.getByText(/virtual workspace navigation and simulation have no independent business records/i)).toBeTruthy();
 expect(screen.queryByRole('region',{name:'AI Read Access'})).toBeNull();
 expect(screen.queryByRole('region',{name:'AI Actions'})).toBeNull();
});
