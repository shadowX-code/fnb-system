import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,within,act} from '@testing-library/react';
import FactoryAgentActions from './FactoryAgentActions.jsx';
import {externalAgentService} from '../../services/externalAgentService.js';
vi.mock('../../services/externalAgentService.js',()=>({externalAgentService:{actionRequests:vi.fn(),confirmAction:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();vi.useRealTimers();});
const row={request_id:'qa-request',action:'calibration.create',label:'Calibration',status:'awaiting_confirmation',requested_at:'2026-11-01T00:00:00Z',input:{note:'QA simulation'},can_confirm:true,requires_confirmation:true,queue_state:'pending_approval',resolution_reason:'Physical inspection required',next_action:'Review genuine evidence before approving.'};
it('requires evidence and explicit confirmation without executing the Agent command',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([row]);externalAgentService.confirmAction.mockResolvedValue({status:'confirmed'});
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review evidence approval'}));
 const reference=screen.getByRole('textbox',{name:'Existing evidence reference'});
 expect(screen.getByRole('button',{name:'Approve evidence'}).disabled).toBe(true);
 fireEvent.change(reference,{target:{value:'Observed QA fixture evidence'}});fireEvent.click(screen.getByRole('button',{name:'Approve evidence'}));
 expect(externalAgentService.confirmAction).not.toHaveBeenCalled();
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Approve evidence'}));
 await waitFor(()=>expect(externalAgentService.confirmAction).toHaveBeenCalledWith('qa-agent','qa-request','Observed QA fixture evidence'));
 expect(externalAgentService.actionRequests).toHaveBeenCalledTimes(2);
});
it('keeps restricted request payloads unavailable and does not offer confirmation',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([{...row,input:undefined,can_confirm:false}]);
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByText('Corresponding Factory authority is required to inspect this request.')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Review evidence approval'})).toBeNull();
 expect(screen.queryByText('QA simulation')).toBeNull();
});

it('distinguishes supported request states and never offers an expired confirmation',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([
 {...row,status:'confirmed',queue_state:'expired',confirmed_at:'2020-01-01T00:00:00Z'},
 {...row,request_id:'done',status:'completed',queue_state:'completed',receipt:{completed_at:'2026-11-01T00:05:00Z'}},
 {...row,request_id:'pending'},
 ]);
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByText('Pending Human Approval')).toBeTruthy();
 expect(screen.queryByText('Expired')).toBeNull();
 expect(screen.queryByText('Completed')).toBeNull();
 expect(screen.getAllByRole('button',{name:'Review evidence approval'})).toHaveLength(1);
 expect(screen.getByText(/denied attempts are recorded in Activity/)).toBeTruthy();
});
it('refreshes on focus without overlapping requests and stops after unmount',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([]);
 const view=render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByText(/No action required/)).toBeTruthy();
 let resolve;externalAgentService.actionRequests.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 fireEvent(window,new Event('focus'));fireEvent(window,new Event('focus'));
 expect(externalAgentService.actionRequests).toHaveBeenCalledTimes(2);
 resolve([row]);expect(await screen.findByText('Pending Human Approval')).toBeTruthy();
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
 expect(await screen.findByText(/No action required/)).toBeTruthy();
});

it('offers an exact credential-free retry handoff after human approval',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([{...row,status:'confirmed',queue_state:'awaiting_execution',can_continue:true,confirmed_at:new Date().toISOString(),expected_version:'source',target_id:'qa-target',execution_policy:'human_approval',execution_reason:'Physical inspection required'}]);
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn().mockResolvedValue()}});
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 fireEvent.click(await screen.findByText('Review exact request'));
 fireEvent.click(screen.getByRole('button',{name:'Copy Agent continuation'}));
 await screen.findByRole('button',{name:'Continuation copied'});
 const payload=JSON.parse(navigator.clipboard.writeText.mock.calls[0][0]);
 expect(payload).toEqual({request_id:row.request_id,action:row.action,target_id:'qa-target',expected_version:'source',input:row.input});
 expect(screen.getByText(/Physical inspection required/)).toBeTruthy();
});

it('shows a historical lifecycle blocker without offering confirmable approval',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([{...row,action:'area_cleaning.verify',can_confirm:false,queue_state:'needs_resolution',resolution_reason:'Only completed Cleaning occurrences can be verified.',next_action:'Complete the authorized Cleaning workflow, then submit a new intent.'}]);
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByText(/Only completed Cleaning occurrences can be verified/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Review evidence approval'})).toBeNull();
});
it('keeps legacy Cleaning intents out of the default queue without requesting a retry',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([{...row,action:'area_cleaning.complete',requires_confirmation:false,queue_state:'legacy_pending',expected_version:'source',execution_policy:'autonomous'}]);
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByText(/No action required/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Review evidence approval'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Copy Agent continuation'})).toBeNull();
 expect(externalAgentService.confirmAction).not.toHaveBeenCalled();
});
it('does not offer a continuation after a confirmed request becomes stale',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([{...row,status:'confirmed',queue_state:'needs_resolution',resolution_reason:'Factory evidence changed after this request was saved.',expected_version:'source'}]);
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByText('Needs Resolution')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Copy Agent continuation'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Review evidence approval'})).toBeNull();
});
it('keeps legacy, completed and expired requests inspectable only in history, without mutation actions',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([
  {...row,request_id:'legacy-1',queue_state:'legacy_pending'},
  {...row,request_id:'legacy-2',queue_state:'legacy_pending',expected_version:'different-source'},
  {...row,request_id:'completed',queue_state:'completed',status:'completed'},
  {...row,request_id:'expired',queue_state:'expired',status:'confirmed'},
  {...row,request_id:'active',queue_state:'pending_approval'},
 ]);
 render(<FactoryAgentActions identityId="qa-agent" history canManage/>);
 expect(await screen.findAllByText('Legacy Pending Request')).toHaveLength(2);
 expect(screen.getByText('Completed')).toBeTruthy();expect(screen.getByText('Expired')).toBeTruthy();
 expect(screen.queryByText('Pending Human Approval')).toBeNull();
 expect(screen.queryByRole('button',{name:'Review evidence approval'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Copy Agent continuation'})).toBeNull();
});
it('does not infer an actionable state from an unsupported response',async()=>{
 externalAgentService.actionRequests.mockResolvedValue([{...row,queue_state:undefined}]);
 render(<FactoryAgentActions identityId="qa-agent" canManage/>);
 expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('request states are unavailable'));
 expect(screen.queryByRole('button',{name:'Review evidence approval'})).toBeNull();
});
