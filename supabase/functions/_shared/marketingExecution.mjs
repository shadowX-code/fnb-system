import {serverEnvironment} from './marketingEnvironment.mjs';
export const executionEnv = key => typeof Deno !== 'undefined' ? Deno.env.get(key) : typeof process !== 'undefined' ? process.env[key] : undefined;
function environment(get) {
 const runtime=serverEnvironment(get);
 return runtime && get('MARKETING_META_APP_ID')===runtime.appId && get('MARKETING_META_LOGIN_CONFIG_ID')===runtime.loginConfigId ? runtime : null;
}
const numericId = value => typeof value==='string'&&/^\d{1,30}$/.test(value);
function mode(get,key) { return get(key)||'controlled'; }
function ids(value) {
 if(typeof value!=='string'||value.length>4096)return [];
 const items=value.split(',').map(s=>s.trim());
 return items.length<=50&&items.every(s=>/^\d{1,30}$/.test(s))?[...new Set(items)]:[];
}
export function publishingConfigured(get=executionEnv) {
 const runtime=environment(get);if(!runtime)return false;
 return runtime.environment==='production'
  ?get('MARKETING_META_PUBLISHING_ENABLED')==='true'&&(mode(get,'MARKETING_META_PUBLISHING_MODE')==='normal'||mode(get,'MARKETING_META_PUBLISHING_MODE')==='controlled'&&ids(get('MARKETING_META_PUBLISH_ACCOUNT_IDS')).length>0)
  :ids(get('MARKETING_META_TEST_ACCOUNT_IDS')).length>0;
}
export function productionPublishingConfigured(get=executionEnv) {
 return environment(get)?.environment==='production'&&publishingConfigured(get);
}
export function publishingAccountAllowed(connection,get=executionEnv) {
 const runtime=environment(get);
 if(!runtime||!publishingConfigured(get)||!['facebook','instagram'].includes(connection.channel)||!Number.isInteger(connection.credential_generation)||connection.credential_generation<1||!numericId(connection.provider_account_id))return false;
 const production=runtime.environment==='production';
 return (production?['test_authorized','production_authorized']:['test_authorized']).includes(connection.status)
  &&(production&&mode(get,'MARKETING_META_PUBLISHING_MODE')==='normal'||ids(get(production?'MARKETING_META_PUBLISH_ACCOUNT_IDS':'MARKETING_META_TEST_ACCOUNT_IDS')).includes(connection.provider_account_id));
}
// Null preserves Staging's existing explicit test-execution policy.
export function productionPublishingPolicy(connection,verified,get=executionEnv) {
 return serverEnvironment(get)?.environment==='production' ? verified===true&&publishingAccountAllowed(connection,get) : null;
}
export function staffReplyConfigured(get=executionEnv) {
 const runtime=environment(get);if(!runtime)return false;
 if(runtime.environment!=='production')return get('MARKETING_INBOX_SEND_ENABLED')==='true'&&ids(get('MARKETING_INBOX_TEST_PEER_IDS')).length>0;
 const accounts=get('MARKETING_INBOX_REPLY_ACCOUNT_IDS'),peers=get('MARKETING_INBOX_REPLY_PEER_IDS');
 const normal=mode(get,'MARKETING_INBOX_REPLY_MODE')==='normal';
 return get('MARKETING_INBOX_STAFF_REPLY_ENABLED')==='true'&&(normal
  ?(!accounts||ids(accounts).length>0)&&(!peers||ids(peers).length>0)
  :mode(get,'MARKETING_INBOX_REPLY_MODE')==='controlled'&&ids(accounts).length>0&&ids(peers).length>0);
}
export function staffReplyAllowed(account,peer,get=executionEnv) {
 const runtime=environment(get);if(!runtime||!staffReplyConfigured(get)||!numericId(account)||!numericId(peer))return false;
 const production=runtime.environment==='production';
 // Normal operation uses canonical send authority; supplied lists only narrow it.
 if(production&&mode(get,'MARKETING_INBOX_REPLY_MODE')==='normal')return (!get('MARKETING_INBOX_REPLY_ACCOUNT_IDS')||ids(get('MARKETING_INBOX_REPLY_ACCOUNT_IDS')).includes(account))
  &&(!get('MARKETING_INBOX_REPLY_PEER_IDS')||ids(get('MARKETING_INBOX_REPLY_PEER_IDS')).includes(peer));
 return (production?ids(get('MARKETING_INBOX_REPLY_ACCOUNT_IDS')):['622626120924115','17841473217923034']).includes(account)
  &&ids(get(production?'MARKETING_INBOX_REPLY_PEER_IDS':'MARKETING_INBOX_TEST_PEER_IDS')).includes(peer);
}
export function metaOAuthScopes(base,get=executionEnv) {
 if(environment(get)?.environment!=='production')return base;
 const added=[...(get('MARKETING_META_OAUTH_PUBLISHING_ENABLED')==='true'?['pages_manage_posts','instagram_content_publish']:[]),
  ...(get('MARKETING_META_OAUTH_INBOX_ENABLED')==='true'?['pages_manage_metadata','pages_messaging','instagram_manage_messages']:[])];
 return [...new Set([...base,...added])];
}

// Independent kill switch: staff sending and Brand consent never implicitly enable AI execution.
export function aiAutoReplyConfigured(get=executionEnv) {
 return Boolean(environment(get))&&get('MARKETING_INBOX_AI_AUTO_ENABLED')==='true'&&get('MARKETING_AI_ENABLED')==='true'&&Boolean(get('MARKETING_AI_MODEL')&&get('OPENAI_API_KEY'));
}
export function aiAutoReplyAllowed(account,peer,get=executionEnv) {
 const runtime=environment(get);if(!aiAutoReplyConfigured(get)||!numericId(account)||!numericId(peer))return false;
 if(runtime.environment==='staging')return staffReplyAllowed(account,peer,get);
 const accounts=get('MARKETING_INBOX_AI_ACCOUNT_IDS'),peers=get('MARKETING_INBOX_AI_PEER_IDS');
 return (!accounts||ids(accounts).includes(account))&&(!peers||ids(peers).includes(peer));
}

// Independent opt-in; existing Page publishing activation cannot enable a new video path.
export function facebookVideoConfigured(get=executionEnv){return Boolean(environment(get))&&get('MARKETING_META_FACEBOOK_VIDEO_ENABLED')==='true';}

export const instagramExtendedConfigured=(get=executionEnv)=>Boolean(environment(get))&&get('MARKETING_META_INSTAGRAM_EXTENDED_ENABLED')==='true';
