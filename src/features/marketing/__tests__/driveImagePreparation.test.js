import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const {invoke,upload,uploadSigned,convert}=vi.hoisted(()=>({invoke:vi.fn(),upload:vi.fn(),uploadSigned:vi.fn(),convert:vi.fn()}));
vi.mock('../../../lib/supabase',()=>({supabase:{functions:{invoke},storage:{from:()=>({upload,uploadToSignedUrl:uploadSigned})}}}));
vi.mock('../instagramImagePreparation.js',()=>({prepareInstagramImage:convert}));
import {driveService} from '../driveService.js';
const png={id:'source',state:'ready',mime_type:'image/png'},jpeg={id:'prepared',state:'ready',mime_type:'image/jpeg'};
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(['png'],{type:'image/png'})}));uploadSigned.mockResolvedValue({});convert.mockResolvedValue(new Blob(['jpeg'],{type:'image/jpeg'}));});
afterEach(()=>vi.unstubAllGlobals());
function requests(){invoke.mockImplementation(async(action,{body})=>{
 if(action.endsWith('/image-source'))return {data:{url:'https://storage.example/source'}};
 if(action.endsWith('/prepare-image-upload'))return {data:{...jpeg,state:'pending',object_path:'org/brand/prepared',upload_token:'scoped-upload',source_metadata:{output_sha256:body.sha256}}};
 if(action.endsWith('/finalize-image-upload'))return {data:jpeg};
 if(action.endsWith('/import'))return {data:png};
 throw new Error('Unexpected '+action);
 });}
it('uses one verified preparation across concurrent requests and never overwrites source storage',async()=>{
 requests();expect(await Promise.all([driveService.prepareMedia('org','brand',png,'instagram','image'),driveService.prepareMedia('org','brand',png,'instagram','carousel')])).toEqual([jpeg,jpeg]);
 expect(convert).toHaveBeenCalledTimes(1);expect(uploadSigned).toHaveBeenCalledExactlyOnceWith('org/brand/prepared','scoped-upload',expect.any(Blob),{contentType:'image/jpeg'});expect(upload).not.toHaveBeenCalled();expect(invoke).toHaveBeenCalledTimes(3);
});
it('reuses acknowledged ready derivatives without downloading, converting or uploading',async()=>{
 invoke.mockResolvedValue({data:{prepared:jpeg}});expect(await driveService.prepareMedia('org','brand',png,'instagram','image')).toEqual(jpeg);expect(fetch).not.toHaveBeenCalled();expect(convert).not.toHaveBeenCalled();expect(uploadSigned).not.toHaveBeenCalled();
});
it('preserves JPEG and Facebook selections without preparation requests',async()=>{
 expect(await driveService.prepareMedia('org','brand',jpeg,'instagram','image')).toBe(jpeg);expect(await driveService.prepareMedia('org','brand',png,'facebook','image')).toBe(png);expect(invoke).not.toHaveBeenCalled();
});
it('imports the original PNG, then uses the same preparation path for Google Drive',async()=>{
 requests();expect(await driveService.import('org','brand',{id:'drive',version:'4',mimeType:'image/png'},'instagram','image')).toEqual(jpeg);
 expect(invoke.mock.calls[0]).toEqual(['marketing-drive/import',{body:{organizationId:'org',brandId:'brand',fileId:'drive',version:'4',channel:undefined},signal:undefined}]);expect(convert).toHaveBeenCalledTimes(1);
});
it('does not reserve or finalize after failed conversion and permits a later explicit retry',async()=>{
 requests();convert.mockRejectedValueOnce(new Error('Image preparation failed.'));await expect(driveService.prepareMedia('org','brand',png,'instagram','image')).rejects.toThrow('preparation failed');expect(invoke).toHaveBeenCalledTimes(1);expect(uploadSigned).not.toHaveBeenCalled();expect(await driveService.prepareMedia('org','brand',png,'instagram','image')).toEqual(jpeg);
});
it('does not attach an invalid or rejected final acknowledgement',async()=>{
 requests();const original=invoke.getMockImplementation();invoke.mockImplementation((action,args)=>action.endsWith('/finalize-image-upload')?Promise.resolve({error:new Error('rejected')}):original(action,args));await expect(driveService.prepareMedia('org','brand',png,'instagram','image')).rejects.toThrow('could not be completed');
});
