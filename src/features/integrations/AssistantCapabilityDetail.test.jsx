import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import AssistantCapabilityDetail,{diagnosticArguments} from './AssistantCapabilityDetail.jsx';
import {capabilityInventory} from './assistantCapabilityPresentation.js';
afterEach(cleanup);
it('connection summary is independent of user access, with separate ACTION enablement',()=>{
 const ops=[{id:'one',module_id:'marketing_calendar',kind:'READ',connection_enabled:true,availability:'denied'},{id:'two',module_id:'marketing_calendar',kind:'ACTION',connection_enabled:true,ai_execution_enabled:false,availability:'disabled'}];
 expect(capabilityInventory(ops).find(r=>r.id==='marketing_calendar').status).toBe('partial');
 ops[1].ai_execution_enabled=true;expect(capabilityInventory(ops).find(r=>r.id==='marketing_calendar').status).toBe('connected');
 ops.forEach(o=>o.connection_enabled=false);expect(capabilityInventory(ops).find(r=>r.id==='marketing_calendar').status).toBe('disabled');
 expect(capabilityInventory().find(r=>r.id==='marketing_calendar').status).toBe('unsupported');
});
it('diagnostics are collapsed, use authorized outlet options and submit validated read-only arguments',async()=>{
 const onFeature=vi.fn(async()=>({as_of:'test'}));const operation={id:'read',module_id:'crew_roster',kind:'READ',label:'Roster',connection_enabled:true,availability:'connected',test_supported:true,test_parameters:{outlet_id:{type:'string',pattern:'^[a-z]+$'},page:{type:'number',minimum:1,maximum:100}}};
 render(<AssistantCapabilityDetail row={{id:'crew_roster',label:'Roster',workspaceLabel:'Crew',domain:'Workforce',status:'connected',operations:[operation],sources:[]}} data={{config:{revision:1}}} canEdit busy={false} onFeature={onFeature} onClose={()=>{}} auth={{accessibleOutletIds:['allowed']}} store={{outlets:[{id:'allowed',name:'Allowed outlet'},{id:'hidden',name:'Forbidden outlet'}]}}/>);
 expect(screen.queryByRole('button',{name:'Test Connection'})).toBeNull();expect(onFeature).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('Advanced Diagnostics'));const test=await screen.findByRole('button',{name:'Test Connection'});expect(test.disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Outlet',exact:true}));expect(screen.queryByRole('option',{name:'Forbidden outlet'})).toBeNull();fireEvent.click(await screen.findByRole('option',{name:'Allowed outlet'}));fireEvent.click(test);
 expect(onFeature).toHaveBeenCalledWith('capability_test',{operation:'read',arguments:{outlet_id:'allowed',page:1}});
});
it('diagnostics reject invalid periods, IDs and numeric blanks without a request',()=>{
 expect(()=>diagnosticArguments({page:{type:'number',minimum:1,maximum:100}},{page:''})).toThrow();
 expect(()=>diagnosticArguments({from:{type:'string',pattern:'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'}},{from:'2026-02-31'})).toThrow();
 expect(()=>diagnosticArguments({from:{type:'string'},to:{type:'string'}},{from:'2026-01-01',to:'2026-03-01'})).toThrow();
 expect(diagnosticArguments({outlet_id:{type:['string','null']}},{})).toEqual({outlet_id:null});
});
