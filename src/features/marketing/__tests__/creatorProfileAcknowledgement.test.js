import {afterEach,expect,it,vi} from 'vitest';
import {creatorService} from '../creatorService.js';
vi.mock('../../../lib/supabase',()=>({supabase:{auth:{getSession:vi.fn(async()=>({data:{session:{access_token:'test-only'}}}))},rpc:vi.fn()}}));
afterEach(()=>vi.unstubAllGlobals());
it.each(['transport','invalid-json'])('never retries an uncertain %s profile acknowledgement',async failure=>{
 const fetch=vi.fn(async()=>{if(failure==='transport')throw new TypeError('lost response');return new Response('invalid')});vi.stubGlobal('fetch',fetch);
 await expect(creatorService.profile('org',null,'https://www.instagram.com/target/',{accountId:'a'})).rejects.toThrow(/may already be saved/);expect(fetch).toHaveBeenCalledTimes(1);
});
it('returns the consumed saved-account receipt unchanged without a browser command',async()=>{
 const result={metadata_status:'public_extracted',enrichment_receipt:'receipt',account:{id:'a',followers:32}};const fetch=vi.fn(async()=>new Response(JSON.stringify(result)));vi.stubGlobal('fetch',fetch);
 expect(await creatorService.profile('org',null,'https://www.instagram.com/target/',{accountId:'a'})).toEqual(result);expect(fetch).toHaveBeenCalledTimes(1);
});
