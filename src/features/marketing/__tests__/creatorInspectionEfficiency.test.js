import {afterEach,expect,it,vi} from 'vitest';
const spies=vi.hoisted(()=>({loaded:vi.fn(),launch:vi.fn(),get:vi.fn(),load:vi.fn()}));
vi.mock('playwright-core',()=>{spies.loaded();return {chromium:{launch:spies.launch}}});
vi.mock('@sparticuz/chromium',()=>({default:{executablePath:async()=>'/fixture/chromium',args:[]}}));
vi.mock('../../../../server/creatorExtraction/network.mjs',()=>({boundedGet:spies.get,networkBudget:()=>({deadline:Date.now()+45000,bytes:0}),resolvePostUrl:vi.fn()}));
vi.mock('cheerio',async original=>{const actual=await original();return {...actual,load:(...args)=>{spies.load();return actual.load(...args)}}});
import {inspectPublic} from '../../../../server/creatorExtraction/inspect.mjs';
import {inspectProfile} from '../../../../server/creatorExtraction/profiles.mjs';
import {browserDiagnostics,measureBrowser} from '../../../../server/creatorExtraction/diagnostics.mjs';
const url='https://www.instagram.com/p/abc/';
const html='<meta property="og:description" content="Actual caption"><meta property="og:image" content="https://scontent.cdninstagram.com/cover.jpg"><article><header><a href="/creator/">Creator</a></header><time datetime="2025-01-01T00:00:00Z"></time></article>';
const reply=(body=html,status=200)=>({body:Buffer.from(body),url,status});
afterEach(()=>{vi.clearAllMocks();vi.restoreAllMocks()});
it('parses HTML once and does not initialize browser dependencies for HTML-only or restricted results',async()=>{
 spies.get.mockResolvedValue(reply());const result=await inspectPublic(url,{allowPaid:false});
 expect(result).toMatchObject({caption:'Actual caption',author_profile_url:'https://www.instagram.com/creator/',published_at:'2025-01-01T00:00:00Z',browser_used:false,browser_diagnostics:{attempted:false,succeeded:false,duration_ms:0}});
 expect(spies.load).toHaveBeenCalledTimes(1);expect(spies.loaded).not.toHaveBeenCalled();expect(spies.launch).not.toHaveBeenCalled();
 spies.get.mockResolvedValue(reply('',403));expect(await inspectPublic(url,{allowPaid:false})).toMatchObject({reason:'provider_access_restricted',browser_used:false});expect(spies.loaded).not.toHaveBeenCalled();
});
it('retains browser-required fields, provenance and cleanup with lazy initialization',async()=>{
 spies.get.mockResolvedValue(reply('<meta property="og:description" content="Original caption">'));
 const close=vi.fn(),goto=vi.fn(),context={routeWebSocket:vi.fn(),route:vi.fn(),newPage:async()=>({goto,waitForFunction:vi.fn().mockResolvedValue(undefined),content:async()=>html,url:()=>url})};
 spies.launch.mockResolvedValue({newContext:async()=>context,close});
 const result=await inspectPublic(url,{allowPaid:false});
 expect(result).toMatchObject({caption:'Original caption',author_profile_url:'https://www.instagram.com/creator/',published_at:'2025-01-01T00:00:00Z',browser_used:true,browser_diagnostics:{attempted:true,succeeded:true,stage:'complete',failed_stage:null}});
 expect(result.provenance.caption.method).toBe('public_html');expect(result.provenance.published_at.method).toBe('public_browser');expect(close).toHaveBeenCalledOnce();expect(spies.loaded).toHaveBeenCalledOnce();
 expect(goto).toHaveBeenCalledWith(url,expect.objectContaining({waitUntil:'domcontentloaded'}));
 for(const [key,value] of Object.entries(result.browser_diagnostics))if(key.endsWith('_ms'))expect(value).toBeGreaterThanOrEqual(0);
});
it('records failed browser launch without disclosing the exception or discarding HTML evidence',async()=>{
 spies.get.mockResolvedValue(reply('<meta property="og:description" content="Original caption">'));spies.launch.mockRejectedValue(new Error('secret credential private-url'));
 const result=await inspectPublic(url,{allowPaid:false});expect(result).toMatchObject({caption:'Original caption',browser_status:'public_render_unavailable',browser_used:true,browser_diagnostics:{attempted:true,succeeded:false,stage:'launch',failed_stage:'launch'}});
 expect(JSON.stringify(result)).not.toContain('secret credential');
});
it('retains profile failure diagnostics and closes the browser after render failure',async()=>{
 const profile='https://www.tiktok.com/@creator',close=vi.fn();spies.get.mockResolvedValue({...reply('<title>TikTok</title>'),url:profile});
 spies.launch.mockResolvedValue({newContext:async()=>{throw new Error('private render failure')},close});
 const result=await inspectProfile(profile);expect(result).toMatchObject({metadata_status:'unavailable',reason:'profile_fetch_failed',browser_diagnostics:{attempted:true,succeeded:false,failed_stage:'render'}});expect(close).toHaveBeenCalledOnce();expect(JSON.stringify(result)).not.toContain('private render failure');
});
it('caps monotonic timings without changing thrown failures',async()=>{
 vi.spyOn(performance,'now').mockReturnValueOnce(0).mockReturnValueOnce(90000);const diagnostics=browserDiagnostics(),error=new Error('fixture');
 await expect(measureBrowser(diagnostics,async()=>{throw error})).rejects.toBe(error);expect(diagnostics).toMatchObject({attempted:true,succeeded:false,duration_ms:60000});
});
