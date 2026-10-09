import { webcrypto } from 'node:crypto';
import { afterEach,describe,it,expect,vi } from 'vitest';
import { seal,unseal,nonce,hash,authorizationUrl,verifySignedRequest,base64url,META_REDIRECT } from '../../../../supabase/functions/_shared/metaSecurity.ts';
vi.stubGlobal('crypto',webcrypto);afterEach(()=>vi.clearAllMocks());
describe('Meta credential and OAuth security',()=>{
 it('encrypts with brand/account binding and supports deliberate previous-key rotation',async()=>{
  const key=base64url(webcrypto.getRandomValues(new Uint8Array(32))),other=base64url(webcrypto.getRandomValues(new Uint8Array(32)));
  const value=await seal({token:'unit-test-token'},key,'brand:account');
  expect(JSON.stringify(value)).not.toContain('unit-test-token');
  expect(await unseal(value,[other,key],'brand:account')).toEqual({token:'unit-test-token'});
  await expect(unseal(value,[key],'other-brand:account')).rejects.toThrow();
  await expect(unseal(value,[other],'brand:account')).rejects.toThrow();
 });
 it('pins official redirect and business config; state has 256 bits and no credential is embedded',async()=>{
  const state=nonce();expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(await hash(state)).toHaveLength(64);
  const url=new URL(authorizationUrl({appId:'123',configId:'456',version:'v26.0'},state));
  expect(url.origin).toBe('https://www.facebook.com');expect(url.searchParams.get('redirect_uri')).toBe(META_REDIRECT);
  expect(url.searchParams.get('state')).toBe(state);expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.has('client_secret')).toBe(false);
 });
 it('verifies signed removal callbacks and rejects forged or future requests',async()=>{
  const secret='unit-test-app-secret',issued_at=Math.floor(Date.now()/1000);
  const sign=async(payload:any)=>{const encoded=base64url(new TextEncoder().encode(JSON.stringify(payload)));const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return `${base64url(new Uint8Array(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(encoded))))}.${encoded}`;};
  const signed=await sign({algorithm:'HMAC-SHA256',user_id:'123',issued_at});
  expect(await verifySignedRequest(signed,secret)).toEqual({user_id:'123',issued_at});
  await expect(verifySignedRequest(signed,'wrong')).rejects.toThrow();
  await expect(verifySignedRequest(await sign({algorithm:'HMAC-SHA256',user_id:'123',issued_at:issued_at+3600}),secret)).rejects.toThrow();
 });
});
