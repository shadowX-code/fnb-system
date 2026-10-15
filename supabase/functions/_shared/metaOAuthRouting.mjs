import {serverEnvironment, metaEnvironmentMatches} from './marketingEnvironment.mjs';

// Configuration IDs are provider-owned permission manifests, never client input.
const productionMessagingConfig = '2180882642780186';
export function metaOAuthRoute(purpose = 'publishing', get) {
  if (!['publishing', 'messaging'].includes(purpose)) return null;
  const runtime = serverEnvironment(get);
  const configId = get('MARKETING_META_LOGIN_CONFIG_ID');
  if (!runtime || !get('MARKETING_META_APP_ID') || !configId ||
      !metaEnvironmentMatches(runtime, get('MARKETING_META_APP_ID'), configId)) return null;
  if (purpose === 'publishing') return {purpose, configId};
  if (runtime.environment === 'staging') return {purpose, configId}; // Preserve the existing Staging manifest.
  if (get('MARKETING_META_OAUTH_INBOX_ENABLED') !== 'true' ||
      get('MARKETING_META_OAUTH_PUBLISHING_ENABLED') !== 'true' ||
      get('MARKETING_META_MESSAGING_LOGIN_CONFIG_ID') !== productionMessagingConfig) return null;
  return {purpose, configId: productionMessagingConfig};
}
export function metaOAuthRoutes(get) {
  return Object.fromEntries(['publishing', 'messaging'].map(purpose => [purpose, {
    available: !!metaOAuthRoute(purpose, get),
  }]));
}
