import {afterEach,expect,it,vi} from 'vitest';
import {createInspectionHandler} from './handler.mjs';
import {platformUrl} from '../../server/creatorExtraction/urls.mjs';
import {profileIdentity} from '../../server/creatorExtraction/profileIdentity.mjs';
afterEach(()=>vi.unstubAllEnvs());
function setup(){
 vi.stubEnv('CREATOR_INSPECTION_ENVIRONMENT','staging');vi.stubEnv('CREATOR_INSPECTION_PROJECT_ID','worker');vi.stubEnv('VERCEL_PROJECT_ID','worker');
 const dependencies={verifyVercelOidcToken:vi.fn().mockResolvedValue({}),inspectPublic:vi.fn().mockResolvedValue({platform:'facebook',metadata_status:'public_extracted'}),inspectProfile:vi.fn(),platformUrl,profileIdentity};
 const res={setHeader:vi.fn(),status(n){this.code=n;return this},json(body){this.body=body;return this}};
 const req={method:'POST',headers:{authorization:'Bearer fixture'},body:{version:1,environment:'staging',kind:'post',url:'https://www.facebook.com/brand/posts/12345',deadline:Date.now()+40000}};
 return {dependencies,req,res,run:()=>createInspectionHandler(dependencies)(req,res)};
}
it('verifies the exact Staging workload before running the existing bounded extractor',async()=>{
 const s=setup();await s.run();expect(s.res.code).toBe(200);expect(s.dependencies.verifyVercelOidcToken).toHaveBeenCalledWith('fixture',expect.objectContaining({projectId:'prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi',ownerId:'team_4Xt5PL4r56PxeproAxgfJgqa',environment:'production',audience:'https://vercel.com/shadowxs-projects-5e91a0d4'}));
 expect(s.dependencies.inspectPublic).toHaveBeenCalledExactlyOnceWith(s.req.body.url,{deadline:s.req.body.deadline,allowPaid:false});
});
it.each(['missing','invalid','production'])('fails closed for %s identity/configuration',async failure=>{
 const s=setup();if(failure==='missing')delete s.req.headers.authorization;if(failure==='invalid')s.dependencies.verifyVercelOidcToken.mockRejectedValue(new Error('secret'));if(failure==='production')vi.stubEnv('CREATOR_INSPECTION_ENVIRONMENT','production');
 await s.run();expect(s.res.code).toBe(failure==='production'?503:401);expect(s.dependencies.inspectPublic).not.toHaveBeenCalled();expect(JSON.stringify(s.res.body)).not.toContain('secret');
});
it.each(['expired','unbounded','ssrf','options','environment'])('rejects %s before browser work',async failure=>{
 const s=setup();if(failure==='expired')s.req.body.deadline=Date.now()-1;if(failure==='unbounded')s.req.body.deadline=Date.now()+60000;if(failure==='ssrf')s.req.body.url='https://127.0.0.1/private';if(failure==='options')s.req.body.executablePath='/tmp/unsafe';if(failure==='environment')s.req.body.environment='production';
 await s.run();expect(s.res.code).toBe(failure==='expired'?408:400);expect(s.dependencies.inspectPublic).not.toHaveBeenCalled();
});
