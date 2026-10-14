// Exact environment profiles prevent credentials and callbacks crossing projects.
const profiles = {
  'https://ujkzdaaadnvcfayuldmh.supabase.co': {environment:'staging', projectRef:'ujkzdaaadnvcfayuldmh', origin:'https://fnb-system-staging.vercel.app', vercelProject:'prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi', branch:'dev', appId:'2204918033458414', loginConfigId:'1398015649111006'},
  'https://oyfobxdoyfuzsodogpgs.supabase.co': {environment:'production', projectRef:'oyfobxdoyfuzsodogpgs', origin:'https://os.feedx.my', vercelProject:'prj_1UOKHvE6Ft4a2WXrZyZGc9LZRWLP', branch:'main', appId:'2182829996001809', loginConfigId:'2027095767950085'},
};
export function marketingEnvironment(url, configuredEnvironment) {
  const profile=profiles[url];
  if(!profile || configuredEnvironment && configuredEnvironment!==profile.environment) return null;
  return {...profile, supabaseUrl:url, metaBase:url+'/functions/v1/marketing-meta', metaRedirect:url+'/functions/v1/marketing-meta/callback', driveRedirect:url+'/functions/v1/marketing-drive/callback', webhook:url+'/functions/v1/marketing-inbox/webhook'};
}
export function metaEnvironmentMatches(runtime, appId, configId) {
  return !!runtime && (!appId || appId===runtime.appId) && (!configId || configId===runtime.loginConfigId);
}
export function serverEnvironment(get) {
  return marketingEnvironment(get('SUPABASE_URL') || '', get('MARKETING_ENVIRONMENT'));
}
const get=(key)=>typeof Deno!=='undefined'?Deno.env.get(key):typeof process!=='undefined'?process.env[key]:undefined;
export const runtime=serverEnvironment(get);
export const RUNTIME_SUPABASE=runtime?.supabaseUrl || '';
export const RUNTIME_ORIGIN=runtime?.origin || '';
export const RUNTIME_PROJECT_REF=runtime?.projectRef || '';
export const PRODUCTION_RUNTIME=runtime?.environment==='production';
export function runtimeMetaMatches(get) { return metaEnvironmentMatches(runtime,get('MARKETING_META_APP_ID'),get('MARKETING_META_LOGIN_CONFIG_ID')); }
