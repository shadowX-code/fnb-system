import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MetaConnections, PublishAuthorization } from '../MetaIntegrationPanels.jsx';
import { marketingService } from '../marketingService.js';
vi.mock('../../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'actor' }, hasPermission: () => true }) }));
vi.mock('../marketingService.js', () => ({ marketingService: { metaConfiguration: vi.fn(), integrations: vi.fn(), pendingMeta: vi.fn(), authorizeMeta: vi.fn(), bindMeta: vi.fn(), diagnoseMeta: vi.fn(), retryMetaSync: vi.fn(), socialAccounts:vi.fn(),refreshMetaHealth:vi.fn(),bindMetaSelection:vi.fn(),subscriptionPlan:vi.fn(),installMetaSubscriptions:vi.fn(), content:vi.fn(),execute: vi.fn() } }));
const connection = { id: 'conn',organization_id:'org',credential_generation:7, brand_id: 'brand', channel: 'facebook', account_name: 'QA Test Page', provider_account_id: '111', status: 'test_authorized', expires_at: '2099-01-01T00:00:00Z', capabilities: { publishing: true, formats: ['text'], execution_enabled: true, posts: true } };
beforeEach(() => { vi.resetAllMocks();marketingService.metaConfiguration.mockResolvedValue({ configured: false, missing: ['MARKETING_META_APP_ID'],test_execution_configured:true });marketingService.integrations.mockResolvedValue({ connections: [], worker: null });marketingService.socialAccounts.mockResolvedValue({connections:[]});marketingService.pendingMeta.mockResolvedValue([]); });
afterEach(cleanup);
describe('Social Accounts', () => {
 it('keeps server setup out of ordinary onboarding and disables OAuth when unavailable',async()=>{
  render(<MetaConnections organizationId="org" brandId="brand" brands={[{id:'brand',name:'QA Brand'}]}/>);
  await screen.findByText(/Social connections need FeedX administrator setup/);
  expect(screen.getByRole('button',{name:'Connect Account'}).disabled).toBe(true);expect(screen.queryByText(/MARKETING_META_APP_ID/)).toBeNull();
 });
 it('opens a brand selection workflow from the organization-wide view',async()=>{
  marketingService.metaConfiguration.mockResolvedValue({configured:true});render(<MetaConnections organizationId="org" brandId="" brands={[{id:'brand',name:'QA Brand'}]}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Connect Account'}));expect(await screen.findByRole('dialog',{name:'Connect Social Account'})).toBeTruthy();expect(screen.getByRole('button',{name:'Continue to Meta'}).disabled).toBe(true);expect(screen.getByRole('button',{name:'FeedX brand'})).toBeTruthy();expect(marketingService.authorizeMeta).not.toHaveBeenCalled();
 });
 it('requires exact asset selection and brand confirmation, without enabling execution',async()=>{
  marketingService.metaConfiguration.mockResolvedValue({configured:true});marketingService.pendingMeta.mockResolvedValue([{id:'session',expires_at:'2099-01-01',accounts:[{id:'111',channel:'facebook',name:'QA Page',available:true,current_connection_id:null,current_generation:null}]}]);marketingService.bindMetaSelection.mockResolvedValue({connections:[connection]});
  render(<MetaConnections organizationId="org" brandId="brand" brands={[{id:'brand',name:'QA Brand'}]}/>);
  const dialog=await screen.findByRole('dialog',{name:'Select accounts & confirm brand'});const confirm=screen.getByRole('button',{name:'Confirm connection'});expect(confirm.disabled).toBe(true);fireEvent.click(screen.getByRole('checkbox',{name:/QA Page/}));expect(confirm.disabled).toBe(true);fireEvent.click(screen.getByRole('checkbox',{name:/I confirm that/}));fireEvent.click(confirm);
  await waitFor(()=>expect(marketingService.bindMetaSelection).toHaveBeenCalledWith('session','brand',[{id:'111',channel:'facebook',expectedConnectionId:null,expectedGeneration:null}],true));expect(marketingService.execute).not.toHaveBeenCalled();
 });
 it('blocks cross-brand candidates and mismatched Page/Instagram pairs',async()=>{
  marketingService.metaConfiguration.mockResolvedValue({configured:true});marketingService.pendingMeta.mockResolvedValue([{id:'session',expires_at:'2099-01-01',accounts:[{id:'111',channel:'facebook',name:'Owned Page',available:false},{id:'112',channel:'facebook',name:'Available Page',available:true},{id:'222',page_id:'113',channel:'instagram',name:'Wrong pair',available:true}]}]);
  render(<MetaConnections organizationId="org" brandId="brand" brands={[{id:'brand',name:'QA Brand'}]}/>);await screen.findByRole('dialog');expect(screen.getByRole('checkbox',{name:/Owned Page/}).disabled).toBe(true);fireEvent.click(screen.getByRole('checkbox',{name:/Available Page/}));fireEvent.click(screen.getByRole('checkbox',{name:/Wrong pair/}));fireEvent.click(screen.getByRole('checkbox',{name:/I confirm that/}));expect(screen.getByRole('button',{name:'Confirm connection'}).disabled).toBe(true);expect(screen.getByRole('alert').textContent).toMatch(/linked/);
 });
 it('shows configuration readiness without manual checks, OAuth changes or execution',async()=>{
  marketingService.metaConfiguration.mockResolvedValue({configured:true});marketingService.socialAccounts.mockResolvedValue({connections:[{...connection,capabilities:{posts:true,publishing:true,insights:true,execution_enabled:false},messaging:{configuration_verified:true,receiving_verified:true,delivery_verified:false}}]});
  render(<MetaConnections organizationId="org" brandId="brand" brands={[{id:'brand',name:'QA Brand'}]}/>);
  await screen.findByText(/Awaiting First Delivery/);fireEvent.click(screen.getByRole('button',{name:'View connection QA Test Page'}));expect(screen.getByText(/Configuration verified. Delivery/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Refresh Status'})).toBeNull();expect(screen.queryByRole('button',{name:'Reconnect'})).toBeNull();expect(screen.queryByRole('button',{name:'Resolve Issue'})).toBeNull();
  expect(marketingService.refreshMetaHealth).not.toHaveBeenCalled();expect(marketingService.authorizeMeta).not.toHaveBeenCalled();expect(marketingService.bindMetaSelection).not.toHaveBeenCalled();expect(marketingService.execute).not.toHaveBeenCalled();
 });
 it('surfaces actionable access failures separately from diagnostics',async()=>{
  marketingService.metaConfiguration.mockResolvedValue({configured:true});marketingService.socialAccounts.mockResolvedValue({connections:[{...connection,capabilities:{insights:true},health:{messaging:{state:'permission_required',reason:'permission_missing'}}}]});
  render(<MetaConnections organizationId="org" brandId="brand" brands={[{id:'brand',name:'QA Brand'}]}/>);
  fireEvent.click(await screen.findByRole('button',{name:'View connection QA Test Page'}));fireEvent.click(screen.getByRole('button',{name:'Resolve Issue'}));expect(await screen.findByRole('dialog',{name:'Account access · QA Test Page'})).toBeTruthy();expect(marketingService.installMetaSubscriptions).not.toHaveBeenCalled();
 });
 it('discards stale tenant responses and offers reconnect for expired tokens',async()=>{
  let resolve;marketingService.socialAccounts.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({connections:[{...connection,expires_at:'2000-01-01'}]});marketingService.metaConfiguration.mockResolvedValue({configured:true});const view=render(<MetaConnections organizationId="old" brandId="brand" brands={[]}/>);view.rerender(<MetaConnections organizationId="new" brandId="brand" brands={[]}/>);await screen.findByText('Expired');fireEvent.click(screen.getByRole('button',{name:'View connection QA Test Page'}));expect(screen.getByRole('button',{name:'Sync posts'}).disabled).toBe(true);resolve({connections:[{...connection,account_name:'Stale private account'}]});await waitFor(()=>expect(screen.queryByText('Stale private account')).toBeNull());
 });
 it('requires explicit approval and passes the reviewed revision and accounts to server authority', async () => {
  marketingService.integrations.mockResolvedValue({ connections: [connection] });marketingService.execute.mockResolvedValue({});
  const content = { id: 'content', organization_id: 'org', brand_id: 'brand', revision: 4, status: 'scheduled', scheduled_at: '2099-01-01T00:00:00Z', payload: { variants: [{ channel: 'facebook', format: 'text' }] } }, complete = vi.fn();
  render(<PublishAuthorization content={content} onComplete={complete} />);
  await screen.findByText(/QA Test Page/);
  const button = screen.getByRole('button', { name: 'Authorize external publishing' });expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(button);
  await waitFor(() => expect(marketingService.execute).toHaveBeenCalledWith(expect.any(String), content, ['conn']));expect(complete).toHaveBeenCalledOnce();
 });
});

it('offers Inbox OAuth only when configured and preserves explicit reconnect scope',async()=>{
 marketingService.metaConfiguration.mockResolvedValue({configured:true,oauth_routes:{publishing:{available:true},messaging:{available:true}}});
 marketingService.socialAccounts.mockResolvedValue({connections:[{...connection,expires_at:'2000-01-01'}]});
 marketingService.authorizeMeta.mockRejectedValue(new Error('Stopped before external OAuth'));
 render(<MetaConnections organizationId="org" brandId="brand" brands={[{id:'brand',name:'QA Brand'}]}/>);
 fireEvent.click(await screen.findByRole('button',{name:'View connection QA Test Page'}));
 fireEvent.click(screen.getByRole('button',{name:'Reconnect'}));
 fireEvent.click(screen.getByRole('button',{name:'Connection purpose'}));
 fireEvent.click(screen.getByRole('option',{name:'Inbox, publishing & analytics'}));
 fireEvent.click(screen.getByRole('button',{name:'Continue to Meta'}));
 await waitFor(()=>expect(marketingService.authorizeMeta).toHaveBeenCalledWith('org','brand','conn','messaging'));
 expect(marketingService.bindMetaSelection).not.toHaveBeenCalled();
 expect(marketingService.installMetaSubscriptions).not.toHaveBeenCalled();
});
it('does not offer an unavailable Messaging route',async()=>{
 marketingService.metaConfiguration.mockResolvedValue({configured:true,oauth_routes:{publishing:{available:true},messaging:{available:false}}});
 render(<MetaConnections organizationId="org" brandId="brand" brands={[{id:'brand',name:'QA Brand'}]}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Connect Account'}));
 fireEvent.click(screen.getByRole('button',{name:'Connection purpose'}));
 expect(screen.getByRole('option',{name:'Inbox, publishing & analytics'}).disabled).toBe(true);
 expect(marketingService.authorizeMeta).not.toHaveBeenCalled();
});

 it('blocks FB video authorization behind its independent opt-in even with eligible account evidence',async()=>{
  marketingService.integrations.mockResolvedValue({connections:[{...connection,capabilities:{publishing:true,execution_enabled:true,formats:['video']}}]});
  marketingService.metaConfiguration.mockResolvedValue({configured:true,facebook_video_execution_enabled:false});
  render(<PublishAuthorization content={{id:'video',organization_id:'org',brand_id:'brand',revision:1,status:'scheduled',scheduled_at:'2099-01-01',payload:{variants:[{channel:'facebook',format:'video'}]}}} onComplete={vi.fn()}/>);
  await screen.findByText(/QA Test Page/);expect(screen.getByRole('button',{name:'Authorize external publishing'}).disabled).toBe(true);expect(screen.getByRole('checkbox').disabled).toBe(true);expect(marketingService.execute).not.toHaveBeenCalled();
 });

it('authorizes only the pending sibling of a partially published revision',async()=>{
 marketingService.integrations.mockResolvedValue({connections:[{...connection,id:'ig',channel:'instagram',capabilities:{publishing:true,execution_enabled:true,formats:['image']}}]});
 const content={id:'partial',organization_id:'org',brand_id:'brand',revision:2,status:'failed',scheduled_at:'2099-01-01',payload:{variants:[{channel:'facebook',format:'text'},{channel:'instagram',format:'image'}]},channels:[{channel:'facebook',job_state:'succeeded'},{channel:'instagram',job_state:'blocked'}]};
 render(<PublishAuthorization content={content} onComplete={vi.fn()}/>);await screen.findByText(/QA Test Page/);fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Authorize external publishing'}));await waitFor(()=>expect(marketingService.execute).toHaveBeenCalledWith(expect.any(String),content,['ig']));
});

it('requires explicit direct-publisher confirmation and pins exact account generation through one canonical command',async()=>{marketingService.metaConfiguration.mockResolvedValue({test_execution_configured:true});marketingService.integrations.mockResolvedValue({connections:[connection]});marketingService.content.mockResolvedValue({status:'scheduled'});const complete=vi.fn();const content={id:'draft',organization_id:'org',brand_id:'brand',revision:3,status:'draft',payload:{variants:[{channel:'facebook',format:'text',caption:'Verified draft',asset_ids:[]}]}};render(<PublishAuthorization content={content} intent={{mode:'now'}} onComplete={complete}/>);await screen.findByText(/QA Test Page/);const confirm=screen.getByRole('button',{name:'Confirm Publish'});expect(confirm.disabled).toBe(true);fireEvent.click(screen.getByRole('checkbox',{name:/I approve sending/}));fireEvent.click(confirm);fireEvent.click(confirm);await waitFor(()=>expect(complete).toHaveBeenCalledOnce());expect(marketingService.content).toHaveBeenCalledOnce();expect(marketingService.content.mock.calls[0][0]).toMatchObject({command:'publish_now',content,payload:{confirm:true,timezone:'Asia/Kuala_Lumpur',accounts:[{connection_id:'conn',generation:7,channel:'facebook',provider_account_id:'111'}]}});expect(marketingService.execute).not.toHaveBeenCalled();});
it('keeps direct publishing disabled when the runtime gate is off even for eligible connections',async()=>{marketingService.metaConfiguration.mockResolvedValue({test_execution_configured:false,production_execution_enabled:false});marketingService.integrations.mockResolvedValue({connections:[connection]});render(<PublishAuthorization content={{id:'draft',organization_id:'org',brand_id:'brand',revision:1,status:'draft',payload:{variants:[{channel:'facebook',format:'text',caption:'Draft',asset_ids:[]}]}}} intent={{mode:'now'}}/>);await screen.findByText(/Publishing execution is disabled/);expect(screen.getByRole('button',{name:'Confirm Publish'}).disabled).toBe(true);expect(marketingService.content).not.toHaveBeenCalled();});
it('retains a stable request for a failed direct confirmation retry',async()=>{marketingService.metaConfiguration.mockResolvedValue({test_execution_configured:true});marketingService.integrations.mockResolvedValue({connections:[connection]});marketingService.content.mockRejectedValueOnce(new Error('Authorization unavailable')).mockResolvedValueOnce({});render(<PublishAuthorization content={{id:'draft',organization_id:'org',brand_id:'brand',revision:1,status:'draft',payload:{variants:[{channel:'facebook',format:'text',caption:'Draft',asset_ids:[]}]}}} intent={{mode:'now'}} onComplete={()=>{}}/>);await screen.findByText(/QA Test Page/);fireEvent.click(screen.getByRole('checkbox',{name:/I approve sending/}));fireEvent.click(screen.getByRole('button',{name:'Confirm Publish'}));await screen.findByText('Authorization unavailable');fireEvent.click(screen.getByRole('button',{name:'Confirm Publish'}));await waitFor(()=>expect(marketingService.content).toHaveBeenCalledTimes(2));expect(marketingService.content.mock.calls[0][0].requestId).toBe(marketingService.content.mock.calls[1][0].requestId);});

it('confirms a future Malaysia schedule without using the legacy approval scheduler',async()=>{
 marketingService.metaConfiguration.mockResolvedValue({test_execution_configured:true});marketingService.integrations.mockResolvedValue({connections:[connection]});marketingService.content.mockResolvedValue({status:'scheduled'});
 render(<PublishAuthorization content={{id:'draft',organization_id:'org',brand_id:'brand',revision:2,status:'draft',payload:{variants:[{channel:'facebook',format:'text',caption:'Scheduled draft',asset_ids:[]}]}}} intent={{mode:'schedule',scheduled_at:'2099-01-02T02:30:00.000Z'}} onComplete={()=>{}}/>);
 await screen.findByText(/QA Test Page/);expect(screen.getByText('Asia/Kuala_Lumpur')).toBeTruthy();fireEvent.click(screen.getByRole('checkbox',{name:/I approve sending/}));fireEvent.click(screen.getByRole('button',{name:'Confirm Schedule'}));await waitFor(()=>expect(marketingService.content).toHaveBeenCalledOnce());expect(marketingService.content.mock.calls[0][0]).toMatchObject({command:'schedule_publish',payload:{confirm:true,timezone:'Asia/Kuala_Lumpur',scheduled_at:'2099-01-02T02:30:00.000Z'}});expect(marketingService.execute).not.toHaveBeenCalled();
});
it.each([['facebook','video','facebook_video'],['facebook','reel','facebook_reel'],['instagram','carousel','instagram_mixed_carousel']])('routine %s/%s confirmation works without QA switches but still requires explicit consent',async(channel,format,key)=>{
 const media=[{id:'pic',mime_type:'image/jpeg'},{id:'vid',mime_type:'video/mp4'}];
 const content={id:'routine',organization_id:'org',brand_id:'brand',revision:1,status:'draft',payload:{variants:[{channel,format,caption:'Exact approved content',asset_ids:format==='carousel'?['pic','vid']:['vid']}]},channels:[{channel,assets:media}]};
 marketingService.integrations.mockResolvedValue({connections:[{...connection,channel,format_authorizations:{[key]:'routine'},capabilities:{publishing:true,execution_enabled:true,formats:[format]}}]});
 marketingService.metaConfiguration.mockResolvedValue({production_execution_enabled:true,facebook_video_execution_enabled:false,instagram_extended_execution_enabled:false});
 render(<PublishAuthorization content={content} intent={{mode:'now'}} onComplete={()=>{}}/>);
 await screen.findByText(/QA Test Page/);const confirm=screen.getByRole('button',{name:'Confirm Publish'});expect(confirm.disabled).toBe(true);fireEvent.click(screen.getByRole('checkbox'));expect(confirm.disabled).toBe(false);expect(marketingService.content).not.toHaveBeenCalled();
});
it('Story remains blocked with forged routine metadata and every QA switch on',async()=>{
 marketingService.metaConfiguration.mockResolvedValue({production_execution_enabled:true,instagram_extended_execution_enabled:true});marketingService.integrations.mockResolvedValue({connections:[{...connection,channel:'instagram',format_authorizations:{instagram_story:'routine'},capabilities:{publishing:true,execution_enabled:true,formats:['story']}}]});
 render(<PublishAuthorization content={{id:'story',organization_id:'org',brand_id:'brand',revision:1,status:'draft',payload:{variants:[{channel:'instagram',format:'story',asset_ids:[]}]}}} intent={{mode:'now'}} onComplete={()=>{}}/>);await screen.findByText(/QA Test Page/);expect(screen.getByRole('checkbox').disabled).toBe(true);expect(screen.getByRole('button',{name:'Confirm Publish'}).disabled).toBe(true);
});

const directDraft={id:'confirmation',organization_id:'org',brand_id:'brand',revision:1,status:'draft',payload:{publishing_plan:'schedule',variants:[{channel:'facebook',format:'text',caption:'Exact saved caption',asset_ids:[]}]}};
it('shows one read-only schedule summary and returns to the editor without changing or sending the revision',async()=>{
 marketingService.integrations.mockResolvedValue({connections:[connection]});const edit=vi.fn();
 render(<PublishAuthorization content={directDraft} brandName="Fixture Brand" intent={{mode:'schedule',scheduled_at:'2099-01-02T02:30:00.000Z'}} onEdit={edit}/>);
 await screen.findByText('QA Test Page');expect(screen.getByText('Fixture Brand')).toBeTruthy();expect(screen.getByText('2 Jan 2099, 10:30 am')).toBeTruthy();
 expect(screen.queryByRole('radiogroup')).toBeNull();expect(screen.queryByRole('textbox')).toBeNull();expect(screen.queryByRole('spinbutton')).toBeNull();expect(screen.getAllByRole('checkbox')).toHaveLength(1);
 expect(screen.getByText('Connection details').closest('details').open).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Back to editor'}));expect(edit).toHaveBeenCalledOnce();expect(marketingService.content).not.toHaveBeenCalled();expect(marketingService.execute).not.toHaveBeenCalled();
});
it.each([{mode:'schedule'},{mode:'schedule',scheduled_at:'not-a-date'},{mode:'schedule',scheduled_at:'2099-01-02'},{mode:'schedule',scheduled_at:'2000-01-02T02:30:00Z'},{},{mode:'draft'}])('fails closed for missing or invalid publishing intent %j',async intent=>{
 marketingService.integrations.mockResolvedValue({connections:[connection]});render(<PublishAuthorization content={directDraft} intent={intent}/>);
 await screen.findByText('QA Test Page');expect(screen.getByRole('checkbox').disabled).toBe(true);expect(screen.getByRole('alert').textContent).toMatch(/Return to the editor/);expect(marketingService.content).not.toHaveBeenCalled();
});
it('invalidates confirmation immediately when the saved revision or publishing intent changes',async()=>{
 marketingService.integrations.mockResolvedValue({connections:[connection]});const view=render(<PublishAuthorization content={directDraft} intent={{mode:'now'}}/>);
 await screen.findByText('QA Test Page');fireEvent.click(screen.getByRole('checkbox'));expect(screen.getByRole('button',{name:'Confirm Publish'}).disabled).toBe(false);
 view.rerender(<PublishAuthorization content={{...directDraft,revision:2}} intent={{mode:'now'}}/>);
 await screen.findByText('QA Test Page');expect(screen.getByRole('checkbox').checked).toBe(false);expect(screen.getByRole('button',{name:'Confirm Publish'}).disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox'));view.rerender(<PublishAuthorization content={{...directDraft,revision:2}} intent={{mode:'schedule',scheduled_at:'2099-01-02T02:30:00.000Z'}}/>);
 await screen.findByText('QA Test Page');expect(screen.getByRole('button',{name:'Confirm Schedule'}).disabled).toBe(true);expect(screen.getByRole('checkbox').checked).toBe(false);expect(marketingService.content).not.toHaveBeenCalled();
});
it('never selects an account from another Brand even when its channel and runtime policy are eligible',async()=>{
 marketingService.integrations.mockResolvedValue({connections:[{...connection,brand_id:'other'}]});marketingService.metaConfiguration.mockResolvedValue({production_execution_enabled:true});
 render(<PublishAuthorization content={directDraft} intent={{mode:'now'}}/>);await screen.findByText('No enabled account for this format');expect(screen.getByRole('checkbox').disabled).toBe(true);expect(marketingService.content).not.toHaveBeenCalled();
});

it('requires reconfirmation after the server rejects a stale revision',async()=>{
 marketingService.integrations.mockResolvedValue({connections:[connection]});const error=new Error('The saved post changed. Reopen the editor.');error.cause={code:'40001'};marketingService.content.mockRejectedValue(error);
 render(<PublishAuthorization content={directDraft} intent={{mode:'now'}} onComplete={vi.fn()}/>);await screen.findByText('QA Test Page');fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Confirm Publish'}));
 await screen.findByText(/The saved post changed/);expect(screen.getByRole('checkbox').checked).toBe(false);expect(screen.getByRole('button',{name:'Confirm Publish'}).disabled).toBe(true);expect(marketingService.content).toHaveBeenCalledOnce();
});

it.each([['facebook','video','facebook_video'],['facebook','reel','facebook_reel'],['instagram','carousel','instagram_mixed_carousel']])('normal %s/%s scheduling needs no legacy grant but still needs exact confirmation',async(channel,format,key)=>{
 const media=[{id:'pic',mime_type:'image/jpeg'},{id:'vid',mime_type:'video/mp4'}];marketingService.metaConfiguration.mockResolvedValue({production_execution_enabled:true,normal_format_execution_enabled:true});
 marketingService.integrations.mockResolvedValue({connections:[{...connection,channel,format_authorizations:{normal_formats:[key]},capabilities:{publishing:true,execution_enabled:true,formats:[format]}}]});
 render(<PublishAuthorization content={{id:'normal',organization_id:'org',brand_id:'brand',revision:1,status:'draft',payload:{variants:[{channel,format,caption:'Exact saved revision',asset_ids:format==='carousel'?['pic','vid']:['vid']}]},channels:[{channel,assets:media}]}} intent={{mode:'schedule',scheduled_at:'2099-01-01T00:00:00Z'}} onComplete={()=>{}}/>);
 await screen.findByText(/QA Test Page/);const button=screen.getByRole('button',{name:'Confirm Schedule'});expect(button.disabled).toBe(true);fireEvent.click(screen.getByRole('checkbox'));expect(button.disabled).toBe(false);expect(screen.queryByText(/separate format authorization/i)).toBeNull();expect(marketingService.content).not.toHaveBeenCalled();
});
