import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MetaConnections, PublishAuthorization } from '../MetaIntegrationPanels.jsx';
import { marketingService } from '../marketingService.js';
vi.mock('../../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'actor' }, hasPermission: () => true }) }));
vi.mock('../marketingService.js', () => ({ marketingService: { metaConfiguration: vi.fn(), integrations: vi.fn(), pendingMeta: vi.fn(), authorizeMeta: vi.fn(), bindMeta: vi.fn(), diagnoseMeta: vi.fn(), retryMetaSync: vi.fn(), execute: vi.fn() } }));
const connection = { id: 'conn', brand_id: 'brand', channel: 'facebook', account_name: 'QA Test Page', provider_account_id: '111', status: 'test_authorized', expires_at: '2099-01-01T00:00:00Z', capabilities: { publishing: true, formats: ['text'], execution_enabled: true, posts: true } };
beforeEach(() => { vi.resetAllMocks();marketingService.metaConfiguration.mockResolvedValue({ configured: false, missing: ['MARKETING_META_APP_ID'] });marketingService.integrations.mockResolvedValue({ connections: [], worker: null });marketingService.pendingMeta.mockResolvedValue([]); });
afterEach(cleanup);
describe('Meta capability UI', () => {
 it('shows missing setup and disables authorization without provider configuration', async () => {
  render(<MetaConnections organizationId="org" brandId="brand" brands={[]} />);
  await screen.findByText(/Missing server configuration/);
  expect(screen.getByRole('button', { name: 'Connect / reconnect Meta' }).disabled).toBe(true);
  expect(marketingService.authorizeMeta).not.toHaveBeenCalled();expect(marketingService.execute).not.toHaveBeenCalled();
 });
 it('binds a verified account without requesting publishing', async () => {
  marketingService.metaConfiguration.mockResolvedValue({ configured: true, missing: [] });
  marketingService.pendingMeta.mockResolvedValue([{ id: 'session', accounts: [{ id: '111', channel: 'facebook', name: 'QA Test Page', capabilities: { publishing: true } }] }]);
  marketingService.bindMeta.mockResolvedValue({ connection });
  render(<MetaConnections organizationId="org" brandId="brand" brands={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Connect to brand' }));
  await waitFor(() => expect(marketingService.bindMeta).toHaveBeenCalledWith('session', '111', 'facebook'));
  expect(marketingService.execute).not.toHaveBeenCalled();
 });
 it('disables synchronization for expired authorization and discards a stale scope response', async () => {
  let resolve;marketingService.integrations.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ connections: [{ ...connection, expires_at: '2000-01-01T00:00:00Z' }] });
  const view = render(<MetaConnections organizationId="old" brandId="brand" brands={[]} />);
  view.rerender(<MetaConnections organizationId="new" brandId="brand" brands={[]} />);
  await screen.findByText(/Expired · Expires/);expect(screen.getByRole('button', { name: 'Sync posts' }).disabled).toBe(true);
  resolve({ connections: [{ ...connection, account_name: 'Stale private account' }] });
  await waitFor(() => expect(screen.queryByText(/Stale private account/)).toBeNull());
 });
 it('checks an errored connection read-only without reconnecting or enabling publishing',async()=>{
  marketingService.metaConfiguration.mockResolvedValue({configured:true,missing:[]});
  marketingService.integrations.mockResolvedValue({connections:[{...connection,status:'error',capabilities:{posts:true,publishing:false,execution_enabled:false}}]});
  marketingService.diagnoseMeta.mockResolvedValue({channel:'facebook',token:{type:'PAGE',valid:true},credential_identity_matches:true,evidence:[{check:'facebook_sync',http_status:403,graph_error_code:10,graph_error_subcode:null,error_permissions:[]}]});
  render(<MetaConnections organizationId="org" brandId="brand" brands={[]} />);
  fireEvent.click(await screen.findByRole('button',{name:'Check connection'}));
  await screen.findByText(/Facebook Sync · HTTP 403 · Graph 10/);
  expect(marketingService.diagnoseMeta).toHaveBeenCalledWith('conn');expect(marketingService.authorizeMeta).not.toHaveBeenCalled();expect(marketingService.bindMeta).not.toHaveBeenCalled();expect(marketingService.execute).not.toHaveBeenCalled();
 });
 it('retries only the read workflow for a failed Facebook connection',async()=>{
  marketingService.metaConfiguration.mockResolvedValue({configured:true,missing:[]});
  marketingService.integrations.mockResolvedValue({connections:[{...connection,status:'error',error_code:'meta_permission_or_token_invalid',capabilities:{posts:true,publishing:false,execution_enabled:false}}]});
  marketingService.retryMetaSync.mockResolvedValue({});
  render(<MetaConnections organizationId="org" brandId="brand" brands={[]} />);
  fireEvent.click(await screen.findByRole('button',{name:'Retry sync'}));
  await waitFor(()=>expect(marketingService.retryMetaSync).toHaveBeenCalledWith('conn'));
  expect(marketingService.bindMeta).not.toHaveBeenCalled();expect(marketingService.authorizeMeta).not.toHaveBeenCalled();expect(marketingService.execute).not.toHaveBeenCalled();
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
