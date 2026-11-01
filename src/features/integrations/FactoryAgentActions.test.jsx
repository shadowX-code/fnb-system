import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';
import FactoryAgentActions from './FactoryAgentActions.jsx';
import {externalAgentService} from '../../services/externalAgentService.js';
vi.mock('../../services/externalAgentService.js',()=>({externalAgentService:{actionRequests:vi.fn(),confirmAction:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const row={request_id:'qa-request',action:'area_cleaning.complete',label:'Area Cleaning',status:'awaiting_confirmation',requested_at:'2026-11-01T00:00:00Z',input:{note:'QA simulation'},can_confirm:true};
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
