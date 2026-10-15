import {afterEach,describe,expect,it,vi} from 'vitest';
import {inspectProfile} from '../../../../server/creatorExtraction/profiles.mjs';
import {boundedGet} from '../../../../server/creatorExtraction/network.mjs';
import {renderPublic} from '../../../../server/creatorExtraction/browser.mjs';
vi.mock('../../../../server/creatorExtraction/network.mjs',()=>({boundedGet:vi.fn(),networkBudget:()=>({})}));
vi.mock('../../../../server/creatorExtraction/browser.mjs',()=>({renderPublic:vi.fn()}));
const url='https://www.instagram.com/happinesskopitiam/';
const html='<meta property="og:title" content="Happiness Kopitiam (@happinesskopitiam) • Instagram"><meta property="og:image" content="https://scontent.cdninstagram.com/profile.jpg">';
const reply=(body,status=200)=>({body:Buffer.from(body),status,url});
afterEach(()=>vi.resetAllMocks());
describe('bounded profile failure evidence',()=>{
 it.each([403,429])('retains HTTP %s without browser retry or fabricated evidence',async status=>{
  boundedGet.mockResolvedValue(reply('',status));const result=await inspectProfile(url);
  expect(result).toMatchObject({metadata_status:'unavailable',reason:'profile_restricted',http_status:status,method:'public_html'});
  expect(result.avatar_url).toBeUndefined();expect(renderPublic).not.toHaveBeenCalled();expect(boundedGet).toHaveBeenCalledTimes(1);
 });
 it.each(['provider_timeout','provider_access_restricted','profile_identity_changed','inspection_limit'])('preserves safe %s classification',async reason=>{
  boundedGet.mockRejectedValue(new Error(reason));expect(await inspectProfile(url)).toMatchObject({reason,http_status:null,metadata_status:'unavailable'});
 });
 it('does not disclose raw failures or mislabel a generic failure as a provider restriction',async()=>{
  boundedGet.mockRejectedValue(new Error('secret / private network details'));const result=await inspectProfile(url);
  expect(result.reason).toBe('profile_fetch_failed');expect(JSON.stringify(result)).not.toContain('secret');
 });
 it('distinguishes browser metadata absence without further retries',async()=>{
  boundedGet.mockResolvedValue(reply('<title>Instagram</title>'));renderPublic.mockResolvedValue({html:'<title>Instagram</title>',status:200,url});
  expect(await inspectProfile(url)).toMatchObject({reason:'profile_metadata_unavailable',method:'public_browser',http_status:200});expect(renderPublic).toHaveBeenCalledTimes(1);
 });
 it('preserves browser failures instead of swallowing them',async()=>{
  boundedGet.mockResolvedValue(reply('<title>Instagram</title>'));renderPublic.mockRejectedValue(new Error('provider_timeout'));
  expect(await inspectProfile(url)).toMatchObject({reason:'provider_timeout',method:'public_browser',metadata_status:'unavailable'});
 });
 it('keeps genuine profile evidence and capture time on success',async()=>{
  boundedGet.mockResolvedValue(reply(html));const result=await inspectProfile(url);
  expect(result).toMatchObject({avatar_kind:'profile_picture',avatar_url:'https://scontent.cdninstagram.com/profile.jpg',profile_url:url,metadata_status:'public_extracted',method:'public_html'});
  expect(Number.isFinite(Date.parse(result.captured_at))).toBe(true);expect(renderPublic).not.toHaveBeenCalled();
 });
});
