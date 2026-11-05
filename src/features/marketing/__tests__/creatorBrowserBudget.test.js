import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({launch:vi.fn(),get:vi.fn(),chromium:{args:[],executablePath:vi.fn(),setGraphicsMode:true}}));
vi.mock('playwright-core',()=>({chromium:{launch:mocks.launch}}));
vi.mock('@sparticuz/chromium',()=>({default:mocks.chromium}));
vi.mock('../../../../server/creatorExtraction/network.mjs',()=>({boundedGet:mocks.get}));
import {renderPublic} from '../../../../server/creatorExtraction/browser.mjs';
afterEach(()=>{vi.restoreAllMocks();vi.clearAllMocks()});
it('does not launch Chromium after the existing inspection deadline',async()=>{
 await expect(renderPublic('https://www.instagram.com/p/abc/','instagram',{deadline:Date.now()-1})).rejects.toThrow('inspection_limit');
 expect(mocks.launch).not.toHaveBeenCalled();expect(mocks.chromium.executablePath).not.toHaveBeenCalled();
});
it('retains browser rendering and cleanup, disables WebGL and bounds the metadata wait',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(1000);
 const waitForFunction=vi.fn().mockResolvedValue(undefined),close=vi.fn(),context={routeWebSocket:vi.fn(),route:vi.fn(),newPage:async()=>({goto:vi.fn(),waitForFunction,content:async()=>'<title>Observed</title>',url:()=> 'https://www.instagram.com/p/abc/'})};
 mocks.launch.mockResolvedValue({newContext:async()=>context,close});
 const value=await renderPublic('https://www.instagram.com/p/abc/','instagram',{deadline:1020},{executablePath:'/fixture/chrome'});
 expect(value.html).toBe('<title>Observed</title>');expect(mocks.chromium.setGraphicsMode).toBe(false);
 expect(waitForFunction).toHaveBeenCalledWith(expect.any(Function),{}, {timeout:20});expect(close).toHaveBeenCalledOnce();
});
it('closes a browser if its startup consumed the remaining deadline',async()=>{
 const close=vi.fn(),goto=vi.fn(),now=vi.spyOn(Date,'now').mockReturnValue(1000);
 mocks.launch.mockImplementation(async()=>{now.mockReturnValue(2000);return {close,newContext:async()=>({routeWebSocket:vi.fn(),route:vi.fn(),newPage:async()=>({goto})})}});
 await expect(renderPublic('https://www.instagram.com/p/abc/','instagram',{deadline:1500},{executablePath:'/fixture/chrome'})).rejects.toThrow('inspection_limit');
 expect(goto).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();
});
it('does not launch if executable extraction exhausts the deadline',async()=>{
 const now=vi.spyOn(Date,'now').mockReturnValue(1000);
 mocks.chromium.executablePath.mockImplementation(async()=>{now.mockReturnValue(2000);return '/fixture/chrome'});
 await expect(renderPublic('https://www.instagram.com/p/abc/','instagram',{deadline:1500})).rejects.toThrow('inspection_limit');
 expect(mocks.launch).not.toHaveBeenCalled();
});
