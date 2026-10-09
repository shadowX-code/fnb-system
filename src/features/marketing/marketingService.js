import { supabase } from '../../lib/supabase';
import { throwSupabaseError } from '../../services/supabaseError.js';

async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  throwSupabaseError(`marketing.${name}`, error);
  return data;
}
export const marketingService = {
  context: () => rpc('marketing_context'),
  detail: contentId => rpc('marketing_content_detail', { p_content: contentId }),
  read: ({ organizationId, brandId, section, from = null, to = null, page = 1, pageSize = 20 }) => rpc('marketing_read', {
    p_org: organizationId, p_brand: brandId || null, p_surface: section, p_from: from, p_to: to, p_page: page, p_page_size: pageSize,
  }),
  listing: ({ organizationId, brandId, kind, page, pageSize }) => rpc('marketing_listing', { p_org: organizationId, p_brand: brandId || null, p_kind: kind, p_page: page, p_page_size: pageSize }),
  setup: organizationId => rpc('marketing_setup_options', { p_org: organizationId }),
  structure: (command, organizationId, payload) => rpc('platform_organization_command', { p_command: command, p_org: organizationId || null, p_payload: payload }),
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
    const { data, error } = await supabase.storage.from('marketing-media').createSignedUrl(asset.object_path, 300);
    throwSupabaseError('marketing.asset_url', error);
    return data.signedUrl;
  },
};
