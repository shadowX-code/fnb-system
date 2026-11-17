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
 expect(screen.getByText('Allow AI to read')).toBeTruthy();
 expect(screen.getByText(/Your account cannot use/)).toBeTruthy();
 expect(screen.queryByText('Advanced Diagnostics')).toBeNull();
 expect(screen.queryByRole('button',{name:'Test Connection'})).toBeNull();
 expect(screen.queryByText('Allow AI actions')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Disable AI Access'}));
 expect(onFeature).toHaveBeenCalledExactlyOnceWith('capability_connection',{operation:'read',enabled:false,expected_revision:4});
});
it('keeps ACTION access and execution authorization independent',()=>{
 const onFeature=vi.fn(async()=>({ok:true}));
 render(<AssistantCapabilityDetail row={{...row,status:'disabled',operations:[{...read,id:'draft',kind:'ACTION',availability:'disabled',ai_execution_enabled:false}]}} data={{config:{revision:4}}} canEdit onFeature={onFeature} onClose={()=>{}}/>);
 expect(screen.getByText('Allow AI actions')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Enable AI action authorization'}));
 expect(onFeature).toHaveBeenCalledExactlyOnceWith('action_policy',{operation:'draft',enabled:true,expected_revision:4});
 expect(screen.getByText(/confirmation of a current preview/)).toBeTruthy();
});
it('unsupported resources have no configuration and view-only cannot edit',()=>{
 const {rerender}=render(<AssistantCapabilityDetail row={{...row,status:'unsupported',operations:[]}} data={{config:{revision:4}}} canEdit onFeature={vi.fn()} onClose={()=>{}}/>);
 expect(screen.getByText('Not supported')).toBeTruthy();
 expect(screen.queryByRole('button',{name:/AI Access/})).toBeNull();
 rerender(<AssistantCapabilityDetail row={{...row,operations:[read]}} data={{config:{revision:4}}} canEdit={false} onFeature={vi.fn()} onClose={()=>{}}/>);
 expect(screen.getByRole('button',{name:'Disable AI Access'}).disabled).toBe(true);
});
it('explains partial coverage without granting module access and navigates to the existing owner',()=>{
 const onSelect=vi.fn(),onFeature=vi.fn();
 render(<AssistantCapabilityDetail row={{...row,status:'unsupported',operations:[],coverage:{classification:'partial',available:'Monthly operational P&L only.',missing:'No statutory statements.',reads:['read']},coverageReads:[read]}} data={{config:{revision:4}}} canEdit onFeature={onFeature} onClose={()=>{}} onSelect={onSelect}/>);
 expect(screen.getByText(/READ coverage · Partial/)).toBeTruthy();
 expect(screen.getByText('Not supported')).toBeTruthy();
 expect(screen.queryByRole('button',{name:/Enable AI Access|Disable AI Access/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Manage owning module access'}));expect(onSelect).toHaveBeenCalledWith('crew_roster');expect(onFeature).not.toHaveBeenCalled();
});
