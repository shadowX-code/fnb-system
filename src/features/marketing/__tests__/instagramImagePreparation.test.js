import {afterEach,it,expect,vi} from 'vitest';
import {instagramImageGeometry,prepareInstagramImage} from '../instagramImagePreparation.js';
import {publishingMediaEligible,publishingMediaSelectable} from '../publishingMedia.js';
afterEach(()=>vi.unstubAllGlobals());
it.each([[1080,1350],[1081,1600],[6000,1000],[100,400],[1000,6000],[320,400]])('fits %sx%s without cropping or invalid rounding',(w,h)=>{
 const box=instagramImageGeometry(w,h);expect(box.width).toBeGreaterThanOrEqual(320);expect(box.width).toBeLessThanOrEqual(1440);expect(box.width/box.height).toBeGreaterThanOrEqual(.8);expect(box.width/box.height).toBeLessThanOrEqual(1.91);
});
it('bounds decoded allocation and rejects invalid dimensions',()=>{expect(()=>instagramImageGeometry(10000,10000)).toThrow('25 megapixels');expect(()=>instagramImageGeometry(0,100)).toThrow();});
it('permits PNG selection without calling it publishing-ready',()=>{const png={state:'ready',mime_type:'image/png',size_bytes:100};expect(publishingMediaSelectable(png,'image','instagram')).toBe(true);expect(publishingMediaEligible(png,'image','instagram')).toBe(false);expect(publishingMediaSelectable(png,'reel_cover','instagram')).toBe(false);expect(publishingMediaSelectable(png,'reel','instagram')).toBe(false);expect(publishingMediaEligible({...png,mime_type:'image/jpeg'},'image','instagram')).toBe(true);});
it('rejects corrupt files before decoding',async()=>{await expect(prepareInstagramImage(new Blob(['not png'],{type:'image/png'}))).rejects.toThrow('valid PNG');});
it('does not report success after a decoder failure',async()=>{
 const header=new Uint8Array(24);header.set([137,80,78,71,13,10,26,10]);new DataView(header.buffer).setUint32(16,1080);new DataView(header.buffer).setUint32(20,1350);
 vi.stubGlobal('createImageBitmap',vi.fn().mockRejectedValue(new Error('PNG decoding failed.')));
 await expect(prepareInstagramImage(new Blob([header],{type:'image/png'}))).rejects.toThrow('decoding failed');
});
