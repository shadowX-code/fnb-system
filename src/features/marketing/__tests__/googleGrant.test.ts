import {it,expect,vi} from 'vitest';
import {googleGrant} from '../../../../supabase/functions/_shared/googleDrive.ts';
const refresh={grant_type:'refresh_token',refresh_token:'fixture'};
it('treats only invalid_grant as expired authorization',async()=>{
 for(const [status,error,code] of [[400,'invalid_grant','reconnect_required'],[401,'invalid_client','drive_configuration_required'],[503,'temporarily_unavailable','drive_unavailable'],[429,'rate_limit_exceeded','drive_unavailable']] as const){
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({error}),{status}));await expect(googleGrant(refresh,'test','test',fetcher as any)).rejects.toMatchObject({code});expect(fetcher.mock.calls.length).toBe(status>=429?2:1);
 }
});
it('recovers one transient refresh failure but never repeats authorization-code exchanges',async()=>{
 let calls=0;const fetcher=vi.fn(async()=>++calls===1?new Response('{}',{status:503}):new Response(JSON.stringify({access_token:'fixture',expires_in:3600})));
 expect((await googleGrant(refresh,'test','test',fetcher as any)).expires_in).toBe(3600);expect(fetcher).toHaveBeenCalledTimes(2);
 const exchange=vi.fn(async()=>new Response('{}',{status:503}));await expect(googleGrant({grant_type:'authorization_code'},'test','test',exchange as any)).rejects.toMatchObject({code:'drive_unavailable'});expect(exchange).toHaveBeenCalledTimes(1);
});
it('does not turn network or malformed responses into credential revocation',async()=>{
 for(const fetcher of [vi.fn(async()=>{throw new Error('network')}),vi.fn(async()=>new Response('bad')),vi.fn(async()=>new Response('{}'))])await expect(googleGrant(refresh,'test','test',fetcher as any)).rejects.toMatchObject({code:'drive_unavailable'});
});
