import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,within,act} from '@testing-library/react';
import FactoryAgentActions from './FactoryAgentActions.jsx';
import {externalAgentService} from '../../services/externalAgentService.js';
vi.mock('../../services/externalAgentService.js',()=>({externalAgentService:{actionRequests:vi.fn(),confirmAction:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();vi.useRealTimers();});
const row={request_id:'qa-request',action:'calibration.create',label:'Calibration',status:'awaiting_confirmation',requested_at:'2026-11-01T00:00:00Z',input:{note:'QA simulation'},can_confirm:true,requires_confirmation:true};
it('requires evidence and explicit confirmation without executing the Agent command',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([row]);externalAgentService.confirmAction.mockResolvedValue({status:'confirmed'});
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review evidence confirmation'}));
 const reference=screen.getByRole('textbox',{name:'Existing evidence reference'});
 expect(screen.getByRole('button',{name:'Confirm evidence'}).disabled).toBe(true);
 fireEvent.change(reference,{target:{value:'Observed QA fixture evidence'}});fireEvent.click(screen.getByRole('button',{name:'Confirm evidence'}));
 expect(externalAgentService.confirmAction).not.toHaveBeenCalled();
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm evidence'}));
 await waitFor(()=>expect(externalAgentService.confirmAction).toHaveBeenCalledWith('qa-agent','qa-request','Observed QA fixture evidence'));
 expect(externalAgentService.actionRequests).toHaveBeenCalledTimes(2);
});
it('keeps restricted request payloads unavailable and does not offer confirmation',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([{...row,input:undefined,can_confirm:false}]);
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByText('Corresponding Factory authority is required to inspect this request.')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Review evidence confirmation'}).disabled).toBe(true);
 expect(screen.queryByText('QA simulation')).toBeNull();
});

it('distinguishes supported request states and never offers an expired confirmation',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([
 {...row,status:'confirmed',confirmed_at:'2020-01-01T00:00:00Z'},
 {...row,request_id:'done',status:'completed',receipt:{completed_at:'2026-11-01T00:05:00Z'}},
 {...row,request_id:'pending'},
 ]);
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByText('Confirmation expired')).toBeTruthy();
 expect(screen.getByText('Completed')).toBeTruthy();
 expect(screen.getByText('Pending confirmation')).toBeTruthy();
 expect(screen.getAllByRole('button',{name:'Review evidence confirmation'})).toHaveLength(1);
 expect(screen.getByText(/Rejected attempts are recorded in Activity/)).toBeTruthy();
});
it('refreshes on focus without overlapping requests and stops after unmount',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([]);
 const view=render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByText(/No pending action requests/)).toBeTruthy();
 let resolve;externalAgentService.actionRequests.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 fireEvent(window,new Event('focus'));fireEvent(window,new Event('focus'));
 expect(externalAgentService.actionRequests).toHaveBeenCalledTimes(2);
 resolve([row]);expect(await screen.findByText('Pending confirmation')).toBeTruthy();
 view.unmount();fireEvent(window,new Event('focus'));
 expect(externalAgentService.actionRequests).toHaveBeenCalledTimes(2);
});

it('has one visible-tab timer and no background polling after unmount',async()=>{
 vi.useFakeTimers();externalAgentService.actionRequests.mockResolvedValue([]);
 const view=render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 await act(async()=>{});
 await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
 expect(externalAgentService.actionRequests).toHaveBeenCalledTimes(2);
 view.unmount();await vi.advanceTimersByTimeAsync(60000);
 expect(externalAgentService.actionRequests).toHaveBeenCalledTimes(2);
});
it('recovers from unavailable requests without showing an endless initial loader',async()=>{
 externalAgentService.actionRequests.mockRejectedValueOnce(new Error('Read failed')).mockResolvedValueOnce([]);
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByRole('alert')).toBeTruthy();
 expect(screen.queryByText('Loading action requests…')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Check requests'}));
 expect(await screen.findByText(/No pending action requests/)).toBeTruthy();
});

it('offers an exact credential-free retry handoff after human approval',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([{...row,status:'confirmed',confirmed_at:new Date().toISOString(),expected_version:'source',target_id:'qa-target',execution_policy:'human_approval',execution_reason:'Physical inspection required'}]);
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn().mockResolvedValue()}});
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 fireEvent.click(await screen.findByRole('button',{name:'Copy Agent retry command'}));
 await screen.findByRole('button',{name:'Retry command copied'});
 const payload=JSON.parse(navigator.clipboard.writeText.mock.calls[0][0]);
 expect(payload).toEqual({request_id:row.request_id,action:row.action,target_id:'qa-target',expected_version:'source',input:row.input});
 expect(screen.getByText(/Physical inspection required/)).toBeTruthy();
});

it('shows a historical lifecycle blocker without offering confirmable approval',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([{...row,action:'area_cleaning.verify',can_confirm:false,lifecycle_requirement:'Only completed Cleaning occurrences can be verified.',execution_reason:'Human approval required'}]);
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByText(/Only completed Cleaning occurrences can be verified/)).toBeTruthy();
 expect(screen.getByRole('button',{name:'Review evidence confirmation'}).disabled).toBe(true);
});
it('retains old Cleaning intents as explicit Agent retries, without a redundant confirmation',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([{...row,action:'area_cleaning.complete',requires_confirmation:false,expected_version:'source',execution_policy:'autonomous'}]);
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByText('Awaiting Agent Execution')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Review evidence confirmation'})).toBeNull();
 expect(screen.getByRole('button',{name:'Copy Agent retry command'})).toBeTruthy();
 expect(externalAgentService.confirmAction).not.toHaveBeenCalled();
});
it('does not offer a retry for a historical Cleaning request whose lifecycle is incomplete',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([{...row,action:'area_cleaning.verify',status:'confirmed',requires_confirmation:false,lifecycle_requirement:'Only completed Cleaning occurrences can be verified.',expected_version:'source'}]);
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByText('Needs resolution')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Copy Agent retry command'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Review evidence confirmation'})).toBeNull();
});
