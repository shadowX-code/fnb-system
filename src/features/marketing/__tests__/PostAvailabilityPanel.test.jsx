import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import Panel from '../PostAvailabilityPanel.jsx';
const {save}=vi.hoisted(()=>({save:vi.fn()}));
vi.mock('../marketingService.js',()=>({marketingService:{publicationAvailability:save}}));
const channel={connection_id:'conn',provider_post_id:'111_222',availability:{state:'unavailable',manual_revision:0}};
const confirmed={state:'manually_removed',manual_revision:1,manual_confirmation:{state:'confirmed',actor_name:'Isaac',at:'2026-10-24T10:00:00Z'}};
beforeEach(()=>{cleanup();vi.resetAllMocks();save.mockResolvedValue(confirmed)});
it('requires explicit confirmation and uses the canonical result without changing Published',async()=>{
 const changed=vi.fn();render(<Panel channel={channel} canManage onChanged={changed}/>);
 fireEvent.click(screen.getByRole('button',{name:'Mark as Removed'}));expect(save).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('dialog').querySelector('.btn-primary'));
 await screen.findByText('Removed · staff confirmed');expect(save).toHaveBeenCalledWith(expect.any(String),'conn','111_222',0,'mark_removed');expect(changed).toHaveBeenCalledOnce();expect(screen.getByText(/Staff confirmation: Isaac/)).toBeTruthy();
});
it('preserves request identity and actionable errors on a failed confirmation',async()=>{
 save.mockRejectedValueOnce(new Error('Availability changed. Reopen the post.')).mockResolvedValue(confirmed);
 render(<Panel channel={channel} canManage/>);
 fireEvent.click(screen.getByRole('button',{name:'Mark as Removed'}));fireEvent.click(screen.getByRole('dialog').querySelector('.btn-primary'));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','Availability changed. Reopen the post.');
 fireEvent.click(screen.getByRole('button',{name:'Mark as Removed'}));fireEvent.click(screen.getByRole('dialog').querySelector('.btn-primary'));
 await screen.findByText('Removed · staff confirmed');expect(save.mock.calls[0][0]).toBe(save.mock.calls[1][0]);
});
it('does not show management actions without publish authority',()=>{render(<Panel channel={channel}/>);expect(screen.queryByRole('button')).toBeNull();expect(screen.getByText(/does not prove deletion/)).toBeTruthy()});
it('can clear only manual confirmation and distinguishes a recovered provider observation',async()=>{
 save.mockResolvedValue({state:'available',manual_revision:2,manual_confirmation:{...confirmed.manual_confirmation,state:'cleared'}});
 render(<Panel canManage channel={{...channel,availability:{...confirmed,state:'available',manual_confirmation:{...confirmed.manual_confirmation,state:'conflict'}}}}/>);
 expect(screen.getByText(/Meta observed this post live after/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Clear manual confirmation'}));fireEvent.click(screen.getByRole('dialog').querySelector('.btn-primary'));
 await waitFor(()=>expect(save).toHaveBeenCalledWith(expect.any(String),'conn','111_222',1,'clear_manual'));
});
