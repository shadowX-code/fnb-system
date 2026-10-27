import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import CreatorFollowers from '../CreatorFollowers.jsx';
import {creatorService} from '../creatorService.js';
vi.mock('../creatorService.js',()=>({creatorService:{followersStatus:vi.fn(),refreshFollowers:vi.fn()}}));
afterEach(cleanup);
it('hides legacy staff counts and never exposes manual entry',()=>{render(<CreatorFollowers org="org" account={{id:'a',followers:999,followers_sync_status:'unsupported'}} canRefresh/>);expect(screen.queryByText('999')).toBeNull();expect(screen.queryByRole('spinbutton')).toBeNull();expect(screen.getByRole('button',{name:'Refresh Followers'}).disabled).toBe(true)});
it('preserves a genuine zero with official provenance during failure',()=>{render(<CreatorFollowers org="org" account={{id:'a',followers:0,followers_source:'meta_facebook_page',followers_captured_at:'2026-10-15T12:00:00Z',followers_sync_status:'failed',followers_sync_reason:'provider_read_failed'}}/>);expect(screen.getByText('0')).toBeTruthy();expect(screen.getByText(/Meta Facebook Page/)).toBeTruthy();expect(screen.getByText(/Last successful data is retained/)).toBeTruthy()});
it('Refresh only queues a canonical request and prevents duplicate submission',async()=>{let resolve;creatorService.refreshFollowers.mockReturnValue(new Promise(r=>resolve=r));render(<CreatorFollowers org="org" account={{id:'a',followers_sync_status:'unavailable'}} canRefresh/>);fireEvent.click(screen.getByRole('button',{name:'Refresh Followers'}));expect(screen.getByRole('button',{name:'Requesting…'}).disabled).toBe(true);resolve({followers_sync_status:'queued'});await screen.findByText('Queued for sync');expect(screen.getByRole('button',{name:'Refresh Followers'}).disabled).toBe(true);expect(creatorService.refreshFollowers).toHaveBeenCalledWith('org','a')});

it('explains the reviewed public Page feature dependency without offering manual counts',()=>{render(<CreatorFollowers account={{id:'a',platform:'facebook',followers_sync_status:'unavailable',followers_sync_reason:'facebook_public_page_access_required'}}/>);expect(screen.getByText(/PPMA\/PPCA/)).toBeTruthy();expect(screen.getByText(/Reconnecting alone does not grant it/)).toBeTruthy();expect(screen.queryByRole('spinbutton')).toBeNull()});

it('uses one combined profile action and never queues against missing workspace authorization',async()=>{
 creatorService.refreshFollowers.mockClear();const onRefreshProfile=vi.fn().mockResolvedValue({metadata_status:'unavailable',reason:'organization_profile_authorization_required'});
 render(<CreatorFollowers org="org" account={{id:'a',platform:'instagram',followers:12,followers_source:'meta_instagram_business_discovery',followers_sync_status:'ready'}} canRefresh onRefreshProfile={onRefreshProfile}/>);
 expect(screen.queryByRole('button',{name:'Refresh Followers'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Refresh Profile'}));await screen.findByText('Workspace authorization required');expect(screen.getByText('12')).toBeTruthy();expect(creatorService.refreshFollowers).not.toHaveBeenCalled();
});

it('does not let a late old status read overwrite a newer server-persisted follower observation',async()=>{
 let resolve;creatorService.followersStatus.mockReturnValueOnce(new Promise(r=>{resolve=r}));
 const old={id:'a',platform:'instagram',followers:31,followers_source:'meta_instagram_business_discovery',followers_captured_at:'2026-10-17T00:00:00Z',followers_sync_status:'ready'};
 const {rerender}=render(<CreatorFollowers org="org" account={old}/>);rerender(<CreatorFollowers org="org" account={{...old,followers:0,followers_captured_at:'2026-10-28T00:00:00Z'}}/>);
 resolve(old);await screen.findByText('0');expect(screen.queryByText('31')).toBeNull();
});
