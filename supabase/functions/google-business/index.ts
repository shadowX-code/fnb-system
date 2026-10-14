import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.4';
import { STAGING_ORIGIN, STAGING_SUPABASE, hash, nonce, seal, unseal, base64url, tokenEncryptionReady } from '../_shared/metaSecurity.ts';
import { googleGrant, DriveError } from '../_shared/googleDrive.ts';
import { GoogleBusinessProfile, BUSINESS_SCOPE, BusinessProfileError, completePages, readReviewInbox, revokeBusinessGrant } from '../_shared/googleBusinessProfile.ts';

const env = (name: string) => Deno.env.get(name) || '';
const secret = () => env('GOOGLE_BUSINESS_TOKEN_ENCRYPTION_KEY');
const keys = () => [secret(), env('GOOGLE_BUSINESS_PREVIOUS_TOKEN_ENCRYPTION_KEY')];
const redirect = `${STAGING_SUPABASE}/functions/v1/google-business/callback`;
const tokenBinding = (generation: number) => `google-business:token:${generation}`;
const inboxBinding = (generation: number, mapping: any) => `google-business:inbox:${generation}:${mapping.location_resource_name}:${mapping.revision}`;
const configured = () => ['CLIENT_ID','CLIENT_SECRET','TOKEN_ENCRYPTION_KEY'].every(n => env('GOOGLE_BUSINESS_' + n));
const messages: Record<string, string> = { reconnect_required: 'Reconnect Google Business Profile in Settings.', google_access_denied: 'Google location access is unavailable. Check the connected account.', google_unavailable: 'Google is temporarily unavailable. Try again.', revocation_pending: 'Google revocation did not finish. Retry Disconnect; review access is already disabled.', sync_limit: 'This location exceeds the supported sync size. Contact your administrator.', repeated_page: 'Google returned incomplete pagination. Retry sync.', invalid_review: 'Google review evidence could not be verified. Retry sync.', conflicting_review: 'Google changed a review during sync. Retry sync.' };

export async function handle(req: Request) {
 const headers = { 'Access-Control-Allow-Origin': STAGING_ORIGIN, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Vary': 'Origin' };
 const reply = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
 if (req.method === 'OPTIONS') return new Response(null, { headers });
 if (env('SUPABASE_URL') !== STAGING_SUPABASE) return reply({ error: 'Integration is enabled on Staging only.' }, 403);
 if (req.headers.has('origin') && req.headers.get('origin') !== STAGING_ORIGIN) return reply({ error: 'Origin unavailable.' }, 403);
 const action = new URL(req.url).pathname.split('/').pop()!;
 if (action === 'configuration' && req.method === 'GET') return reply({ configured: Boolean(configured()) && await tokenEncryptionReady(secret()), redirectUri: redirect, scope: BUSINESS_SCOPE });
 const db = createClient(STAGING_SUPABASE, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
 let user: string | null = null, outlet: string | null = null;
 const call = async (command: string, data: any = {}) => {
  const result = await db.rpc('crew_google_business_server', { p_action: command, p_user: user, p_outlet: outlet, p_data: data });
  if (result.error) throw new Error(result.error.message);
  return result.data;
 };
 const grant = (params: Record<string, string>) => googleGrant(params, env('GOOGLE_BUSINESS_CLIENT_ID'), env('GOOGLE_BUSINESS_CLIENT_SECRET'), fetch, false);
 const discovery = async (provider: GoogleBusinessProfile) => {
  const accounts = await completePages<any>(async t => { const p = await provider.listAccounts(t); return { rows: p.accounts, nextPageToken: p.nextPageToken }; });
  const locations = [];
  for (const account of accounts) {
   const found = await completePages<any>(async t => { const p = await provider.listLocations(account.name, t); return { rows: p.locations, nextPageToken: p.nextPageToken }; });
   locations.push(...found.map(l => ({ ...l, account: account.name })));
  }
  return { accounts, locations };
 };
 try {
  if (action === 'callback' && req.method === 'GET') {
   if (!configured()) throw new Error('Google configuration is unavailable.');
   const url = new URL(req.url), state = url.searchParams.get('state') || '';
   if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error('Invalid authorization state.');
   const stateHash = await hash(state), session = await call('oauth_consume', { state_hash: stateHash });
   user = session.actor; outlet = session.outlet_id;
   if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new Error('Google authorization was not completed.');
   const verifier = await unseal(session.sealed_verifier, keys(), `google-business:state:${stateHash}`);
   const token = await grant({ grant_type: 'authorization_code', code: url.searchParams.get('code')!, redirect_uri: redirect, code_verifier: verifier.value });
   if (!token.scope?.split(' ').includes(BUSINESS_SCOPE) || !token.refresh_token) throw new Error('Offline Business Profile permission was not granted.');
   const found = await discovery(new GoogleBusinessProfile(token.access_token));
   await call('oauth_finish', { state_hash: stateHash, ...found, sealed_token: await seal(token, secret(), tokenBinding(session.generation + 1)), expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString() });
   return Response.redirect(`${STAGING_ORIGIN}/crew/performance/google-reviews?google_result=connected`, 303);
  }
  if (req.method !== 'POST') return reply({ error: 'Endpoint unavailable.' }, 404);
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return reply({ error: 'Sign in to FeedX.' }, 401);
  const identity = await db.auth.getUser(auth.slice(7));
  if (identity.error || !identity.data.user) return reply({ error: 'Sign in again.' }, 401);
  user = identity.data.user.id;
  if (Number(req.headers.get('content-length') || 0) > 16000) throw new Error('Request too large.');
  const body = await req.json(); outlet = body.outletId;
  if (typeof outlet !== 'string' || !/^[a-f0-9-]{36}$/i.test(outlet)) throw new Error('Select an outlet.');
  const context = await call('context');
  if (action === 'context') {
   const result = { ...context, configured: Boolean(configured()) && await tokenEncryptionReady(secret()), reviews: [] };
   if (context.connection_status === 'connected' && context.sync_status === 'complete') {
    const inbox = await call('inbox');
    if (inbox.cache) {
     result.reviews = await unseal(inbox.cache.sealed_reviews, keys(), inboxBinding(inbox.generation, inbox.mapping));
     await call('guard', { generation: inbox.generation, revision: inbox.mapping.revision });
    }
   }
   return reply(result);
  }
  if (!configured()) throw new Error('An administrator must configure Google Business Profile.');
  if (action === 'authorize') {
   const state = nonce(), verifier = nonce(), stateHash = await hash(state);
   await call('begin', { state_hash: stateHash, sealed_verifier: await seal({ value: verifier }, secret(), `google-business:state:${stateHash}`) });
   const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
   for (const [k,v] of Object.entries({ client_id: env('GOOGLE_BUSINESS_CLIENT_ID'), redirect_uri: redirect, response_type: 'code', scope: BUSINESS_SCOPE, access_type: 'offline', prompt: 'consent', state, code_challenge: base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))), code_challenge_method: 'S256' })) url.searchParams.set(k,v);
   return reply({ url: url.toString() });
  }
  if (action === 'disconnect') {
   const pending = await call('disconnect_begin');
   if (!pending.disconnected) {
    if (pending.sealed_token) { const token = await unseal(pending.sealed_token, keys(), tokenBinding(pending.token_generation)); await revokeBusinessGrant(token.refresh_token || token.access_token); }
    await call('disconnect_finish', { generation: pending.generation });
   }
   return reply({ ok: true });
  }
  if (action === 'map') {
   if (body.confirmMapping !== true) throw new Error('Confirm the selected Google location belongs to this outlet.');
   return reply(await call('map', { location: body.location || null, generation: body.generation, expected_revision: body.revision || null }));
  }
  if (!['sync','discover'].includes(action)) return reply({ error: 'Endpoint unavailable.' }, 404);
  let material = await call('material');
  const decode = (m: any) => unseal(m.sealed_token, keys(), tokenBinding(m.generation));
  let token = await decode(material);
  // Explicit location rediscovery verifies the persistent grant with a fresh access token.
  if (action === 'discover' || new Date(material.expires_at).getTime() < Date.now() + 60000) {
   try {
    const fresh = await grant({ grant_type: 'refresh_token', refresh_token: token.refresh_token });
    const renewed = { ...token, ...fresh };
    const saved = await call('refresh', { generation: material.generation, expected_token: material.sealed_token, sealed_token: await seal(renewed, secret(), tokenBinding(material.generation)), expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString() });
    if (saved.updated) token = renewed;
    else { material = await call('material'); token = await decode(material); }
   } catch (error) {
    if (!(error instanceof DriveError) || error.code !== 'reconnect_required') throw error;
    const current = await call('material');
    if (current.generation === material.generation && JSON.stringify(current.sealed_token) !== JSON.stringify(material.sealed_token) && new Date(current.expires_at).getTime() > Date.now() + 60000) { material = current; token = await decode(current); }
    else { await call('expired', { generation: material.generation, expected_token: material.sealed_token }); throw error; }
   }
  }
  const provider = new GoogleBusinessProfile(token.access_token);
  if (action === 'discover') {
   if (!context.can_manage) throw new Error('Connection management permission is required.');
   return reply(await call('discover', { ...await discovery(provider), generation: material.generation }));
  }
  if (!material.mapping?.outlet_id) throw new Error('Map this outlet to a Google location in Settings.');
  const basis = { generation: material.generation, revision: material.mapping.revision };
  const lease = await call('sync_begin', basis);
  try {
   const reviews = await readReviewInbox(provider, material.mapping.location_resource_name);
   await call('sync_finish', { ...basis, lease: lease.lease, sealed_reviews: await seal(reviews, secret(), inboxBinding(material.generation, material.mapping)) });
   return reply({ ok: true });
  } catch (error) {
   await call('sync_error', { ...basis, lease: lease.lease }).catch(() => {});
   if (error instanceof BusinessProfileError && error.code === 'reconnect_required') await call('expired', { generation: material.generation, expected_token: material.sealed_token }).catch(() => {});
   throw error;
  }
 } catch (error) {
  const code = error instanceof BusinessProfileError || error instanceof DriveError ? error.code : 'request_rejected';
  if (code === 'google_rate_limited') {
   const service = error instanceof BusinessProfileError ? error.service : 'oauth2.googleapis.com';
   const request = error instanceof BusinessProfileError ? error.request : 'POST /token';
   console.warn(JSON.stringify({ integration: 'google-business', action, code, service, request }));
   if (action === 'callback') return Response.redirect(`${STAGING_ORIGIN}/crew/performance/google-reviews?google_result=rate_limited`,303);
   return reply({ error: `Google rate limit (429): ${service} · ${request}. No automatic retry was made.`, code, service, request },429);
  }
  if (action === 'callback') return Response.redirect(`${STAGING_ORIGIN}/crew/performance/google-reviews?google_result=failed`, 303);
  return reply({ error: messages[code] || (code === 'request_rejected' && error instanceof Error ? error.message : 'Google Reviews request could not be completed.'), code }, error instanceof BusinessProfileError ? Math.min(error.status,503) : 400);
 }
}
if (import.meta.main) Deno.serve(handle);
