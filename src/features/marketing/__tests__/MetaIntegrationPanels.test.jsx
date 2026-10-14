import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MetaConnections, PublishAuthorization } from '../MetaIntegrationPanels.jsx';
import { marketingService } from '../marketingService.js';
vi.mock('../../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'actor' }, hasPermission: () => true }) }));
vi.mock('../marketingService.js', () => ({ marketingService: { metaConfiguration: vi.fn(), integrations: vi.fn(), pendingMeta: vi.fn(), authorizeMeta: vi.fn(), bindMeta: vi.fn(), diagnoseMeta: vi.fn(), retryMetaSync: vi.fn(), socialAccounts:vi.fn(),refreshMetaHealth:vi.fn(),bindMetaSelection:vi.fn(),subscriptionPlan:vi.fn(),installMetaSubscriptions:vi.fn(), execute: vi.fn() } }));
const connection = { id: 'conn', brand_id: 'brand', channel: 'facebook', account_name: 'QA Test Page', provider_account_id: '111', status: 'test_authorized', expires_at: '2099-01-01T00:00:00Z', capabilities: { publishing: true, formats: ['text'], execution_enabled: true, posts: true } };
beforeEach(() => { vi.resetAllMocks();marketingService.metaConfiguration.mockResolvedValue({ configured: false, missing: ['MARKETING_META_APP_ID'] });marketingService.integrations.mockResolvedValue({ connections: [], worker: null });marketingService.socialAccounts.mockResolvedValue({connections:[]});marketingService.pendingMeta.mockResolvedValue([]); });
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
