import {afterEach,expect,it,vi} from 'vitest';
import handler from '../../../../api/marketing-creator-inspect.mjs';
import {inspectPublic} from '../../../../server/creatorExtraction/inspect.mjs';
vi.mock('../../../../server/creatorExtraction/inspect.mjs',()=>({inspectPublic:vi.fn()}));
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks()});
it('retains Production XHS URL identity and unavailable/manual fallback without paid or session access',async()=>{
 vi.stubEnv('VITE_SUPABASE_URL','https://oyfobxdoyfuzsodogpgs.supabase.co');
 vi.stubEnv('VERCEL_PROJECT_ID','prj_1UOKHvE6Ft4a2WXrZyZGc9LZRWLP');vi.stubEnv('VERCEL_GIT_COMMIT_REF','main');
 const id='6a8fb7f30000000037034698',canonical='https://www.xiaohongshu.com/explore/'+id,original=canonical+'?xsec_token=fixture';
 const calls=[];vi.stubGlobal('fetch',vi.fn(async(url,options)=>{calls.push(url);expect(url.startsWith('https://oyfobxdoyfuzsodogpgs.supabase.co/rest/v1/rpc/')).toBe(true);const args=JSON.parse(options.body);return new Response(JSON.stringify(url.endsWith('inspection_access')?(args.p_begin?'fixture-lease':null):url.endsWith('creator_directory')?{accounts:[]}:{platform:'xhs',post_key:id,canonical_url:canonical}))}));
 inspectPublic.mockResolvedValue({platform:'xhs',post_id:id,canonical_url:canonical,original_url:original,metadata_status:'unavailable',metrics:{},unavailable:{caption:'Not exposed'}});
 const response={setHeader:vi.fn(),status(code){this.code=code;return this},json:vi.fn()};
 await handler({method:'POST',headers:{authorization:'Bearer fixture.jwt.signature'},body:{org:'ec42a08a-0f59-4b7b-a48e-b2faacf9eaf1',brand:'88718f61-2915-42ef-b62f-5e6e2fe5b3eb',url:original}},response);
 expect(response.code).toBe(200);expect(response.json).toHaveBeenCalledWith(expect.objectContaining({post_id:id,original_url:original,metadata_status:'unavailable',metrics:{}}));
 expect(response.json.mock.calls[0][0].caption).toBeUndefined();expect(inspectPublic).toHaveBeenCalledWith(original,expect.objectContaining({allowPaid:false}));expect(calls.at(-1)).toMatch(/inspection_access$/);
});
