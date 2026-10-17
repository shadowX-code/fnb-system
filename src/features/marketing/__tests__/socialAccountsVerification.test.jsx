import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import SocialAccounts from '../SocialAccounts.jsx';
import {marketingService} from '../marketingService.js';
const state=vi.hoisted(()=>({configure:true}));
vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>({user:{id:'actor'},hasPermission:(p)=>state.configure&&p==='marketing_settings.configure'})}));
vi.mock('../marketingService.js',()=>({marketingService:{metaConfiguration:vi.fn(),socialAccounts:vi.fn(),pendingMeta:vi.fn(),refreshMetaHealth:vi.fn()}}));
const account={id:'connection',brand_id:'brand',account_name:'Verified Page',channel:'facebook',status:'test_authorized',expires_at:'2099-01-01',credential_generation:1,capabilities:{posts:true},health:{publishing:{state:'verified',reason:'ready'},messaging:{state:'awaiting_first_delivery',reason:'inbound_pending'}},messaging:{state:'permission_unavailable',configuration_verified:true,receiving_verified:false}};
beforeEach(()=>{vi.clearAllMocks();state.configure=true;marketingService.metaConfiguration.mockResolvedValue({configured:true});marketingService.socialAccounts.mockResolvedValue({connections:[account]});marketingService.pendingMeta.mockResolvedValue([]);marketingService.refreshMetaHealth.mockResolvedValue({state:'verification_pending'});});
afterEach(cleanup);
const open=async()=>{render(<SocialAccounts organizationId="org" brandId="brand" brands={[{id:'brand',name:'Brand'}]}/>);fireEvent.click(await screen.findByRole('button',{name:'Open connection Verified Page'}));};
it('shows the real blocker and queues one canonical Retry Verification without reconnecting',async()=>{
 await open();expect(screen.queryByText('Awaiting First Delivery')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Retry Verification'}));
 await waitFor(()=>expect(marketingService.refreshMetaHealth).toHaveBeenCalledExactlyOnceWith('connection'));
 expect(await screen.findByText('Verification queued. FeedX will update this account automatically.')).toBeTruthy();
});
it('reserves Reconnect for expired authority and hides mutation controls from viewers',async()=>{
 marketingService.socialAccounts.mockResolvedValue({connections:[{...account,expires_at:'2000-01-01'}]});await open();
 expect(screen.getByRole('button',{name:'Reconnect'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Retry Verification'})).toBeNull();cleanup();
 state.configure=false;await open();expect(screen.queryByRole('button',{name:'Reconnect'})).toBeNull();expect(screen.queryByRole('button',{name:'Retry Verification'})).toBeNull();
});
