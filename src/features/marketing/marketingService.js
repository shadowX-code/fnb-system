import { supabase } from '../../lib/supabase';
import { throwSupabaseError } from '../../services/supabaseError.js';

async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  throwSupabaseError(`marketing.${name}`, error);
  return data;
}
const metaBase = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketing-meta`;
async function meta(command, body) {
  const { data, error } = await supabase.functions.invoke(`marketing-meta/${command}`, { body });
  if (error) {
    let message = 'Meta connection could not be completed. Reload or reconnect and try again.';
    if (error.context instanceof Response) { try { const value = await error.context.json(); message = value.error || message; } catch {} }
    throw new Error(message);
  }
  return data;
}
export const marketingService = {
  observedGrowth:(org,brand)=>rpc("marketing_social_observed_growth",{p_org:org,p_brand:brand||null}),
  async metaConfiguration() { const response = await fetch(`${metaBase}/configuration`, { cache: 'no-store' }); if (!response.ok) throw new Error('Meta configuration could not be checked.'); return response.json(); },
  integrations: (organizationId, brandId, surface = 'settings', page = 1) => rpc('marketing_integrations', { p_org: organizationId, p_brand: brandId || null, p_surface: surface, p_page: page }),
  pendingMeta: (organizationId, brandId) => rpc('marketing_meta_pending', { p_org: organizationId, p_brand: brandId }),
  authorizeMeta: (organizationId, brandId, connectionId = null) => meta('authorize', { organizationId, brandId, connectionId }),
  socialAccounts: (organizationId, brandId) => rpc('marketing_social_accounts', { p_org: organizationId, p_brand: brandId || null }),
  refreshMetaHealth: connectionId => meta('health', { connectionId }),
  subscriptionPlan: connectionId => meta('subscription-plan', { connectionId }),
  installMetaSubscriptions: (connectionId, requestId, expectedPlan) => meta('subscriptions', { connectionId, requestId, expectedPlan, approveSubscriptions: true }),
  bindMetaSelection: (sessionId, brandId, assets, approveSubscriptions) => meta('bind', { sessionId, brandId, assets, confirmOwnership: true, approveSubscriptions }),
  retryMetaSync: connectionId => meta('retry-sync', { connectionId }),
  diagnoseMeta: connectionId => meta('diagnose', { connectionId, readOnly: true }),
  disconnectMeta: connectionId => rpc('marketing_meta_disconnect', { p_connection: connectionId }),
  syncMeta: connectionId => rpc('marketing_meta_request_sync', { p_connection: connectionId }),
  execute: (requestId, content, connections) => rpc('marketing_authorize_execution', { p_request: requestId, p_content: content.id, p_revision: content.revision, p_connections: connections }),
  contentManagement: ({ organizationId, brandId, from = null, to = null, search = '', channel = '', status = '', sort = 'date_desc', group = '', page = 1, pageSize = 20, view = 'list' }) => rpc('marketing_content_management', {
    p_org: organizationId, p_brand: brandId || null, p_from: from, p_to: to, p_search: search, p_channel: channel, p_status: status, p_sort: sort, p_group: group, p_page: page, p_page_size: pageSize, p_view: view,
  }),
  context: () => rpc('marketing_brand_context'),
  detail: contentId => rpc('marketing_content_detail', { p_content: contentId }),
  read: ({ organizationId, brandId, section, from = null, to = null, page = 1, pageSize = 20 }) => rpc('marketing_read', {
    p_org: organizationId, p_brand: brandId || null, p_surface: section, p_from: from, p_to: to, p_page: page, p_page_size: pageSize,
  }),
  listing: ({ organizationId, brandId, kind, page, pageSize }) => rpc('marketing_listing', { p_org: organizationId, p_brand: brandId || null, p_kind: kind, p_page: page, p_page_size: pageSize }),
  setup: organizationId => rpc('marketing_setup_options', { p_org: organizationId }),
  teamAccess: (command, brandId, payload) => rpc('platform_team_access_command', { p_command: command, p_scope_brand: brandId || null, p_payload: payload }),
  roleScope: (organizationId, roleId, all, brands) => rpc('marketing_set_role_scope', { p_org: organizationId, p_role: roleId, p_all: all, p_brands: brands }),
  knowledge: (brandId, revision, profile) => rpc('marketing_save_knowledge', { p_brand: brandId, p_expected_revision: revision, p_profile: profile }),
  content: ({ requestId, command, organizationId, brandId, content, payload = {} }) => rpc('marketing_content_command', {
    p_request_id: requestId, p_command: command, p_org: organizationId, p_brand: brandId,
    p_content_id: content?.id || null, p_expected_revision: content?.revision || 0, p_payload: payload,
  }),
  async upload(organizationId, brandId, file) {
    const asset = await rpc('marketing_prepare_asset', { p_org: organizationId, p_brand: brandId, p_filename: file.name, p_mime: file.type, p_size: file.size });
    const { error } = await supabase.storage.from(asset.bucket).upload(asset.object_path, file, { contentType: file.type, upsert: false });
    throwSupabaseError('marketing.upload', error);
    return rpc('marketing_finalize_asset', { p_asset: asset.id });
  },
  async assetUrl(asset) {
    if (['retiring','retired'].includes(asset.state)) throw new Error('Publishing snapshot no longer stored. Source and approval evidence remain available.');
    const { data, error } = await supabase.storage.from('marketing-media').createSignedUrl(asset.object_path, 300);
    throwSupabaseError('marketing.asset_url', error);
    return data.signedUrl;
  },
};
