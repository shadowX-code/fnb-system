import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@vercel/oidc',()=>({getVercelOidcToken:vi.fn().mockResolvedValue('server-only-fixture')}));
import {inspectPublic,inspectProfile} from './remote.mjs';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks()});
function setup(result){vi.stubEnv('CREATOR_INSPECTION_ENDPOINT','https://feedx-creator-inspection-staging.vercel.app/api/inspect');vi.stubEnv('VERCEL_PROJECT_ID','prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi');const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(result)));vi.stubGlobal('fetch',fetch);return fetch;}
it('sends only a bounded public-inspection contract and workload identity, never Admin authorization',async()=>{
 const fetch=setup({platform:'facebook',canonical_url:'https://www.facebook.com/brand/posts/123',metadata_status:'public_extracted'});await inspectPublic('https://www.facebook.com/brand/posts/123');
 const options=fetch.mock.calls[0][1];expect(options.redirect).toBe('error');expect(options.headers).toEqual({'Content-Type':'application/json','x-vercel-trusted-oidc-idp-token':'server-only-fixture',Authorization:'Bearer server-only-fixture'});expect(JSON.parse(options.body)).toEqual({version:1,environment:'staging',kind:'post',url:'https://www.facebook.com/brand/posts/123',deadline:expect.any(Number)});expect(fetch).toHaveBeenCalledOnce();
});
it.each(['unconfigured','redirect','wrong-identity','provider-error','timeout'])('fails closed on %s without retry',async failure=>{
 const fetch=setup({platform:'facebook',canonical_url:'https://www.facebook.com/brand/posts/999',metadata_status:'public_extracted'});
 if(failure==='unconfigured')vi.stubEnv('CREATOR_INSPECTION_ENDPOINT','https://evil.example/api/inspect');if(failure==='redirect')fetch.mockResolvedValue(new Response('',{status:302}));if(failure==='provider-error')fetch.mockResolvedValue(new Response('{}',{status:503}));if(failure==='timeout')fetch.mockRejectedValue(new DOMException('timeout','TimeoutError'));
 await expect(inspectPublic('https://www.facebook.com/brand/posts/123')).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(failure==='unconfigured'?0:1);
});
it('rejects a mismatched profile and overlarge response',async()=>{
 const fetch=setup({platform:'tiktok',profile_url:'https://www.tiktok.com/@other',metadata_status:'public_extracted'});await expect(inspectProfile('https://www.tiktok.com/@expected')).rejects.toThrow('profile_identity_changed');fetch.mockResolvedValue(new Response('x'.repeat(1000001)));await expect(inspectProfile('https://www.tiktok.com/@expected')).rejects.toThrow('inspection_response_invalid');
});
it('binds Production to its own endpoint and rejects the Staging endpoint',async()=>{
 const fetch=setup({platform:'facebook',canonical_url:'https://www.facebook.com/brand/posts/123',metadata_status:'public_extracted'});
 vi.stubEnv('VERCEL_PROJECT_ID','prj_1UOKHvE6Ft4a2WXrZyZGc9LZRWLP');
 await expect(inspectPublic('https://www.facebook.com/brand/posts/123')).rejects.toThrow('inspection_runtime_unavailable');expect(fetch).not.toHaveBeenCalled();
 vi.stubEnv('CREATOR_INSPECTION_ENDPOINT','https://feedx-creator-inspection.vercel.app/api/inspect');await inspectPublic('https://www.facebook.com/brand/posts/123');
 expect(fetch.mock.calls[0][0]).toBe('https://feedx-creator-inspection.vercel.app/api/inspect');expect(JSON.parse(fetch.mock.calls[0][1].body).environment).toBe('production');
});
