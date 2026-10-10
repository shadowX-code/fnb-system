import {describe,it,expect,vi} from 'vitest';
import { readMetaPosts, facebookPostFields } from '../../../../supabase/functions/_shared/metaSynchronization.ts';
import { MetaError } from '../../../../supabase/functions/_shared/metaGraph.ts';
const connection={channel:'facebook',provider_account_id:'111',capabilities:{granted_scopes:['pages_read_engagement']}};
const page={data:[{id:'111_222',message:'Page content',created_time:'2026-10-09T00:00:00Z',shares:{count:2}}]};
describe('Facebook optional engagement evidence',()=>{
 it('preserves authorized Page posts and missing metric provenance when protected engagement is denied',async()=>{
  const request=vi.fn().mockResolvedValueOnce(page).mockRejectedValueOnce(new MetaError('meta_permission_or_token_invalid',false,false,10)).mockRejectedValueOnce(new MetaError('platform_rejected',false,false,100));
  const guard=vi.fn(),result=await readMetaPosts({request} as any,connection,'token',guard);
  expect(request.mock.calls[0][2].fields).toBe(facebookPostFields);expect(facebookPostFields).not.toMatch(/likes|comments/);
  expect(request).toHaveBeenCalledTimes(3);expect(guard).toHaveBeenCalledTimes(3);
  expect(result.posts[0]).toMatchObject({id:'111_222',metrics:{shares:2},unavailable_metrics:{likes:'platform_permission_unavailable',comments:'permission_not_granted'}});
  expect(result.posts[0].metrics).not.toHaveProperty('likes');expect(result.posts[0].metrics).not.toHaveProperty('comments');
 });
 it('retains provider thumbnails only from recognized public media hosts without token material',async()=>{
  for(const [candidate,expected] of [['https://scontent.test.fbcdn.net/a.jpg','https://scontent.test.fbcdn.net/a.jpg'],['https://example.com/a.jpg',null],['https://scontent.fbcdn.net/a.jpg?access_token=secret',null]]){
   const request=vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce({likes:{summary:{total_count:0}}}).mockResolvedValueOnce({full_picture:candidate});
   expect((await readMetaPosts({request} as any,connection,'token',vi.fn())).posts[0].thumbnail_url).toBe(expected);
  }
 });
 it('still stops on invalid or expired credentials and revoked authority',async()=>{
  for(const error of [new MetaError('meta_permission_or_token_invalid',false,false,190),new MetaError('meta_permission_or_token_invalid'),new Error('authority changed')]) {
   const request=vi.fn().mockResolvedValueOnce(page).mockRejectedValueOnce(error);
   await expect(readMetaPosts({request} as any,connection,'token',vi.fn())).rejects.toBe(error);
  }
  const request=vi.fn().mockResolvedValueOnce(page),guard=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('scope revoked'));
  await expect(readMetaPosts({request} as any,connection,'token',guard)).rejects.toThrow('scope revoked');expect(request).toHaveBeenCalledTimes(1);
 });
 it('retains actual available metrics and never replaces unsupported values with zero',async()=>{
  const request=vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce({likes:{summary:{total_count:3}}}).mockResolvedValueOnce({full_picture:'https://scontent.test.fbcdn.net/preview.jpg'});
  expect((await readMetaPosts({request} as any,connection,'token',vi.fn())).posts[0].metrics).toEqual({shares:2,likes:3});
 });
});
