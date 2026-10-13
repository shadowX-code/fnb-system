import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup,fireEvent,waitFor} from '@testing-library/react';
import InboxHistoryImport from '../InboxHistoryImport.jsx';
import {inboxService} from '../inboxService.js';
vi.mock('../inboxService.js',()=>({inboxService:{historyStatus:vi.fn(),requestHistory:vi.fn()}}));
afterEach(()=>{cleanup();vi.resetAllMocks()});
it('keeps import unavailable while privacy approval is absent',async()=>{
 inboxService.historyStatus.mockResolvedValue({approval_required:true,can_start:false,state:'not_started'});render(<InboxHistoryImport connectionId="c" generation={1} canConfigure/>);fireEvent.click(screen.getByText('Recent Inbox history'));await screen.findByText('Privacy approval required before importing customer messages.');expect(screen.queryByRole('button',{name:'Import recent Inbox history'})).toBeNull();expect(inboxService.requestHistory).not.toHaveBeenCalled();
});
it('requests only an approved bounded import and labels completeness honestly',async()=>{
 inboxService.historyStatus.mockResolvedValueOnce({approval_required:false,can_start:true,state:'not_started'}).mockResolvedValue({approval_required:false,can_start:false,state:'queued'});inboxService.requestHistory.mockResolvedValue('job');render(<InboxHistoryImport connectionId="c" generation={1} canConfigure/>);fireEvent.click(screen.getByText('Recent Inbox history'));fireEvent.click(await screen.findByRole('button',{name:'Import recent Inbox history'}));await waitFor(()=>expect(inboxService.requestHistory).toHaveBeenCalledWith('c'));expect(await screen.findByText(/Historical completeness is not guaranteed/)).toBeTruthy();
});
