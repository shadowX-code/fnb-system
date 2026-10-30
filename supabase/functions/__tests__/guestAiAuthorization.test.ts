import {describe,it,expect,vi} from 'vitest';
import {hasGuestAiPermission} from '../_shared/guestAiAuthorization.ts';
import {readFileSync} from 'node:fs';
describe('Guest AI canonical permission enforcement',()=>{
 it('checks access and additional developer authority without inferring it from sign-in',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:true,error:null});
  expect(await hasGuestAiPermission({rpc},true)).toBe(true);
  expect(rpc.mock.calls.map(call=>call[1].permission_code)).toEqual(['guest_ai.access','guest_ai.developer']);
 });
 it.each([{data:false,error:null},{data:null,error:null},{data:true,error:new Error('denied')}])('fails closed on denial or unavailable authority: %s',async result=>{
  expect(await hasGuestAiPermission({rpc:vi.fn().mockResolvedValue(result)})).toBe(false);
 });
 it('denies rejected authority reads',async()=>expect(await hasGuestAiPermission({rpc:vi.fn().mockRejectedValue(new Error('offline'))})).toBe(false));
 it('guards every existing provider entrypoint before provider work',()=>{
  for(const name of ['guest-ai-stt','guest-ai-reply','guest-ai-tts','guest-ai-stt-benchmark']){
   const source=readFileSync(`supabase/functions/${name}/index.ts`,'utf8');
   expect(source).toContain('hasGuestAiPermission(');expect(source).toContain('permission_denied');
  }
 });
});
